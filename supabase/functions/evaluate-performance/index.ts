/**
 * evaluate-performance — semanal, y a pedido desde la app
 *
 * Responde la pregunta incómoda: ¿esto está funcionando?
 *
 * ── Por qué no alcanza con mirar el valor de la cartera ──────────────────
 *
 * Porque los aportes se ven idénticos a las ganancias. Con un depósito de
 * $1.400.000 sobre una cartera de $100.000, el valor total se multiplica por
 * 15 sin que hayas ganado un peso. Por eso todo el cálculo pasa por el método
 * Modified Dietz, que pondera cada aporte por el tiempo que estuvo invertido.
 *
 * ── Las dos varas ────────────────────────────────────────────────────────
 *
 * 1. El dólar MEP: ¿tu plata compra más dólares que antes? En un país con esta
 *    inflación, ganar 8% en pesos mientras el dólar sube 12% es perder.
 * 2. No hacer nada: se reconstruye la cartera que tenías al inicio del período
 *    y se la valúa a precios de hoy. Si te hubiera ido igual o mejor sin tocar
 *    nada, la app no aportó nada aunque hayas ganado plata. Es la única vara
 *    que mide a la app y no al mercado.
 *
 * ── Qué hace cuando faltan datos ─────────────────────────────────────────
 *
 * NO estima. Devuelve `insufficient_data` con la lista de lo que faltó. Un
 * veredicto construido sobre un aporte que no conocemos es peor que no tener
 * veredicto, porque parece confiable.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isServiceRole, unauthorized } from '../_shared/auth.ts'

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

const DAY = 86_400_000

type Flow = { date: string; amount: number }

/**
 * Modified Dietz: rendimiento de una cartera con entradas y salidas de plata.
 *
 * El denominador pondera cada flujo por la fracción del período que estuvo
 * adentro: plata que entró el último día casi no pudo generar nada, así que
 * casi no cuenta como capital invertido.
 */
function modifiedDietz(
  startValue: number,
  endValue: number,
  flows: Flow[],
  periodStart: Date,
  periodEnd: Date,
): number | null {
  const totalDays = (periodEnd.getTime() - periodStart.getTime()) / DAY
  if (totalDays <= 0) return null

  const netFlows = flows.reduce((sum, f) => sum + f.amount, 0)

  const weighted = flows.reduce((sum, f) => {
    const elapsed = (new Date(f.date).getTime() - periodStart.getTime()) / DAY
    // Un flujo fuera del período no debería llegar acá, pero si llega se
    // acota en vez de generar un peso negativo o mayor a 1.
    const weight = Math.min(1, Math.max(0, (totalDays - elapsed) / totalDays))
    return sum + f.amount * weight
  }, 0)

  const denominator = startValue + weighted
  // Cartera que arrancó en cero y se fondeó el último día: no hay capital
  // invertido del que hablar.
  if (Math.abs(denominator) < 1) return null

  return ((endValue - startValue - netFlows) / denominator) * 100
}

/** MEP más cercano a una fecha, sin extrapolar */
async function mepAt(date: string): Promise<number | null> {
  const { data } = await db
    .from('dollar_rates')
    .select('sell_price, recorded_at')
    .eq('rate_type', 'mep')
    .lte('recorded_at', `${date}T23:59:59-03:00`)
    .order('recorded_at', { ascending: false })
    .limit(1)

  return data?.[0]?.sell_price ?? null
}

async function review(userId: string, periodDays: number) {
  const gaps: string[] = []
  const periodEnd = new Date()
  const periodStart = new Date(periodEnd.getTime() - periodDays * DAY)
  const startDate = periodStart.toISOString().slice(0, 10)
  const endDate = periodEnd.toISOString().slice(0, 10)

  // ── Valuación de las puntas ────────────────────────────────────────────
  // Se toma el primer snapshot en o después del inicio: si la app empezó a
  // guardar después, el período real es más corto y hay que decirlo.
  const { data: startSnap } = await db
    .from('portfolio_snapshots')
    .select('total_value, cash_value, snapshot_date')
    .eq('user_id', userId)
    .gte('snapshot_date', startDate)
    .order('snapshot_date')
    .limit(1)
    .maybeSingle()

  const { data: endSnap } = await db
    .from('portfolio_snapshots')
    .select('total_value, cash_value, snapshot_date')
    .eq('user_id', userId)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!startSnap || !endSnap) {
    return {
      user_id: userId,
      period_start: startDate,
      period_end: endDate,
      start_value: 0,
      end_value: 0,
      verdict: 'insufficient_data',
      verdict_reason:
        'Todavía no hay snapshots diarios suficientes. La app guarda uno por día: ' +
        'el veredicto necesita al menos dos.',
      data_gaps: ['sin snapshots'],
    }
  }

  // El período efectivo es el que cubren los snapshots, no el pedido
  const effectiveStart = new Date(`${startSnap.snapshot_date}T00:00:00-03:00`)
  if (startSnap.snapshot_date > startDate) {
    gaps.push(
      `el período arranca el ${startSnap.snapshot_date}, no el ${startDate}: no hay datos anteriores`,
    )
  }

  const startValue = (startSnap.total_value ?? 0) + (startSnap.cash_value ?? 0)
  const endValue = (endSnap.total_value ?? 0) + (endSnap.cash_value ?? 0)

  // ── Aportes, retiros y dividendos ──────────────────────────────────────
  const { data: movements } = await db
    .from('transactions')
    .select('kind, total, symbol, quantity, executed_at')
    .eq('user_id', userId)
    .gte('executed_at', `${startSnap.snapshot_date}T00:00:00-03:00`)
    .lte('executed_at', `${endDate}T23:59:59-03:00`)

  const deposits = (movements ?? [])
    .filter((m) => m.kind === 'deposit')
    .reduce((s, m) => s + (m.total ?? 0), 0)
  const withdrawals = (movements ?? [])
    .filter((m) => m.kind === 'withdrawal')
    .reduce((s, m) => s + (m.total ?? 0), 0)
  const dividends = (movements ?? [])
    .filter((m) => m.kind === 'dividend')
    .reduce((s, m) => s + (m.total ?? 0), 0)

  const flows: Flow[] = (movements ?? [])
    .filter((m) => m.kind === 'deposit' || m.kind === 'withdrawal')
    .map((m) => ({
      date: m.executed_at,
      amount: m.kind === 'deposit' ? (m.total ?? 0) : -(m.total ?? 0),
    }))

  // Si hay una pregunta de flujo sin responder, el número no es defendible
  const { data: pendingCash } = await db
    .from('alerts')
    .select('id')
    .eq('user_id', userId)
    .eq('alert_type', 'cash_flow_review')
    .eq('is_dismissed', false)
    .limit(1)

  if ((pendingCash ?? []).length) {
    gaps.push('hay un movimiento de dinero sin clasificar: el rendimiento puede estar mal')
  }

  const returnPct = modifiedDietz(startValue, endValue, flows, effectiveStart, periodEnd)
  const netFlows = deposits - withdrawals

  // ── La misma cuenta en dólares ─────────────────────────────────────────
  const mepStart = await mepAt(startSnap.snapshot_date)
  const mepEnd = await mepAt(endDate)

  let returnUsdPct: number | null = null
  if (mepStart && mepEnd) {
    const usdFlows: Flow[] = flows.map((f) => ({
      date: f.date,
      // Aproximación explícita: se usa el MEP del cierre del período para los
      // flujos. Con un flujo grande al principio esto subestima el aporte en
      // dólares. Traer el MEP de cada día sería más exacto pero cambia poco
      // el veredicto y multiplica las consultas.
      amount: f.amount / mepEnd,
    }))
    returnUsdPct = modifiedDietz(
      startValue / mepStart,
      endValue / mepEnd,
      usdFlows,
      effectiveStart,
      periodEnd,
    )
  } else {
    gaps.push('sin cotización MEP para alguna de las puntas: no se pudo medir en dólares')
  }

  // ── El contrafáctico: no haber tocado nada ─────────────────────────────
  const { data: positions } = await db
    .from('positions')
    .select('symbol, quantity, current_price')
    .eq('user_id', userId)

  // Cantidad al inicio = cantidad de hoy − lo comprado + lo vendido
  const qtyAtStart = new Map<string, number>()
  for (const p of positions ?? []) qtyAtStart.set(p.symbol, p.quantity)

  for (const m of movements ?? []) {
    if (!m.symbol || !m.quantity) continue
    const delta =
      m.kind === 'buy' || m.kind === 'fci_subscription'
        ? -m.quantity
        : m.kind === 'sell' || m.kind === 'fci_redemption'
          ? m.quantity
          : 0
    if (delta) qtyAtStart.set(m.symbol, (qtyAtStart.get(m.symbol) ?? 0) + delta)
  }

  const priceToday = new Map<string, number>(
    (positions ?? []).map((p) => [p.symbol, p.current_price ?? 0]),
  )

  // Un símbolo que vendiste entero durante el período ya no está en
  // `positions`, así que su precio de hoy sale de las cotizaciones del universo
  const orphans = [...qtyAtStart.keys()].filter((s) => !priceToday.has(s))
  if (orphans.length) {
    const { data: quotes } = await db
      .from('market_quotes')
      .select('symbol, price')
      .in('symbol', orphans)
    for (const q of quotes ?? []) priceToday.set(q.symbol, q.price)
  }

  let holdValue = startSnap.cash_value ?? 0
  const missingPrices: string[] = []

  for (const [symbol, qty] of qtyAtStart) {
    if (qty <= 0) continue
    const price = priceToday.get(symbol)
    if (!price) {
      missingPrices.push(symbol)
      continue
    }
    holdValue += qty * price
  }

  // El contrafáctico recibe los mismos aportes, pero quietos en efectivo
  holdValue += netFlows

  let holdReturnPct: number | null = null
  if (missingPrices.length) {
    gaps.push(`sin precio de hoy para ${missingPrices.join(', ')}: el contrafáctico quedó incompleto`)
  } else {
    holdReturnPct = modifiedDietz(startValue, holdValue, flows, effectiveStart, periodEnd)
  }

  // ── Veredicto ──────────────────────────────────────────────────────────
  let verdict = 'insufficient_data'
  let reason = ''

  if (returnPct === null) {
    reason = 'No se pudo calcular el rendimiento con los datos disponibles.'
  } else if (returnUsdPct === null || holdReturnPct === null) {
    reason =
      'El rendimiento se calculó, pero falta una de las dos varas de comparación. ' +
      'Sin las dos no hay veredicto: ver el detalle de qué faltó.'
  } else {
    const beatDollar = returnUsdPct > 0
    const beatHolding = returnPct > holdReturnPct

    verdict = beatDollar && beatHolding ? 'ok' : beatDollar || beatHolding ? 'mixed' : 'bad'

    const dollarPart = beatDollar
      ? `ganaste ${returnUsdPct.toFixed(1)}% en dólares`
      : `perdiste ${Math.abs(returnUsdPct).toFixed(1)}% en dólares`
    const holdPart = beatHolding
      ? `le sacaste ${(returnPct - holdReturnPct).toFixed(1)} puntos a no haber hecho nada`
      : `no haber tocado nada rendía ${(holdReturnPct - returnPct).toFixed(1)} puntos más`

    reason = `${dollarPart[0].toUpperCase()}${dollarPart.slice(1)} y ${holdPart}.`
  }

  return {
    user_id: userId,
    period_start: startSnap.snapshot_date,
    period_end: endDate,
    start_value: startValue,
    end_value: endValue,
    net_flows: netFlows,
    deposits,
    withdrawals,
    dividends,
    return_pct: returnPct,
    return_amount: endValue - startValue - netFlows,
    return_usd_pct: returnUsdPct,
    mep_start: mepStart,
    mep_end: mepEnd,
    hold_value: missingPrices.length ? null : holdValue,
    hold_return_pct: holdReturnPct,
    verdict,
    verdict_reason: reason,
    data_gaps: gaps.length ? gaps : null,
  }
}

Deno.serve(async (req) => {
  if (!isServiceRole(req)) return unauthorized()

  const { data: users, error } = await db.from('users').select('id, settings')
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const results: Record<string, unknown> = {}

  for (const user of users ?? []) {
    try {
      const days = Number((user.settings as Record<string, unknown>)?.review_period_days) || 30
      const row = await review(user.id, days)

      // `review` devuelve dos formas distintas de fila según haya datos o no, y
      // el genérico de PostgREST infiere la más angosta: `data_gaps: null` no
      // le entra aunque la columna sea nullable. Es ruido de tipos, no un
      // problema de runtime — pero el ruido es lo que escondió el
      // `STALE_SYNC_HOURS` que faltaba en evaluate-alerts, así que se silencia
      // en el punto exacto en vez de dejarlo tapando el resto.
      const { error: saveError } = await db
        .from('performance_reviews')
        .upsert(row as Record<string, unknown>, {
          onConflict: 'user_id,period_start,period_end',
        })
      if (saveError) throw saveError

      results[user.id] = row
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      results[user.id] = { error: message }
      console.error(`[evaluate-performance] ${user.id}:`, message)
    }
  }

  return Response.json({ ok: true, results })
})
