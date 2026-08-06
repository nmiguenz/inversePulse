/**
 * earnings-reminder — diaria a las 9:00 ART
 *
 * Avisa cuando un activo EN CARTERA reporta resultados dentro de los próximos
 * días. Las fechas se cargan a mano desde Config → Earnings: no hay fuente
 * gratuita confiable, y una fecha inventada dispararía un aviso falso sobre
 * una posición real.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isServiceRole, unauthorized } from '../_shared/auth.ts'
import { sendPush } from '../_shared/push.ts'

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

/** Con cuántos días de anticipación avisar. */
const DAYS_AHEAD = 3

/** Fecha de hoy en Buenos Aires */
function todayBA(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
}

function daysUntil(dateStr: string): number {
  const target = new Date(`${dateStr}T00:00:00-03:00`).getTime()
  const today = new Date(`${todayBA()}T00:00:00-03:00`).getTime()
  return Math.round((target - today) / (24 * 60 * 60 * 1000))
}

function whenLabel(days: number, timeOfDay: string | null): string {
  const base = days === 0 ? 'hoy' : days === 1 ? 'mañana' : `en ${days} días`
  if (timeOfDay === 'before_open') return `${base}, antes de la apertura`
  if (timeOfDay === 'after_close') return `${base}, después del cierre`
  return base
}

Deno.serve(async (req) => {
  if (!isServiceRole(req)) return unauthorized()

  const today = todayBA()
  const limit = new Date(Date.now() + DAYS_AHEAD * 24 * 60 * 60 * 1000)
    .toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

  const [{ data: upcoming }, { data: users }, { data: positions }] = await Promise.all([
    db
      .from('earnings_calendar')
      .select('id, symbol, report_date, time_of_day, reminded_at')
      .eq('is_reported', false)
      .gte('report_date', today)
      .lte('report_date', limit)
      .order('report_date'),
    db.from('users').select('id, push_subscription'),
    db.from('positions').select('user_id, symbol'),
  ])

  if (!upcoming?.length) {
    return Response.json({ ok: true, upcoming: 0, note: 'nada en los próximos días' })
  }

  const results: Array<Record<string, unknown>> = []

  for (const user of users ?? []) {
    const held = new Set((positions ?? []).filter((p) => p.user_id === user.id).map((p) => p.symbol))

    for (const earnings of upcoming) {
      // Solo lo que tenés: un earnings de un activo que no está en cartera
      // es ruido, no una señal
      if (!held.has(earnings.symbol)) continue
      // Ya se avisó de este reporte: no repetir los 3 días seguidos
      if (earnings.reminded_at) continue

      const days = daysUntil(earnings.report_date)
      const when = whenLabel(days, earnings.time_of_day)

      const { data: alert } = await db
        .from('alerts')
        .insert({
          user_id: user.id,
          alert_type: 'earnings',
          symbol: earnings.symbol,
          title: `${earnings.symbol} reporta ${when}`,
          message: `${earnings.symbol} presenta resultados ${when}. Los earnings suelen mover el precio con fuerza en ambas direcciones — evaluá si querés ajustar la posición antes.`,
          severity: 'info',
          action_suggested: `Evaluar posición en ${earnings.symbol}`,
        })
        .select('id')
        .single()

      // Un earnings próximo es una decisión: podés querer ajustar antes del reporte
      const notifies = (user.settings as Record<string, unknown>)?.notify_decisions !== false
      if (user.push_subscription && alert && notifies) {
        const ok = await sendPush(db, user.id, user.push_subscription, {
          title: `${earnings.symbol} reporta ${when}`,
          body: 'Los earnings suelen mover el precio con fuerza. Evaluá la posición.',
          tag: `earnings-${earnings.id}`,
          url: '/alertas',
          alertId: alert.id,
          severity: 'info',
        })
        if (ok) await db.from('alerts').update({ push_sent: true }).eq('id', alert.id)
      }

      await db
        .from('earnings_calendar')
        .update({ reminded_at: new Date().toISOString() })
        .eq('id', earnings.id)

      results.push({ symbol: earnings.symbol, date: earnings.report_date, days })
    }
  }

  return Response.json({ ok: true, upcoming: upcoming.length, reminded: results })
})
