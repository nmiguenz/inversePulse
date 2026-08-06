/**
 * evaluate-alerts — se dispara después de fetch-portfolio
 *
 * Evalúa las reglas contra las posiciones actuales, inserta las alertas nuevas
 * y manda el push. Una alerta se considera "nueva" si no hubo otra del mismo
 * tipo y símbolo en las últimas 24hs — si no, cada corrida del CRON (cada 5
 * minutos) generaría la misma alerta 96 veces por día.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isServiceRole, unauthorized } from '../_shared/auth.ts'
import { sendPush, type PushPayload } from '../_shared/push.ts'

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

type Severity = 'critical' | 'warning' | 'info' | 'opportunity'

type Settings = {
  take_profit_pct: number
  stop_loss_pct: number
  rebalance_pct: number
  sector_concentration_pct: number
  daily_extreme_pct: number
  idle_cash_threshold: number
  trailing_stop_pct: number
  trailing_min_gain_pct: number
  rebuy_watch_pct: number
  monitoring_start: string
  monitoring_end: string
  notify_decisions: boolean
  notify_opportunities: boolean
  notify_news: boolean
}

type Position = {
  symbol: string
  description: string | null
  quantity: number
  avg_buy_price: number
  current_price: number
  previous_close: number
  sector: string
  /** Valuación de IOL. quantity * current_price da 100x en bonos. */
  market_value: number | null
  gain_amount: number | null
  gain_pct: number | null
  /** Máximo visto desde que se registra. Base del trailing stop. */
  peak_price: number | null
}

type Candidate = {
  alert_type: string
  symbol: string | null
  title: string
  message: string
  severity: Severity
  action_suggested: string | null
}

const fmt = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
    .format(n)

const pct = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1).replace('.', ',')}%`

/** ¿Estamos dentro del horario de monitoreo del usuario? (hora de Buenos Aires) */
function withinMonitoringHours(settings: Settings): boolean {
  const now = new Date().toLocaleTimeString('en-GB', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
  })
  return now >= (settings.monitoring_start ?? '00:00') && now <= (settings.monitoring_end ?? '23:59')
}

function evaluate(positions: Position[], availableCash: number, s: Settings): Candidate[] {
  const out: Candidate[] = []

  const valueOf = (p: Position) => p.market_value ?? p.quantity * p.current_price
  const total = positions.reduce((sum, p) => sum + valueOf(p), 0)
  if (total === 0) return out

  for (const p of positions) {
    const value = valueOf(p)
    const cost = p.quantity * p.avg_buy_price
    const gainPct = p.gain_pct ?? (cost > 0 ? ((value - cost) / cost) * 100 : 0)
    const gain = p.gain_amount ?? value - cost
    const dayPct = p.previous_close > 0 ? ((p.current_price - p.previous_close) / p.previous_close) * 100 : 0
    const weight = (value / total) * 100

    // ── Trailing stop ──────────────────────────────────────────────────
    // Reemplaza al umbral fijo de toma de ganancia. La diferencia que importa:
    // un umbral fijo no distingue "subió 25% y sigue subiendo" de "subió 25% y
    // se está dando vuelta". Este solo dispara en el segundo caso.
    const peak = p.peak_price ?? 0
    const drawdown = peak > 0 ? ((peak - p.current_price) / peak) * 100 : 0

    if (
      s.trailing_stop_pct > 0 &&
      gainPct >= s.trailing_min_gain_pct &&
      drawdown >= s.trailing_stop_pct
    ) {
      out.push({
        alert_type: 'trailing_stop',
        symbol: p.symbol,
        title: `Vendé ${p.symbol} y tomá ganancias`,
        message:
          `${p.symbol} cedió ${drawdown.toFixed(1).replace('.', ',')}% desde su máximo de ` +
          `${fmt(peak)}. Te llevás ${pct(gainPct)} (${fmt(gain)}).` +
          (Math.abs(dayPct) >= s.daily_extreme_pct
            ? ` Hoy solo cayó ${pct(dayPct)}.`
            : ''),
        severity: 'critical',
        action_suggested: `Vender ${p.symbol}`,
      })
    }

    // El umbral fijo queda como red opcional. En 0 no evalúa, que es el
    // default desde que existe el trailing stop.
    if (s.take_profit_pct > 0 && gainPct >= s.take_profit_pct) {
      out.push({
        alert_type: 'take_profit',
        symbol: p.symbol,
        title: `Vendé ${p.symbol} y tomá ganancias`,
        message: `${p.symbol} acumula ${pct(gainPct)} (${fmt(gain)}). Cruzó tu techo de ${s.take_profit_pct}%.`,
        severity: 'opportunity',
        action_suggested: `Vender ${p.symbol}`,
      })
    }

    if (gainPct <= s.stop_loss_pct) {
      out.push({
        alert_type: 'stop_loss',
        symbol: p.symbol,
        title: `Cortá la pérdida en ${p.symbol}`,
        message: `${p.symbol} cae ${pct(gainPct)} (${fmt(gain)}). Cruzó tu piso de ${s.stop_loss_pct}%.`,
        severity: 'critical',
        action_suggested: `Vender ${p.symbol}`,
      })
    }

    if (Math.abs(dayPct) >= s.daily_extreme_pct) {
      out.push({
        alert_type: 'daily_extreme',
        symbol: p.symbol,
        title: `${p.symbol} se movió ${pct(dayPct)} hoy`,
        message:
          `${p.symbol} ${dayPct > 0 ? 'subió' : 'cayó'} ${pct(dayPct)} en el día. ` +
          `La posición acumula ${pct(gainPct)}.`,
        severity: 'warning',
        action_suggested: null,
      })
    }

    if (weight >= s.rebalance_pct) {
      // Cuántas unidades vender para volver al umbral. Se calcula en proporción
      // sobre la cantidad, no dividiendo por el precio: en bonos el precio es
      // por 100 nominales y la división daría 100x menos unidades.
      const targetValue = total * (s.rebalance_pct / 100)
      const toSell = Math.floor(p.quantity * ((value - targetValue) / value))
      out.push({
        alert_type: 'rebalance',
        symbol: p.symbol,
        title: `Reducí ${p.symbol}: pesa demasiado`,
        message: `${p.symbol} pesa ${weight.toFixed(1)}% de la cartera (umbral ${s.rebalance_pct}%).`,
        severity: 'warning',
        action_suggested: toSell > 0 ? `Vender ${toSell} ${p.symbol}` : null,
      })
    }
  }

  // Concentración por sector
  const bySector = new Map<string, number>()
  for (const p of positions) bySector.set(p.sector, (bySector.get(p.sector) ?? 0) + valueOf(p))

  for (const [sector, value] of bySector) {
    const share = (value / total) * 100
    if (share >= s.sector_concentration_pct) {
      out.push({
        alert_type: 'sector_concentration',
        symbol: null,
        title: `Diversificá fuera de ${sector}`,
        message: `${sector} representa ${share.toFixed(1)}% de la cartera (umbral ${s.sector_concentration_pct}%).`,
        severity: 'warning',
        action_suggested: `Diversificar fuera de ${sector}`,
      })
    }
  }

  if (availableCash >= s.idle_cash_threshold) {
    out.push({
      alert_type: 'idle_cash',
      symbol: null,
      title: 'Poné a trabajar tu efectivo',
      message: `Tenés ${fmt(availableCash)} parados en la cuenta, sin rendir nada.`,
      severity: 'info',
      action_suggested: 'Suscribir a un FCI money market o comprar',
    })
  }

  return out
}

/**
 * Todo lo que evalúa esta función es una DECISIÓN: cruzaste un umbral y hay que
 * ver si hacés algo. Por eso una sola categoría alcanza.
 *
 * Antes se decidía por severidad, lo que metía en la misma bolsa un stop loss y
 * una noticia negativa (ambos "warning") aunque uno pida acción y el otro no.
 */
function shouldNotify(s: Settings): boolean {
  return s.notify_decisions !== false
}

// ============================================================
// Recompra
// ============================================================

/**
 * Avisa cuando algo que vendiste quedó más barato que tu precio de venta.
 *
 * IMPORTANTE, y es una decisión de diseño, no una limitación técnica: el aviso
 * dice un HECHO —"está 12% abajo de lo que cobraste"— y nada más. No dice que
 * va a subir, porque eso no lo sabe nadie. Una app que afirma con seguridad
 * hacia dónde va un precio es peligrosa justamente porque suena confiable, y el
 * juicio de si la tesis sigue en pie es del usuario.
 */
async function evaluateRebuys(userId: string, s: Settings) {
  const threshold = s.rebuy_watch_pct ?? 10
  if (threshold <= 0) return []

  const { data: watch } = await db
    .from('sell_watch')
    .select('id, symbol, sold_price, sold_at')
    .eq('user_id', userId)
    .eq('is_active', true)
    .is('alerted_at', null)

  if (!watch?.length) return []

  // El precio de hoy sale de las cotizaciones del universo, que cubren tanto
  // lo que tenés como lo que no — que es justamente el caso acá
  const { data: quotes } = await db
    .from('market_quotes')
    .select('symbol, price')
    .in('symbol', watch.map((w) => w.symbol))

  const priceBySymbol = new Map((quotes ?? []).map((q) => [q.symbol, q.price]))
  const out: Array<Record<string, unknown>> = []

  for (const w of watch) {
    const price = priceBySymbol.get(w.symbol)
    if (!price || !w.sold_price) continue

    const drop = ((w.sold_price - price) / w.sold_price) * 100
    if (drop < threshold) continue

    const soldOn = new Date(w.sold_at).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
    })

    out.push({
      alert_type: 'rebuy_watch',
      symbol: w.symbol,
      severity: 'opportunity',
      title: `${w.symbol} está ${drop.toFixed(0)}% más barato que cuando vendiste`,
      message:
        `Lo vendiste a ${fmt(w.sold_price)} el ${soldOn} y hoy está a ${fmt(price)}. ` +
        `Si tu tesis sobre la empresa sigue en pie, es una oportunidad de recomprar más barato. ` +
        `Si vendiste porque la tesis se rompió, esto no cambia nada.`,
      action_suggested: `Evaluar recompra de ${w.symbol}`,
    })

    // Una vez por venta: si no, avisaría todos los días mientras siga abajo
    await db.from('sell_watch').update({ alerted_at: new Date().toISOString() }).eq('id', w.id)
  }

  return out
}

// ============================================================
// Metas
// ============================================================

/**
 * Último día en que se puede vender para tener el dinero acreditado en `date`.
 *
 * Primero se apoya en el último día hábil ≤ la fecha, y recién ahí resta los
 * días de liquidación. Sin ese paso, una fecha objetivo en fin de semana daba
 * una respuesta tarde: para el sábado 26/9 devolvía "jueves 24", pero una venta
 * del jueves liquida el lunes 28 — dos días después del cumpleaños.
 */
function lastSellDate(date: string, settlementDays: number): string {
  const d = new Date(`${date}T12:00:00-03:00`)

  // Si la fecha cae fin de semana, el dinero tiene que estar el viernes
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1)

  let left = settlementDays
  while (left > 0) {
    d.setDate(d.getDate() - 1)
    if (d.getDay() !== 0 && d.getDay() !== 6) left--
  }
  return d.toISOString().slice(0, 10)
}

function daysUntilDate(date: string | null): number | null {
  if (!date) return null
  const target = new Date(`${date}T12:00:00-03:00`).getTime()
  if (Number.isNaN(target)) return null
  const today = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  })
  return Math.round((target - new Date(`${today}T12:00:00-03:00`).getTime()) / 864e5)
}

/**
 * Avisos de las metas.
 *
 * Van aparte del resto porque el dedupe es distinto: `goal_reached` tiene que
 * dispararse UNA vez en la vida de la meta, no una cada 24hs como las alertas
 * de precio. Y se deduplica por `goal_id`, no por símbolo — una meta no tiene
 * símbolo, y sin eso dos metas alcanzadas el mismo día generarían un solo
 * aviso.
 *
 * La meta NO se cierra al alcanzarse: se sigue acumulando, que es lo que se
 * pidió. Lo único que cambia es de qué avisa — de "no llegás" pasa a "cuidá lo
 * que ya tenés".
 */
async function evaluateGoals(userId: string) {
  const { data: goals } = await db
    .from('goal_summary')
    .select('id, name, target_amount, target_date, current_value, reached_at, derisk_days')
    .eq('user_id', userId)
    .not('target_amount', 'is', null)

  if (!goals?.length) return []

  // Un solo query para el dedupe de todos los tipos y todas las metas
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString()
  const { data: recent } = await db
    .from('alerts')
    .select('alert_type, goal_id, created_at')
    .eq('user_id', userId)
    .not('goal_id', 'is', null)
    .gte('created_at', since)

  const lastSeen = new Map<string, string>()
  for (const a of recent ?? []) {
    const key = `${a.alert_type}|${a.goal_id}`
    if (!lastSeen.has(key)) lastSeen.set(key, a.created_at)
  }
  const firedWithin = (type: string, goalId: string, days: number) => {
    const at = lastSeen.get(`${type}|${goalId}`)
    return !!at && Date.now() - new Date(at).getTime() < days * 86_400_000
  }

  const out: Array<Record<string, unknown>> = []

  for (const goal of goals) {
    const target = Number(goal.target_amount)
    const value = Number(goal.current_value)
    const daysLeft = daysUntilDate(goal.target_date)
    const covered = value >= target
    const money = (n: number) =>
      `$${Math.round(n).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`

    // 1. Objetivo alcanzado. Una sola vez: lo marca `reached_at`.
    if (covered && !goal.reached_at) {
      await db
        .from('goal_portfolios')
        .update({ reached_at: new Date().toISOString() })
        .eq('id', goal.id)

      out.push({
        alert_type: 'goal_reached',
        goal_id: goal.id,
        symbol: null,
        severity: 'opportunity',
        title: `Llegaste: ${goal.name}`,
        message:
          `${goal.name} alcanzó ${money(value)}, su objetivo de ${money(target)}. ` +
          `La meta no se cierra: sigue invertida y sumando. Lo que cambia es el riesgo — ` +
          `de acá en más lo que está en juego es perder lo que ya lograste.`,
        action_suggested: 'Ver la meta',
      })
      continue
    }

    // 2. Lo habías alcanzado y retrocediste.
    if (!covered && goal.reached_at && !firedWithin('goal_slipped', goal.id, 7)) {
      out.push({
        alert_type: 'goal_slipped',
        goal_id: goal.id,
        symbol: null,
        severity: 'warning',
        title: `${goal.name} volvió a caer debajo del objetivo`,
        message:
          `Está en ${money(value)} y el objetivo es ${money(target)}: faltan ${money(target - value)}. ` +
          `Ya lo habías alcanzado${daysLeft !== null && daysLeft > 0 ? ` y todavía quedan ${daysLeft} días` : ''}.`,
        action_suggested: 'Revisar la meta',
      })
      continue
    }

    if (daysLeft === null || daysLeft < 0) continue

    // 3. Desarme: tenés el objetivo cubierto y se acerca la fecha.
    if (covered && daysLeft <= (goal.derisk_days ?? 30) && !firedWithin('goal_derisk', goal.id, 7)) {
      // Los CEDEARs liquidan en T+2: para tener la plata EL DÍA de la fecha
      // hay que vender antes, no ese día
      const sellBy = lastSellDate(goal.target_date!, 2)

      out.push({
        alert_type: 'goal_derisk',
        goal_id: goal.id,
        symbol: null,
        severity: 'warning',
        title: `${goal.name}: conviene asegurar lo logrado`,
        message:
          `Tenés ${money(value)} sobre un objetivo de ${money(target)} y faltan ${daysLeft} días. ` +
          `A esta altura el riesgo ya no es no llegar, es perderlo en una caída de última hora. ` +
          `Si vas a necesitar la plata el ${goal.target_date}, vendé como máximo el ${sellBy}: ` +
          `los CEDEARs liquidan en 48 horas hábiles.`,
        action_suggested: 'Pasar a efectivo o algo de rescate inmediato',
      })
      continue
    }

    // 4. Fuera de camino, pero solo cuando todavía se puede hacer algo.
    // Avisar "no llegás" faltando nueve años no sirve para nada.
    if (!covered && daysLeft <= 30 && !firedWithin('goal_off_track', goal.id, 14)) {
      out.push({
        alert_type: 'goal_off_track',
        goal_id: goal.id,
        symbol: null,
        severity: 'warning',
        title: `${goal.name}: faltan ${money(target - value)}`,
        message:
          `Quedan ${daysLeft} días y estás en ${money(value)} de ${money(target)}. ` +
          `Ningún rendimiento razonable cubre esa diferencia en ese plazo: si necesitás el ` +
          `monto completo, la salida es aportar la diferencia o ajustar el objetivo.`,
        action_suggested: 'Aportar o ajustar la meta',
      })
    }
  }

  return out
}

async function evaluateUser(user: { id: string; settings: Settings; push_subscription: unknown }) {
  const [{ data: positions }, { data: balance }] = await Promise.all([
    db
      .from('positions')
      .select(
        'symbol, description, quantity, avg_buy_price, current_price, previous_close, sector, market_value, gain_amount, gain_pct, peak_price',
      )
      .eq('user_id', user.id),
    db.from('account_balance').select('available_ars').eq('user_id', user.id).maybeSingle(),
  ])

  const settings = user.settings ?? ({} as Settings)

  const candidates = positions?.length
    ? evaluate(positions as Position[], balance?.available_ars ?? 0, settings)
    : []

  // Dedupe: nada del mismo tipo+símbolo en las últimas 24hs
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: recent } = await db
    .from('alerts')
    .select('alert_type, symbol')
    .eq('user_id', user.id)
    .is('goal_id', null)
    .gte('created_at', since)

  const seen = new Set((recent ?? []).map((a) => `${a.alert_type}|${a.symbol ?? ''}`))

  // Las de meta traen su propio dedupe: se comparan por goal_id y con ventanas
  // distintas según el tipo
  const fresh = [
    ...candidates.filter((c) => !seen.has(`${c.alert_type}|${c.symbol ?? ''}`)),
    // La de recompra se marca en `sell_watch.alerted_at`, así que no necesita
    // el dedupe de 24hs: avisa una sola vez por venta
    ...(await evaluateRebuys(user.id, settings)),
    ...(await evaluateGoals(user.id)),
  ]

  if (!fresh.length) return { evaluated: candidates.length, created: 0 }

  const { data: inserted, error } = await db
    .from('alerts')
    .insert(fresh.map((c) => ({ ...c, user_id: user.id })))
    .select('id, title, message, severity, symbol')

  if (error) throw error

  // Push: solo dentro del horario de monitoreo y según los toggles por severidad
  let pushed = 0
  if (user.push_subscription && withinMonitoringHours(settings)) {
    for (const alert of inserted ?? []) {
      const severity = alert.severity as Severity
      if (!shouldNotify(settings)) continue

      const payload: PushPayload = {
        title: alert.title,
        body: alert.message,
        tag: `alert-${alert.id}`,
        url: '/alertas',
        alertId: alert.id,
        severity,
      }

      if (await sendPush(db, user.id, user.push_subscription, payload)) {
        pushed++
        await db.from('alerts').update({ push_sent: true }).eq('id', alert.id)
      }
    }
  }

  return { evaluated: candidates.length, created: fresh.length, pushed }
}

Deno.serve(async (req) => {
  if (!isServiceRole(req)) return unauthorized()

  const { data: users, error } = await db.from('users').select('id, settings, push_subscription')
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const results: Record<string, unknown> = {}
  for (const user of users ?? []) {
    try {
      results[user.id] = await evaluateUser(user as never)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      results[user.id] = { error: message }
      console.error(`[evaluate-alerts] ${user.id}:`, message)
    }
  }

  return Response.json({ ok: true, results })
})
