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
  monitoring_start: string
  monitoring_end: string
  notify_critical: boolean
  notify_warning: boolean
  notify_info: boolean
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

    if (gainPct >= s.take_profit_pct) {
      out.push({
        alert_type: 'take_profit',
        symbol: p.symbol,
        title: `Toma de ganancia — ${p.symbol}`,
        message: `${p.symbol} acumula ${pct(gainPct)} (${fmt(gain)}). Superó tu umbral de ${s.take_profit_pct}%.`,
        severity: 'opportunity',
        action_suggested: `Evaluar venta parcial de ${p.symbol}`,
      })
    }

    if (gainPct <= s.stop_loss_pct) {
      out.push({
        alert_type: 'stop_loss',
        symbol: p.symbol,
        title: `Stop loss — ${p.symbol}`,
        message: `${p.symbol} cae ${pct(gainPct)} (${fmt(gain)}). Cruzó tu piso de ${s.stop_loss_pct}%.`,
        severity: 'critical',
        action_suggested: `Revisar posición en ${p.symbol}`,
      })
    }

    if (Math.abs(dayPct) >= s.daily_extreme_pct) {
      out.push({
        alert_type: 'daily_extreme',
        symbol: p.symbol,
        title: `Variación extrema — ${p.symbol}`,
        message: `${p.symbol} se movió ${pct(dayPct)} en el día.`,
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
        title: `Rebalanceo — ${p.symbol}`,
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
        title: `Concentración en ${sector}`,
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
      title: 'Cash sin invertir',
      message: `Tenés ${fmt(availableCash)} sin rendir en la cuenta.`,
      severity: 'info',
      action_suggested: 'Suscribir a un FCI money market',
    })
  }

  return out
}

function shouldNotify(severity: Severity, s: Settings): boolean {
  if (severity === 'critical') return s.notify_critical !== false
  if (severity === 'warning') return s.notify_warning !== false
  return s.notify_info !== false
}

async function evaluateUser(user: { id: string; settings: Settings; push_subscription: unknown }) {
  const [{ data: positions }, { data: balance }] = await Promise.all([
    db
      .from('positions')
      .select(
        'symbol, description, quantity, avg_buy_price, current_price, previous_close, sector, market_value, gain_amount, gain_pct',
      )
      .eq('user_id', user.id),
    db.from('account_balance').select('available_ars').eq('user_id', user.id).maybeSingle(),
  ])

  if (!positions?.length) return { evaluated: 0, created: 0 }

  const settings = user.settings ?? ({} as Settings)
  const candidates = evaluate(positions as Position[], balance?.available_ars ?? 0, settings)

  // Dedupe: nada del mismo tipo+símbolo en las últimas 24hs
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: recent } = await db
    .from('alerts')
    .select('alert_type, symbol')
    .eq('user_id', user.id)
    .gte('created_at', since)

  const seen = new Set((recent ?? []).map((a) => `${a.alert_type}|${a.symbol ?? ''}`))
  const fresh = candidates.filter((c) => !seen.has(`${c.alert_type}|${c.symbol ?? ''}`))

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
      if (!shouldNotify(severity, settings)) continue

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
