/**
 * portfolio-advisor — 2 veces por día en horario de mercado
 *
 * Produce ACCIONES sobre la cartera (comprar, reducir, vender, rebalancear) y
 * las guarda con el precio del momento, para poder medir después si acertaron.
 *
 * Corre SIEMPRE que le toca: las dos corridas diarias se muestran en la app
 * como promesa, así que no hay cortes silenciosos por "pocas noticias".
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isServiceRole, userIdFromJwt } from '../_shared/auth.ts'
import { advise, fmtArs, OPPORTUNITY_MODEL, type Recommendation } from '../_shared/claude.ts'
import { getUserApiKey, markApiKeyUsed } from '../_shared/apiKey.ts'
import { canUseAI } from '../_shared/market.ts'
import {
  periodReturn,
  relativeStrengthRank,
  type RelativeStrength,
  technicals,
  type Technicals,
} from '../_shared/indicators.ts'
import {
  buildInvestorProfile,
  MAX_EXISTING_POSITION_PCT,
  MAX_NEW_POSITION_PCT,
  MAX_SECTOR_AFTER_BUY_PCT,
  toAdvisorSettings,
  type UserSettings,
} from '../_shared/profile.ts'
import { sendPush } from '../_shared/push.ts'
import { corsHeaders, jsonWithCors, preflight } from '../_shared/cors.ts'

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

/**
 * Mínimo entre dos análisis pedidos a mano.
 *
 * Cada uno es una request a Opus. Sin freno, tocar el botón repetido cuesta
 * plata y devuelve casi lo mismo: la cartera no cambia en cinco minutos.
 */
const ON_DEMAND_COOLDOWN_MINUTES = 45
const NEWS_CONTEXT = 12
/** Solo alta convicción notifica, y con tope: no queremos empujar a sobre-operar. */
const MAX_PUSH_PER_RUN = 2

/** Tendencia de 30 días en una palabra, para no gastar tokens en la serie entera */
function trend(prices: number[]): string {
  if (prices.length < 2) return 'sin histórico'
  const change = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100
  const label = change > 8 ? 'subiendo fuerte' : change > 2 ? 'subiendo' : change < -8 ? 'cayendo fuerte' : change < -2 ? 'cayendo' : 'lateral'
  return `${label} (${change > 0 ? '+' : ''}${change.toFixed(1)}%)`
}

/**
 * Ventana de `price_history` que se lee, en días corridos.
 *
 * `price_history` guarda un cierre por rueda, así que los días corridos se
 * convierten a ~5/7. Lo que manda es el retorno de 90 días: para tenerlo hace
 * falta la barra de hace ~62 ruedas MÁS la de hoy, y 90 días corridos dan
 * justo ~62 — un feriado o un día que el CRON no escribió y el retorno sale
 * null para todos. 120 corridos dan ~85 ruedas, que cubren con margen los tres
 * retornos, la SMA50 y el MACD.
 */
const HISTORY_DAYS = 120
/**
 * Ventana de la tendencia y la volatilidad, en días corridos.
 *
 * Sigue siendo 30 aunque la consulta traiga 120: el prompt dice "30d" y "vol
 * de los últimos 30 días", así que estirarlas cambiaría en silencio lo que el
 * asesor cree estar leyendo. Los indicadores usan la serie larga; la tendencia
 * y la volatilidad, el tramo corto.
 */
const TREND_DAYS = 30

/**
 * Cuántas RUEDAS cubre cada plazo del ranking de fuerza relativa.
 *
 * Los retornos se cuentan en barras, no en fechas: la serie tiene un cierre
 * por rueda, así que 7 días corridos son 5 barras, 30 son ~21 y 90 son ~62. La
 * etiqueta que ve el modelo sigue siendo el plazo de calendario, que es como
 * se lee un retorno.
 */
const RETURN_BARS = { d7: 5, d30: 21, d90: 62 }

/**
 * A partir de acá el universo se recorta antes de mandarlo al modelo.
 *
 * Un universo de decenas de activos, cada uno con retornos, ranking e
 * indicadores, son varios miles de tokens de entrada por corrida, y buena
 * parte de esa lista no se va a recomendar nunca. Se mandan los de mejor
 * momentum y los que el usuario tiene, que son los únicos sobre los que puede
 * sugerir vender.
 */
const UNIVERSE_TRIM_OVER = 30
const UNIVERSE_TOP = 20

/** Días de mercado en un año, para anualizar la volatilidad diaria. */
const TRADING_DAYS = 252
/** Menos que esto no alcanza para un desvío que signifique algo. */
const MIN_VOL_SAMPLES = 10

/**
 * Volatilidad realizada anualizada, en %.
 *
 * Reemplaza a la implied volatility de opciones: en BCBA los CEDEARs no tienen
 * opciones listadas (`get_options_chain` devuelve 404 para NVDA, AAPL y MSFT),
 * así que la IV no existe para esta cartera. La volatilidad realizada se saca
 * de `price_history`, que ya se está leyendo para la tendencia de 30 días.
 *
 * Devuelve null si la serie es corta o si hay precios no positivos — un cero
 * en la serie haría explotar el logaritmo.
 */
function realizedVol(prices: number[]): number | null {
  if (prices.length < MIN_VOL_SAMPLES) return null

  const returns: number[] = []
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] <= 0 || prices[i - 1] <= 0) return null
    returns.push(Math.log(prices[i] / prices[i - 1]))
  }
  if (returns.length < 2) return null

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length
  // Muestral (n-1): son una muestra de los retornos, no la población entera.
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1)
  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS) * 100
}

/**
 * Filas por página del histórico.
 *
 * La consulta trae la serie de TODOS los símbolos —cartera y universo— y la
 * API de Supabase corta en 1.000 filas por request. Con ~45 símbolos × ~85
 * ruedas son casi 4.000: sin paginar, PostgREST devolvía las 1.000 más VIEJAS
 * (la consulta ordena ascendente) y todos los indicadores se calculaban sobre
 * precios de hace meses, sin un solo error visible.
 */
const HISTORY_PAGE = 1000
/** Freno de bucle: 30 páginas son 30.000 filas, muy por encima de lo posible. */
const MAX_HISTORY_PAGES = 30

type PriceRow = { symbol: string; close_price: number; recorded_at: string }

/**
 * El histórico completo de la ventana, paginado.
 *
 * Avanza por la cantidad de filas que REALMENTE devolvió cada página, no por
 * el tamaño pedido: si el proyecto tiene configurado un tope más bajo que
 * `HISTORY_PAGE`, esto sigue leyendo desde donde quedó en vez de saltearse el
 * resto. Corta con la primera página vacía.
 */
async function fetchPriceHistory(since: string): Promise<PriceRow[]> {
  const rows: PriceRow[] = []

  for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
    const { data, error } = await db
      .from('price_history')
      .select('symbol, close_price, recorded_at')
      .gte('recorded_at', since)
      // El símbolo desempata: sin un orden total, dos páginas pueden repetir
      // una fila y saltearse otra del mismo día.
      .order('recorded_at')
      .order('symbol')
      .range(rows.length, rows.length + HISTORY_PAGE - 1)

    if (error) {
      console.error('[advisor] price_history:', error.message)
      break
    }
    if (!data?.length) break
    rows.push(...data)
  }

  return rows
}

/**
 * Recorta las compras que romperían los límites de concentración.
 *
 * Es la contraparte dura de lo que el prompt le pide al modelo: acá no se le
 * pregunta, se le aplica. Solo toca `buy` y `add` — vender o rebalancear nunca
 * aumenta una concentración, así que un cap ahí sería una traba sin motivo.
 *
 * Dos aclaraciones sobre la aritmética:
 *
 * 1. El margen se calcula como `(máximo - actual)% × total`, que es lo que
 *    pidió el spec. Es levemente CONSERVADOR: comprar agranda también el
 *    total de la cartera, así que el monto exacto para llegar justo al límite
 *    sería un poco mayor. Errar para el lado de comprar de menos es el lado
 *    correcto del error en una restricción de riesgo.
 * 2. Las recomendaciones se procesan en orden y lo ya asignado se descuenta
 *    del margen de las siguientes. Sin esto, dos compras del mismo sector
 *    pasaban cada una por su lado y juntas rompían el 40%, que es justo lo que
 *    esta función existe para impedir.
 */
function enforcePositionLimits(
  recs: Recommendation[],
  positions: Array<{ symbol: string; sector: string; value: number }>,
  totalValue: number,
  sectorWeights: Map<string, number>,
  universe: Array<{ symbol: string; sector: string }>,
): Recommendation[] {
  if (totalValue <= 0) return recs

  // Lo comprometido por recomendaciones anteriores de esta misma corrida.
  const committedBySymbol = new Map<string, number>()
  const committedBySector = new Map<string, number>()

  return recs.map((rec) => {
    if (rec.action !== 'buy' && rec.action !== 'add') return rec
    if (!rec.suggested_amount_ars) return rec

    const currentPosition = positions.find((p) => p.symbol === rec.symbol)
    const sector = currentPosition?.sector ??
      universe.find((u) => u.symbol === rec.symbol)?.sector ??
      'Desconocido'

    const currentWeight = currentPosition ? (currentPosition.value / totalValue) * 100 : 0
    const maxWeight = currentPosition ? MAX_EXISTING_POSITION_PCT : MAX_NEW_POSITION_PCT
    const currentSectorPct = sectorWeights.get(sector) ?? 0

    const maxByPosition = Math.max(
      0,
      ((maxWeight - currentWeight) / 100) * totalValue - (committedBySymbol.get(rec.symbol) ?? 0),
    )
    const maxBySector = Math.max(
      0,
      currentSectorPct >= MAX_SECTOR_AFTER_BUY_PCT
        ? 0
        : ((MAX_SECTOR_AFTER_BUY_PCT - currentSectorPct) / 100) * totalValue -
          (committedBySector.get(sector) ?? 0),
    )

    const cappedAmount = Math.min(rec.suggested_amount_ars, maxByPosition, maxBySector)

    if (cappedAmount <= 0) {
      // Cuál de los dos límites frenó la compra: decir "la posición Y el
      // sector están al máximo" cuando solo uno lo está es explicarle mal al
      // usuario por qué no puede comprar.
      const motivo = maxByPosition <= 0
        ? `la posición ya pesa ${currentWeight.toFixed(1)}% (máx ${maxWeight}%)`
        : `el sector ${sector} ya pesa ${currentSectorPct.toFixed(0)}% (máx ${MAX_SECTOR_AFTER_BUY_PCT}%)`

      console.warn(
        `[advisor] ${rec.symbol}: bloqueada por límite de ${currentWeight.toFixed(0)}% posición / ${currentSectorPct.toFixed(0)}% sector`,
      )
      return {
        ...rec,
        action: 'hold' as const,
        suggested_amount_ars: null,
        // El título decía "Comprá $X de NVDA" y la acción ahora es hold: en la
        // app se ve el título, así que dejarlo intacto mostraría una orden de
        // compra que el sistema acaba de bloquear.
        title: `Sin margen para ampliar ${rec.symbol}`,
        reasoning: `${rec.reasoning}\n\n⚠️ BLOQUEADA POR LÍMITES: ${motivo}.`,
      }
    }

    committedBySymbol.set(rec.symbol, (committedBySymbol.get(rec.symbol) ?? 0) + cappedAmount)
    committedBySector.set(sector, (committedBySector.get(sector) ?? 0) + cappedAmount)

    if (cappedAmount < rec.suggested_amount_ars) {
      console.log(
        `[advisor] ${rec.symbol}: monto reducido de $${rec.suggested_amount_ars} a $${cappedAmount.toFixed(0)} por límites`,
      )
      return {
        ...rec,
        suggested_amount_ars: Math.round(cappedAmount),
        reasoning: `${rec.reasoning}\n\nNota: monto ajustado de ${fmtArs(rec.suggested_amount_ars)} a ${fmtArs(cappedAmount)} por límites de concentración.`,
      }
    }

    return rec
  })
}

/** El benchmark contra el que se mide el alpha. Ver la 0038. */
const BENCHMARK = 'SPY'

/** Cuántas recomendaciones ya evaluadas se miran para armar el historial. */
const TRACK_RECORD_SIZE = 20
/** Cuántos errores se le muestran al modelo. Es un resumen, no un expediente. */
const WORST_MISSES = 3
/** A partir de cuántas fallas un símbolo entra en la lista de reincidentes. */
const REPEATED_ERROR_MIN = 2

type PastResult = {
  action: string
  symbol: string
  confidence: string | null
  time_horizon: string | null
  outcome_verdict: string | null
  outcome_pct: number | null
  outcome_7d_verdict: string | null
  alpha_30d: number | null
  alpha_7d: number | null
}

type TrackRecord = {
  total: number
  correctas: number
  incorrectas: number
  neutrales: number
  accuracy: string | null
  worstMisses: string[]
  repeatedErrors: string[]
  /** Acierto a 7 días de las recomendaciones short-term, y sobre cuántas. */
  accuracy7d: string | null
  judged7d: number
  /** Alpha promedio vs SPY. Null hasta que haya alguna evaluación con alpha. */
  alphaAvg30d: string | null
  alphaAvg7d: string | null
}

/**
 * El historial de aciertos, resumido.
 *
 * El accuracy se mide sobre las recomendaciones que el precio pudo JUZGAR
 * —correctas más incorrectas—, no sobre el total. `evaluate-recommendations`
 * marca como 'neutral' todo `hold` y todo `rebalance` (no se juzgan por el
 * precio de un solo activo) y también los movimientos menores al 3%. Como la
 * REGLA #0 del prompt empuja justamente a devolver `hold` cuando no hay nada
 * que hacer, meterlos en el denominador haría que acertar seguido igual diera
 * menos de 50% — y el propio prompt le pide al modelo que baje la confianza
 * debajo de ese número. Sería castigarlo por cumplir la primera regla.
 *
 * Los tres conteos van igual al contexto, así que el modelo ve cuántas fueron
 * neutrales y sobre qué base está calculado el porcentaje.
 *
 * Devuelve undefined si todavía no hay nada evaluado: sin datos, la sección no
 * se arma y el asesor trabaja como antes.
 */
function buildTrackRecord(rows: PastResult[]): TrackRecord | undefined {
  const countOf = (verdict: string) => rows.filter((r) => r.outcome_verdict === verdict).length
  const correctas = countOf('correcta')
  const incorrectas = countOf('incorrecta')
  const neutrales = countOf('neutral')
  const total = correctas + incorrectas + neutrales
  if (total === 0) return undefined

  const judged = correctas + incorrectas
  const accuracy = judged > 0 ? ((correctas / judged) * 100).toFixed(0) : null

  // Un verdict 'incorrecta' siempre se escribió junto con su outcome_pct, pero
  // el filtro evita que una fila a medio escribir imprima "undefined%".
  const misses = rows.filter(
    (r) => r.outcome_verdict === 'incorrecta' && Number.isFinite(Number(r.outcome_pct)),
  )

  const worstMisses = [...misses]
    .sort((a, b) => Math.abs(Number(b.outcome_pct)) - Math.abs(Number(a.outcome_pct)))
    .slice(0, WORST_MISSES)
    .map((r) => {
      const pct = Number(r.outcome_pct)
      return `${r.action} ${r.symbol} → ${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`
    })

  const missesBySymbol = new Map<string, number>()
  for (const r of misses) {
    missesBySymbol.set(r.symbol, (missesBySymbol.get(r.symbol) ?? 0) + 1)
  }
  const repeatedErrors = [...missesBySymbol.entries()]
    .filter(([, n]) => n >= REPEATED_ERROR_MIN)
    .sort((a, b) => b[1] - a[1])
    .map(([symbol, n]) => `${symbol} (${n} veces)`)

  // Acierto de corto plazo: las que el modelo marcó como short-term ("1-4
  // semanas"), medidas a 7 días. La comparación contra el acierto a 30 días es
  // lo único que le dice si sus tesis cortas valen lo mismo que las largas —
  // hasta la 0037 las cortas se juzgaban al mes, cuando ya habían vencido.
  const short = rows.filter((r) => r.time_horizon === 'short')
  const correctas7d = short.filter((r) => r.outcome_7d_verdict === 'correcta').length
  const judged7d = correctas7d + short.filter((r) => r.outcome_7d_verdict === 'incorrecta').length
  const accuracy7d = judged7d > 0 ? ((correctas7d / judged7d) * 100).toFixed(0) : null

  // Alpha promedio contra SPY. Solo promedia las que TIENEN alpha: las
  // anteriores a la 0038 y las que no tomaron exposición (sell, trim, hold,
  // rebalance) vienen en null y no entran ni como cero — un cero diría "empató
  // con el mercado", que es una afirmación distinta de "no se midió".
  const avgAlpha = (values: Array<number | null>): string | null => {
    const usable = values.filter((v): v is number => v !== null && Number.isFinite(Number(v)))
    if (!usable.length) return null
    const mean = usable.reduce((s, v) => s + Number(v), 0) / usable.length
    return mean.toFixed(1)
  }

  return {
    total,
    correctas,
    incorrectas,
    neutrales,
    accuracy,
    worstMisses,
    repeatedErrors,
    accuracy7d,
    judged7d,
    alphaAvg30d: avgAlpha(rows.map((r) => r.alpha_30d)),
    alphaAvg7d: avgAlpha(rows.map((r) => r.alpha_7d)),
  }
}

Deno.serve(async (req) => {
  // El preflight va PRIMERO: llega sin Authorization, así que cualquier chequeo
  // antes de esto lo rechaza y el browser nunca ve los headers de CORS
  const pre = preflight(req)
  if (pre) return pre

  // Dos caminos: el cron con la service role key, y el botón de la app con el
  // JWT del usuario. El segundo existe para que "¿en qué lo pongo?" pueda
  // pedir un análisis en el momento en vez de mostrar que no hay ninguno.
  const fromCron = isServiceRole(req)
  const callerId = fromCron ? null : userIdFromJwt(req)
  if (!fromCron && !callerId) return jsonWithCors({ error: 'No autorizado' }, { status: 401 })

  // Chequeo barato ANTES de gastar: si la tabla destino no existe, la llamada a
  // Opus se paga igual y el resultado se tira. Ya pasó una vez.
  const { error: schemaError } = await db.from('recommendations').select('id').limit(1)
  if (schemaError) {
    return jsonWithCors(
      { error: `No se puede escribir en recommendations: ${schemaError.message}. ¿Corriste 0009_advisor.sql?` },
      { status: 500 },
    )
  }

  // Un pedido a mano analiza solo al que pregunta; el cron, a todos
  const usersQuery = db.from('users').select('id, settings, push_subscription')
  const { data: users } = await (callerId ? usersQuery.eq('id', callerId) : usersQuery)

  const results: Record<string, unknown> = {}

  for (const user of users ?? []) {
    // ---------- Freno de costo del camino a pedido ----------
    if (callerId) {
      const { data: recent } = await db
        .from('recommendations')
        .select('created_at')
        .eq('user_id', user.id)
        .is('goal_id', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (recent?.created_at) {
        const elapsed = Date.now() - new Date(recent.created_at).getTime()
        if (elapsed < ON_DEMAND_COOLDOWN_MINUTES * 60_000) {
          const wait = Math.ceil((ON_DEMAND_COOLDOWN_MINUTES * 60_000 - elapsed) / 60_000)
          return jsonWithCors(
            { error: `El asesor analizó hace poco. Probá de nuevo en ${wait} minutos.` },
            { status: 429 },
          )
        }
      }
    }

    // ---------- Fuera del mercado no se gasta ----------
    // Analizar con la rueda cerrada paga tokens por una recomendación que no se
    // puede ejecutar hasta el otro día, cuando los precios ya cambiaron.
    const gate = canUseAI(user.settings as { allow_ai_after_hours?: boolean })
    if (!gate.allowed) {
      if (callerId) return jsonWithCors({ error: gate.reason }, { status: 400 })
      results[user.id] = { skipped: 'mercado cerrado' }
      continue
    }

    // ---------- Sin key propia no hay asesor ----------
    // No es un error: la app anda igual, solo sin las funciones de IA.
    const apiKey = await getUserApiKey(db, user.id)
    if (!apiKey) {
      const detail = { skipped: 'sin API key de Anthropic configurada' }
      if (callerId) return jsonWithCors({ error: 'Cargá tu API key de Anthropic en Configuración para usar el asesor.' }, { status: 400 })
      results[user.id] = detail
      continue
    }

    // Las dos corridas diarias son una PROMESA que la app muestra en pantalla
    // (los horarios en verde de Oportunidades). Acá había un corte por "pocas
    // noticias nuevas" que la rompía en silencio: la corrida de las 12:00 se
    // salteaba y el usuario se quedaba mirando un horario en verde que nunca
    // corrió. Los precios y la cartera cambian aunque no haya titulares, y son
    // 2 corridas por día pagadas por el propio usuario — el corte ahorraba
    // centavos a cambio de incumplir lo prometido.

    // ---------- Contexto ----------
    const [{ data: positions }, { data: balance }, { data: news }, { data: universe }, history] =
      await Promise.all([
        db
          .from('positions')
          .select(
            'symbol, sector, asset_type, rescue_time, quantity, current_price, previous_close, market_value, gain_pct',
          )
          .eq('user_id', user.id),
        db.from('account_balance').select('available_ars, available_to_trade_ars').eq('user_id', user.id).maybeSingle(),
        // El análisis vive en news_analysis, por usuario, desde la 0023. Leer
        // las columnas globales de `news` acá era leer columnas muertas: el
        // contexto de noticias llegaba vacío al modelo.
        db
          .from('news_analysis')
          .select('summary, sentiment, related_symbols, news(title)')
          .eq('user_id', user.id)
          .in('impact_level', ['high', 'medium'])
          .order('created_at', { ascending: false })
          .limit(NEWS_CONTEXT),
        db.from('asset_metadata').select('symbol, display_name, sector').eq('suggestable', true),
        // Sin filtro por símbolo a propósito: trae la serie de la cartera Y la
        // del universo sugerible, que es lo que permite rankearlos juntos.
        fetchPriceHistory(new Date(Date.now() - HISTORY_DAYS * 864e5).toISOString().slice(0, 10)),
      ])

    if (!positions?.length || !universe?.length) {
      results[user.id] = { error: 'faltan posiciones o universo' }
      continue
    }

    const settings = (user.settings ?? {}) as UserSettings
    const valueOf = (p: { market_value: number | null; quantity: number; current_price: number }) =>
      p.market_value || p.quantity * p.current_price
    const totalValue = positions.reduce((s, p) => s + valueOf(p), 0)
    // disponibleOperar es lo que se puede ejecutar de verdad; available_ars
    // puede incluir plata que todavía no liquidó
    const availableCash = balance?.available_to_trade_ars ?? balance?.available_ars ?? 0

    // Dos ventanas sobre la misma consulta: la larga para los indicadores, la
    // de 30 días para la tendencia y la volatilidad, que el prompt nombra por
    // su plazo. La consulta viene ordenada por fecha, así que las dos series
    // quedan de más vieja a más nueva, que es como las esperan los cálculos.
    const trendCutoff = new Date(Date.now() - TREND_DAYS * 864e5).toISOString().slice(0, 10)
    const seriesBySymbol = new Map<string, number[]>()
    const trendSeriesBySymbol = new Map<string, number[]>()
    for (const row of history) {
      const list = seriesBySymbol.get(row.symbol) ?? []
      list.push(row.close_price)
      seriesBySymbol.set(row.symbol, list)

      if (row.recorded_at >= trendCutoff) {
        const recent = trendSeriesBySymbol.get(row.symbol) ?? []
        recent.push(row.close_price)
        trendSeriesBySymbol.set(row.symbol, recent)
      }
    }

    const priceBySymbol = new Map(positions.map((p) => [p.symbol, p.current_price]))
    const sectorTotals = new Map<string, number>()
    for (const p of positions) sectorTotals.set(p.sector, (sectorTotals.get(p.sector) ?? 0) + valueOf(p))

    // Composición por tipo: es lo que le permite ver que hay una porción
    // grande en fondos comunes mientras el objetivo es que la cartera crezca
    const typeTotals = new Map<string, number>()
    for (const p of positions) {
      typeTotals.set(p.asset_type, (typeTotals.get(p.asset_type) ?? 0) + valueOf(p))
    }

    // El piso de liquidez: efectivo más lo que rescata en el día. Es lo que
    // hace que "si necesitás efectivo" funcione y lo que financia las metas
    // con fecha cercana, así que el asesor no puede proponer tocarlo.
    // Solo money market de verdad. El plazo de rescate NO alcanza: PCOMAGB
    // rescata T+0 y es un fondo de commodities, con +15,85% acumulado — eso
    // no es caja, es un activo de riesgo que además se puede vender rápido.
    //
    // Va en su propia consulta porque `universe` filtra por `suggestable`, y
    // los FCI están en false: leerlo de ahí daría un conjunto vacío.
    const { data: cashFunds } = await db
      .from('asset_metadata')
      .select('symbol')
      .eq('is_cash_equivalent', true)

    const cashEquivalents = new Set((cashFunds ?? []).map((u) => u.symbol))
    const sameDayFunds = positions
      .filter((p) => cashEquivalents.has(p.symbol))
      .reduce((sum, p) => sum + valueOf(p), 0)

    // Lo líquido de hoy, y el piso que hay que MANTENER. No son lo mismo:
    // igualarlos —como hacía la 0016— dejaba cero margen para rotar y la
    // instrucción de rotar a crecimiento nunca podía ejecutarse.
    const liquidNow = availableCash + sameDayFunds
    const liquidityFloor = totalValue * ((settings.liquidity_floor_pct ?? 15) / 100)

    const heldSymbols = positions.map((p) => p.symbol)

    // ---------- Antigüedad, movimiento esperado y prima cambiaria ----------
    // Los tres alimentan reglas del prompt que sin el dato no pueden evaluarse:
    // los 14 días de una posición nueva, el riesgo de recomendar contra un
    // earnings, y si el CEDEAR está caro en pesos.
    const [{ data: buys }, { data: earnings }, { data: quotes }, { data: mepRate }] = await Promise.all([
      // `kind`, NO `side`: en fetch-transactions los dividendos también se
      // guardan con side='buy', y como acá interesa la operación MÁS VIEJA,
      // un dividendo viejo se haría pasar por la compra original.
      db
        .from('transactions')
        .select('symbol, executed_at')
        .eq('user_id', user.id)
        .eq('kind', 'buy')
        .in('symbol', heldSymbols)
        .order('executed_at', { ascending: true }),
      db
        .from('earnings_calendar')
        .select('symbol, report_date')
        .in('symbol', heldSymbols)
        .eq('is_reported', false)
        .gte('report_date', new Date().toISOString().slice(0, 10))
        .order('report_date', { ascending: true }),
      // Cartera Y universo sugerible: la prima sirve sobre todo para decidir
      // una COMPRA, y lo que se compra sale del universo, no de lo que ya tenés.
      db
        .from('market_quotes')
        // `price` es para el benchmark: SPY entra en esta misma consulta
        // porque es sugerible, así que su cotización sale sin pedir una query
        // aparte.
        .select('symbol, implied_fx, price')
        .in('symbol', [...new Set([...heldSymbols, ...universe.map((u) => u.symbol)])]),
      db
        .from('dollar_rates')
        .select('sell_price')
        .eq('rate_type', 'mep')
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    // Ambas listas vienen ordenadas ascendente, así que la primera aparición de
    // cada símbolo ya es la que interesa: la compra más vieja y el earnings más
    // próximo.
    const positionAges: Record<string, number> = {}
    for (const t of buys ?? []) {
      if (t.symbol && !(t.symbol in positionAges)) {
        positionAges[t.symbol] = Math.floor((Date.now() - new Date(t.executed_at).getTime()) / 864e5)
      }
    }

    const earningsInDays = new Map<string, number>()
    for (const e of earnings ?? []) {
      if (!earningsInDays.has(e.symbol)) {
        earningsInDays.set(e.symbol, Math.ceil((new Date(e.report_date).getTime() - Date.now()) / 864e5))
      }
    }

    const expectedMove: Record<string, { vol30d: number; earningsInDays?: number }> = {}
    for (const p of positions) {
      const vol = realizedVol(trendSeriesBySymbol.get(p.symbol) ?? [])
      if (vol === null) continue
      const days = earningsInDays.get(p.symbol)
      expectedMove[p.symbol] = { vol30d: vol, ...(days !== undefined ? { earningsInDays: days } : {}) }
    }

    // ---------- Indicadores técnicos ----------
    // Sobre la cartera Y sobre el universo sugerible: el RSI en sobrecompra es
    // sobre todo un freno de COMPRA, y lo que se compra sale del universo.
    //
    // El precio de referencia para comparar contra las medias es el actual
    // cuando lo hay; para un activo del universo que no está en cartera no lo
    // hay, y ahí sirve el último cierre de la serie.
    const comparableSymbols = [...new Set([...heldSymbols, ...universe.map((u) => u.symbol)])]

    const indicators: Record<string, Technicals> = {}
    for (const symbol of comparableSymbols) {
      const t = technicals(seriesBySymbol.get(symbol) ?? [], priceBySymbol.get(symbol) ?? null)
      if (t) indicators[symbol] = t
    }

    // ---------- Fuerza relativa ----------
    // La cartera se rankea JUNTO con el universo, en una sola lista: un "#3"
    // solo dice algo si el conjunto comparado es el mismo, y la regla de
    // revisar la tesis de lo que quedó en el fondo mira las dos listas.
    const returnsBySymbol = new Map(
      comparableSymbols.map((symbol) => {
        const serie = seriesBySymbol.get(symbol) ?? []
        return [symbol, {
          symbol,
          ret7d: periodReturn(serie, RETURN_BARS.d7),
          ret30d: periodReturn(serie, RETURN_BARS.d30),
          ret90d: periodReturn(serie, RETURN_BARS.d90),
        }]
      }),
    )

    const ranking = relativeStrengthRank([...returnsBySymbol.values()])
    const relativeStrength: Record<string, RelativeStrength> = {}
    for (const r of ranking) {
      const rets = returnsBySymbol.get(r.symbol)!
      relativeStrength[r.symbol] = {
        ret7d: rets.ret7d,
        ret30d: rets.ret30d,
        ret90d: rets.ret90d,
        rank: r.rank,
        total: ranking.length,
      }
    }

    // Universo recortado: los de mejor momentum más los que el usuario tiene,
    // que son los únicos sobre los que puede sugerir vender. El orden por rank
    // se mantiene, así que lo primero que lee el modelo es lo más fuerte.
    const rankOf = (symbol: string) => relativeStrength[symbol]?.rank ?? Number.MAX_SAFE_INTEGER
    const universeByRank = [...universe].sort((a, b) => rankOf(a.symbol) - rankOf(b.symbol))
    const held = new Set(heldSymbols)
    const sentUniverse =
      universeByRank.length > UNIVERSE_TRIM_OVER
        ? universeByRank.filter((u, i) => i < UNIVERSE_TOP || held.has(u.symbol))
        : universeByRank

    console.log(
      sentUniverse.length < universe.length
        ? `[advisor] universo: ${universe.length} activos, top ${sentUniverse.length} enviados al modelo`
        : `[advisor] universo: ${universe.length} activos, todos enviados al modelo`,
    )

    const mep = mepRate?.sell_price ?? 0
    const dollarPremium: Record<string, { implicit: number; mep: number; premiumPct: number }> = {}
    if (mep > 0) {
      for (const q of quotes ?? []) {
        if (!q.implied_fx || q.implied_fx <= 0) continue
        dollarPremium[q.symbol] = {
          implicit: q.implied_fx,
          mep,
          premiumPct: (q.implied_fx / mep - 1) * 100,
        }
      }
    }

    // ---------- Historial de aciertos ----------
    // Lo que `evaluate-recommendations` viene marcando hace 30 días y hasta
    // ahora no salía de la tabla. Es lo que le permite al asesor calibrar su
    // propia confianza en vez de declararla "high" por costumbre.
    //
    // `goal_id is null` acota a las generales, igual que el resto de las
    // consultas de esta función: los planes de metas los escribe `goal-advisor`
    // con otro prompt y otro contexto, y este asesor no debería cargar —ni
    // acreditarse— aciertos que no son suyos.
    //
    // Entra si tiene ALGUNO de los dos veredictos. Filtrar solo por el de 30
    // días dejaba afuera justo lo que la evaluación a 7 días vino a aportar:
    // una recomendación de hace 10 días ya tiene `outcome_7d_verdict` pero
    // todavía no llegó al mes, así que nunca habría contado.
    //
    // 'sin_precio' ya no se descarta en la consulta sino al contar: un
    // `.neq('outcome_verdict', 'sin_precio')` también descarta las filas con
    // ese campo en NULL —así funciona la comparación con NULL en SQL— y esas
    // son precisamente las evaluadas a 7 días y no a 30.
    const { data: pastResults } = await db
      .from('recommendations')
      .select(
        'action, symbol, confidence, time_horizon, outcome_verdict, outcome_pct, outcome_7d_verdict, alpha_30d, alpha_7d, created_at',
      )
      .eq('user_id', user.id)
      .is('goal_id', null)
      .or('outcome_verdict.not.is.null,outcome_7d_verdict.not.is.null')
      .order('created_at', { ascending: false })
      .limit(TRACK_RECORD_SIZE)

    const trackRecord = buildTrackRecord((pastResults ?? []) as PastResult[])
    if (trackRecord) {
      console.log(
        `[advisor] track record: ${trackRecord.total} evaluadas, ` +
          `${trackRecord.accuracy ?? 's/d'}% accuracy, ` +
          `${trackRecord.worstMisses.length} errores peores` +
          (trackRecord.accuracy7d !== null
            ? `, ${trackRecord.accuracy7d}% a 7d sobre ${trackRecord.judged7d} short-term`
            : '') +
          (trackRecord.alphaAvg30d !== null
            ? `, alpha 30d ${trackRecord.alphaAvg30d}% vs ${BENCHMARK}`
            : ''),
      )
    }

    let analysis
    try {
      analysis = await advise(apiKey, {
        positions: positions.map((p) => ({
          symbol: p.symbol,
          sector: p.sector,
          // El tipo importa para la rotación: el prompt distingue entre rotar
          // desde un FCI y rotar desde un CEDEAR, y sin esto no puede.
          assetType: p.asset_type,
          value: valueOf(p),
          gainPct: p.gain_pct ?? 0,
          dayPct:
            p.previous_close > 0 ? ((p.current_price - p.previous_close) / p.previous_close) * 100 : 0,
          weight: totalValue > 0 ? (valueOf(p) / totalValue) * 100 : 0,
          trend30d: trend(trendSeriesBySymbol.get(p.symbol) ?? []),
        })),
        totalValue,
        availableCash,
        news: (news ?? []).map((n) => ({
          title: (n.news as unknown as { title: string } | null)?.title ?? '',
          summary: n.summary ?? '',
          sentiment: n.sentiment ?? 'neutral',
          symbols: n.related_symbols ?? [],
        })),
        universe: sentUniverse.map((u) => ({
          symbol: u.symbol,
          name: u.display_name ?? u.symbol,
          sector: u.sector,
          price: priceBySymbol.get(u.symbol) ?? null,
        })),
        settings: toAdvisorSettings(settings),
        // Sin el perfil, todas las ramas `isAggressive` del prompt dan false y
        // se arma la variante MODERADA: por eso el asesor recomendaba comprar
        // defensivos a alguien cuyo objetivo es maximizar crecimiento.
        profile: await buildInvestorProfile(db, user.id, settings),
        sectorWeights: [...sectorTotals.entries()].map(([sector, v]) => ({
          sector,
          pct: totalValue > 0 ? (v / totalValue) * 100 : 0,
        })),
        typeWeights: [...typeTotals.entries()].map(([type, v]) => ({
          type,
          value: v,
          pct: totalValue > 0 ? (v / totalValue) * 100 : 0,
        })),
        liquidityFloor,
        liquidNow,
        positionAges,
        expectedMove,
        dollarPremium,
        indicators,
        relativeStrength,
        universeTotal: universe.length,
        trackRecord,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      results[user.id] = { error: message }
      console.error('[advisor]', message)
      continue
    }

    await markApiKeyUsed(db, user.id)
    const { recommendations, usage } = analysis
    if (!recommendations.length) {
      results[user.id] = { recommendations: 0, usage }
      continue
    }

    // ---------- Límites duros de concentración ----------
    // Van ANTES del cap de efectivo: primero cuánto tiene sentido comprar de
    // ese activo, y recién después cuánta plata hay. Al revés, el límite de
    // concentración se aplicaría sobre un monto ya recortado por el efectivo y
    // el resultado dependería de cuál de los dos apretaba más fuerte.
    //
    // `sectorTotals` guarda PESOS, no porcentajes: pasarlo tal cual compararía
    // $3.400.000 contra un límite de 40 y bloquearía absolutamente todo.
    const sectorPcts = new Map(
      [...sectorTotals.entries()].map(([sector, v]) => [sector, (v / totalValue) * 100]),
    )
    const sized = enforcePositionLimits(
      recommendations,
      positions.map((p) => ({ symbol: p.symbol, sector: p.sector, value: valueOf(p) })),
      totalValue,
      sectorPcts,
      universe.map((u) => ({ symbol: u.symbol, sector: u.sector })),
    )

    // ---------- Precio del benchmark al momento de recomendar ----------
    // Se guarda con la recomendación porque después no se puede reconstruir:
    // `evaluate-recommendations` sabría el cierre del día, pero no a qué hora
    // de la rueda se sugirió. Sin este número no hay alpha.
    //
    // Tres fuentes, de la más fresca a la más vieja: el precio en vivo si SPY
    // está en cartera (lo actualiza `fetch-portfolio` cada 5 minutos), la
    // cotización diaria de `market_quotes`, y el último cierre de la serie.
    const spyPriceAtRec =
      priceBySymbol.get(BENCHMARK) ??
      (quotes ?? []).find((q) => q.symbol === BENCHMARK)?.price ??
      seriesBySymbol.get(BENCHMARK)?.at(-1) ??
      null

    if (spyPriceAtRec === null) {
      console.warn(`[advisor] sin precio de ${BENCHMARK}: las recomendaciones de hoy quedan sin alpha`)
    }

    // El monto sugerido no puede superar el efectivo real, diga lo que diga el
    // modelo: es la única validación que protege plata de verdad.
    const clean = sized.map((r: Recommendation) => {
      const isBuy = r.action === 'buy' || r.action === 'add'
      const amount =
        isBuy && r.suggested_amount_ars
          ? Math.min(r.suggested_amount_ars, availableCash)
          : r.suggested_amount_ars
      const price = priceBySymbol.get(r.symbol) ?? null
      return { ...r, amount, price }
    })

    /**
     * El análisis nuevo REEMPLAZA al anterior completo, no solo a los símbolos
     * que se repiten.
     *
     * Antes se desactivaban únicamente las del mismo símbolo, y quedaban
     * conviviendo sugerencias de corridas distintas. Se vio en datos reales:
     * dos rotaciones de GLD activas al mismo tiempo, una por $500.000 y otra
     * por $138.000, cada una de una corrida diferente. Contradictorias, y sin
     * forma de saber cuál valía.
     *
     * El asesor mira la cartera entera en cada corrida: si no repitió algo que
     * había sugerido antes, es porque ya no lo sugiere. Dejarlo vivo sería
     * inventar una recomendación que el modelo no hizo.
     *
     * `goal_id is null` acota a las generales: los planes de metas tienen su
     * propio ciclo y los renueva `goal-advisor`.
     */
    const { error: staleError } = await db
      .from('recommendations')
      .update({ is_active: false })
      .eq('user_id', user.id)
      .is('goal_id', null)
      .eq('is_active', true)

    // Si esto falla, las viejas quedan mezcladas con las nuevas: se registra en
    // vez de seguir como si nada, que es lo que venía pasando
    if (staleError) console.error('[advisor] no se pudieron cerrar las anteriores:', staleError.message)

    const { data: inserted, error } = await db
      .from('recommendations')
      .insert(
        clean.map((r) => ({
          user_id: user.id,
          action: r.action,
          symbol: r.symbol,
          counterpart_symbol: r.counterpart_symbol,
          title: r.title,
          reasoning: r.reasoning,
          confidence: r.confidence,
          time_horizon: r.time_horizon,
          suggested_amount: r.amount,
          suggested_quantity: r.amount && r.price ? Math.floor(r.amount / r.price) : null,
          realizes_loss: r.realizes_loss,
          price_at_recommendation: r.price,
          spy_price_at_rec: spyPriceAtRec,
          analyzed_with: OPPORTUNITY_MODEL,
          is_active: true,
          expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
        })),
      )
      .select('id, action, symbol, confidence, title')

    if (error) {
      results[user.id] = { error: error.message, usage }
      continue
    }

    // ---------- Notificación: solo alta convicción ----------
    let pushed = 0
    for (const rec of inserted ?? []) {
      if (rec.confidence !== 'high' || rec.action === 'hold') continue
      if (pushed >= MAX_PUSH_PER_RUN) break

      const { data: alert } = await db
        .from('alerts')
        .insert({
          user_id: user.id,
          alert_type: rec.action === 'buy' || rec.action === 'add' ? 'opportunity_buy' : 'advisor_sell',
          symbol: rec.symbol,
          title: rec.title,
          message: `El asesor sugiere ${rec.action === 'buy' ? 'comprar' : rec.action === 'add' ? 'ampliar' : rec.action === 'trim' ? 'reducir' : rec.action === 'sell' ? 'vender' : 'rebalancear'} ${rec.symbol}.`,
          severity: 'opportunity',
          action_suggested: `Ver análisis de ${rec.symbol}`,
        })
        .select('id')
        .single()

      const notifies = (user.settings as Record<string, unknown>)?.notify_opportunities !== false
      if (user.push_subscription && alert && notifies) {
        const ok = await sendPush(db, user.id, user.push_subscription, {
          title: rec.title,
          body: `Convicción alta · ${rec.symbol}`,
          tag: `rec-${rec.id}`,
          url: '/oportunidades',
          alertId: alert.id,
          severity: 'opportunity',
        })
        if (ok) {
          pushed++
          await db.from('alerts').update({ push_sent: true }).eq('id', alert.id)
        }
      }
    }

    results[user.id] = {
      recommendations: inserted?.length ?? 0,
      detail: inserted?.map((r) => `${r.action} ${r.symbol} (${r.confidence})`),
      pushed,
      usage,
    }
  }

  return jsonWithCors({ ok: true, results })
})
