/**
 * evaluate-recommendations — diaria
 *
 * Marca el resultado de las recomendaciones en TRES horizontes: 7, 14 y 30
 * días, comparando el precio de entonces contra el de hoy. No usa IA: es
 * aritmética sobre `price_history`, así que no cuesta nada.
 *
 * Es lo que evita que el asesor sea una caja negra. Una recomendación de compra
 * cuyo activo subió es correcta; una de venta cuyo activo subió es incorrecta.
 *
 * Los tres horizontes salen de la MISMA corrida diaria: cada uno tiene su
 * propia marca de evaluado, así que una recomendación se mide a los 7 días, se
 * vuelve a mirar a los 14 y se cierra a los 30 sin que ninguna pisada dependa
 * de las otras. La de 30 días es la única que desactiva la recomendación.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isServiceRole, unauthorized } from '../_shared/auth.ts'

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

/** Debajo de este movimiento no se le atribuye acierto ni error a nadie. */
const NOISE_PCT = 3
/** Cuántas se evalúan por horizonte y por corrida. */
const BATCH = 100

/**
 * Cuánto atraso se tolera antes de dejar una medición sin hacer.
 *
 * El horizonte es una VENTANA, no un piso: medir "a 7 días" usando el precio
 * de dos meses después no es una medición tardía, es otra medición. Sin este
 * techo, la primera corrida después de la 0037 evaluaría como "7 días" todas
 * las recomendaciones históricas —que tienen la marca en null porque la
 * columna acaba de nacer— contra el precio de hoy, y el asesor arrancaría con
 * un historial de corto plazo inventado.
 *
 * Las que quedan afuera se quedan en null para siempre, que es lo correcto:
 * nunca se midieron a 7 días y ya no se pueden medir.
 */
const MAX_LAG_DAYS = 7

/**
 * El benchmark: el CEDEAR del S&P 500, que cotiza en pesos igual que el resto
 * de la cartera. Está siempre en `asset_metadata` como sugerible, así que
 * `fetch-market-quotes` le escribe un cierre por rueda en `price_history`.
 */
const BENCHMARK = 'SPY'

type Action = 'buy' | 'add' | 'trim' | 'sell' | 'rebalance' | 'hold'

/**
 * El alpha solo tiene sentido donde se TOMÓ exposición.
 *
 * En un `sell` acertado el activo cae, así que `changePct - spyReturn` daría un
 * número muy negativo justo cuando la decisión fue buena: vender a tiempo algo
 * que después se derrumbó pasaría a leerse como "le perdiste al mercado". Y
 * como el promedio de alpha alimenta una instrucción del prompt ("tu alpha es
 * negativo, esto debe mejorar"), un sell bien hecho terminaría empujando al
 * modelo a desconfiar de sí mismo.
 *
 * `hold` y `rebalance` quedan afuera por lo mismo que ya los deja afuera
 * `verdict()`: no hay un activo contra el cual comparar.
 */
function takesExposure(action: Action): boolean {
  return action === 'buy' || action === 'add'
}

/** Último cierre conocido de un símbolo. */
async function lastClose(symbol: string): Promise<number | null> {
  const { data } = await db
    .from('price_history')
    .select('close_price')
    .eq('symbol', symbol)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return data ? Number(data.close_price) : null
}

/** Comprar y que suba es acertar; vender y que suba es errar. */
function verdict(action: Action, changePct: number): string {
  if (Math.abs(changePct) < NOISE_PCT) return 'neutral'

  const wantedUp = action === 'buy' || action === 'add'
  const wantedDown = action === 'sell' || action === 'trim'

  if (wantedUp) return changePct > 0 ? 'correcta' : 'incorrecta'
  if (wantedDown) return changePct < 0 ? 'correcta' : 'incorrecta'
  return 'neutral' // rebalance y hold no se juzgan por el precio de un solo activo
}

/**
 * Evalúa un horizonte y devuelve lo que marcó.
 *
 * Las columnas van por parámetro porque el horizonte de 30 días usa los
 * nombres viejos (`outcome_verdict`, `evaluated_at`), sin sufijo: son los que
 * leen el frontend y el track record del asesor, y renombrarlos para que la
 * función quedara más prolija habría roto las dos cosas.
 *
 * `opts.deactivate` es solo para los 30 días: ahí la recomendación se cierra.
 * `opts.maxLagDays` acota hacia atrás qué se considera medible; sin él —el
 * caso de 30 días— se mantiene el comportamiento histórico, que reintenta para
 * siempre las que quedaron sin precio.
 */
async function evaluateAtHorizon(
  horizonDays: number,
  priceCol: string,
  pctCol: string,
  verdictCol: string,
  evaluatedCol: string,
  spyReturnCol: string,
  alphaCol: string,
  opts: { deactivate?: boolean; maxLagDays?: number } = {},
): Promise<Array<Record<string, unknown>>> {
  const now = Date.now()
  const cutoff = new Date(now - horizonDays * 864e5).toISOString()

  let query = db
    .from('recommendations')
    .select('id, action, symbol, price_at_recommendation, spy_price_at_rec, created_at')
    .is(evaluatedCol, null)
    .lte('created_at', cutoff)
    .limit(BATCH)

  if (opts.maxLagDays !== undefined) {
    const floor = new Date(now - (horizonDays + opts.maxLagDays) * 864e5).toISOString()
    query = query.gte('created_at', floor)
  }

  const { data: pending, error } = await query
  if (error) {
    console.error(`[evaluate] ${horizonDays}d:`, error.message)
    return []
  }
  if (!pending?.length) return []

  // Una sola lectura para todo el lote: el precio de hoy del benchmark es el
  // mismo para las 100 recomendaciones que se estén evaluando.
  const spyNow = await lastClose(BENCHMARK)
  if (spyNow === null) {
    console.warn(`[evaluate] ${horizonDays}d: sin cierre de ${BENCHMARK}, se evalúa sin alpha`)
  }

  const results: Array<Record<string, unknown>> = []

  for (const rec of pending) {
    if (!rec.price_at_recommendation) {
      // Sin precio de referencia no hay nada que comparar; se cierra para no
      // volver a mirarla en cada corrida
      await db
        .from('recommendations')
        .update({ [evaluatedCol]: new Date().toISOString(), [verdictCol]: 'sin_precio' })
        .eq('id', rec.id)
      continue
    }

    const { data: latest } = await db
      .from('price_history')
      .select('close_price, recorded_at')
      .eq('symbol', rec.symbol)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!latest) continue // todavía no hay precio nuevo del activo

    const before = Number(rec.price_at_recommendation)
    const after = Number(latest.close_price)
    const changePct = ((after - before) / before) * 100
    const outcome = verdict(rec.action as Action, changePct)

    // Sin precio de SPY guardado no hay contra qué comparar: es una
    // recomendación anterior a la 0038 y se queda sin alpha. Inventarle un
    // precio retroactivo sería fabricar el número que la métrica existe para
    // medir.
    const spyBefore = Number(rec.spy_price_at_rec)
    const spyReturn =
      spyNow !== null && Number.isFinite(spyBefore) && spyBefore > 0
        ? ((spyNow - spyBefore) / spyBefore) * 100
        : null

    const alpha =
      spyReturn !== null && takesExposure(rec.action as Action) ? changePct - spyReturn : null

    await db
      .from('recommendations')
      .update({
        [priceCol]: after,
        [pctCol]: changePct,
        [verdictCol]: outcome,
        [evaluatedCol]: new Date().toISOString(),
        // El retorno del índice se guarda siempre que se pueda calcular; el
        // alpha, solo donde hubo exposición.
        ...(spyReturn !== null ? { [spyReturnCol]: spyReturn } : {}),
        ...(alpha !== null ? { [alphaCol]: alpha } : {}),
        // Solo el horizonte largo cierra la recomendación: a los 7 y a los 14
        // días la sugerencia sigue vigente y se sigue mostrando en la app.
        ...(opts.deactivate ? { is_active: false } : {}),
      })
      .eq('id', rec.id)

    results.push({
      horizon: `${horizonDays}d`,
      symbol: rec.symbol,
      action: rec.action,
      changePct: changePct.toFixed(1),
      outcome,
      ...(alpha !== null ? { alpha: alpha.toFixed(1) } : {}),
    })
  }

  return results
}

Deno.serve(async (req) => {
  if (!isServiceRole(req)) return unauthorized()

  // En serie y no en paralelo: los tres horizontes escriben sobre la misma
  // tabla y una recomendación de 30 días también está pendiente de las otras
  // dos si nunca se evaluó. Secuencial, cada update ve lo que hizo el anterior.
  const short = await evaluateAtHorizon(
    7,
    'price_after_7d',
    'outcome_7d_pct',
    'outcome_7d_verdict',
    'evaluated_7d_at',
    'spy_return_7d',
    'alpha_7d',
    { maxLagDays: MAX_LAG_DAYS },
  )
  const mid = await evaluateAtHorizon(
    14,
    'price_after_14d',
    'outcome_14d_pct',
    'outcome_14d_verdict',
    'evaluated_14d_at',
    'spy_return_14d',
    'alpha_14d',
    { maxLagDays: MAX_LAG_DAYS },
  )
  const long = await evaluateAtHorizon(
    30,
    'price_after_30d',
    'outcome_pct',
    'outcome_verdict',
    'evaluated_at',
    'spy_return_30d',
    'alpha_30d',
    { deactivate: true },
  )

  const results = [...short, ...mid, ...long]
  if (!results.length) {
    return Response.json({ ok: true, evaluated: 0, note: 'nada cumplió su horizonte todavía' })
  }

  return Response.json({
    ok: true,
    evaluated: results.length,
    byHorizon: { '7d': short.length, '14d': mid.length, '30d': long.length },
    results,
  })
})
