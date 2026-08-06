/**
 * earnings-reminder — diaria a las 9:00 ART
 *
 * Hace dos cosas:
 *
 * 1. Avisa cuando un activo EN CARTERA reporta resultados dentro de los
 *    próximos días.
 * 2. Insiste todos los días con los CEDEARs de la cartera que NO tienen fecha
 *    cargada, porque un calendario incompleto falla en silencio: sin fecha no
 *    hay recordatorio, y no te enterás de que faltaba hasta después del
 *    reporte.
 *
 * Las fechas se cargan a mano desde Config → Earnings: no hay fuente gratuita
 * confiable, y una fecha inventada dispararía un aviso falso sobre una
 * posición real.
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

/**
 * ¿Ya se avisó hoy de las fechas faltantes?
 *
 * El aviso es diario a propósito, pero si la función se corre dos veces el
 * mismo día (reintento del cron, disparo manual) no tiene que duplicarse.
 */
async function alertedToday(userId: string, today: string): Promise<boolean> {
  const { data, error } = await db
    .from('alerts')
    .select('id')
    .eq('user_id', userId)
    .eq('alert_type', 'earnings_missing')
    .gte('created_at', `${today}T00:00:00-03:00`)
    .limit(1)

  // Si la consulta falla, no insertar: mejor perder un recordatorio que
  // mandar el mismo push en loop.
  if (error) {
    console.error('[earnings-reminder] chequeo de duplicado falló:', error.message)
    return true
  }
  return (data ?? []).length > 0
}

Deno.serve(async (req) => {
  if (!isServiceRole(req)) return unauthorized()

  const today = todayBA()
  const limit = new Date(Date.now() + DAYS_AHEAD * 24 * 60 * 60 * 1000)
    .toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

  const [{ data: upcoming }, { data: users }, { data: positions }, { data: scheduled }] =
    await Promise.all([
      db
        .from('earnings_calendar')
        .select('id, symbol, report_date, time_of_day, reminded_at')
        .eq('is_reported', false)
        .gte('report_date', today)
        .lte('report_date', limit)
        .order('report_date'),
      db.from('users').select('id, push_subscription, settings'),
      db.from('positions').select('user_id, symbol, asset_type'),
      // Cualquier fecha futura, no solo la de los próximos días: un CEDEAR con
      // el reporte cargado para dentro de dos meses no está "sin fecha".
      db
        .from('earnings_calendar')
        .select('symbol')
        .eq('is_reported', false)
        .gte('report_date', today),
    ])

  // Símbolos con al menos una fecha futura cargada
  const withDate = new Set((scheduled ?? []).map((e) => e.symbol))

  const results: Array<Record<string, unknown>> = []
  const missingReports: Array<Record<string, unknown>> = []

  for (const user of users ?? []) {
    const mine = (positions ?? []).filter((p) => p.user_id === user.id)
    const held = new Set(mine.map((p) => p.symbol))
    const notifies = (user.settings as Record<string, unknown>)?.notify_decisions !== false

    // ── 1. CEDEARs sin fecha de reporte ──────────────────────────────────
    // Misma regla que `missingEarnings()` en src/lib/earnings.ts, que es la
    // canónica. Está duplicada porque el bundler de Supabase solo sube lo que
    // cuelga de supabase/functions y no puede importar desde src/. Si cambia
    // el criterio, hay que tocar los dos lados.
    const missing = mine
      .filter(
        (p) =>
          (p.asset_type === 'CEDEAR' || p.asset_type === 'ACCION') && !withDate.has(p.symbol),
      )
      .map((p) => p.symbol)
      .sort()

    if (missing.length) {
      // Una sola alerta con todos los símbolos. Una por CEDEAR serían 8 pushes
      // el mismo día, que es la forma más rápida de que apagues las
      // notificaciones.
      const already = await alertedToday(user.id, today)

      if (!already) {
        const list = missing.join(', ')
        const { data: alert } = await db
          .from('alerts')
          .insert({
            user_id: user.id,
            alert_type: 'earnings_missing',
            symbol: missing.length === 1 ? missing[0] : null,
            title:
              missing.length === 1
                ? `Falta la fecha de resultados de ${missing[0]}`
                : `Faltan ${missing.length} fechas de resultados`,
            message:
              `Sin fecha cargada no hay aviso previo al reporte, y los earnings suelen mover ` +
              `el precio con fuerza. Cargalas en Config → Earnings: ${list}.`,
            severity: 'info',
            action_suggested: `Cargar fecha de resultados: ${list}`,
          })
          .select('id')
          .single()

        if (user.push_subscription && alert && notifies) {
          const ok = await sendPush(db, user.id, user.push_subscription, {
            title:
              missing.length === 1
                ? `Falta la fecha de resultados de ${missing[0]}`
                : `Faltan ${missing.length} fechas de resultados`,
            body: `Cargalas para no perderte el aviso: ${list}`,
            // tag con la fecha: reemplaza el aviso de ayer en vez de apilarse
            tag: `earnings-missing-${today}`,
            url: '/config',
            alertId: alert.id,
            severity: 'info',
          })
          if (ok) await db.from('alerts').update({ push_sent: true }).eq('id', alert.id)
        }

        missingReports.push({ user: user.id, symbols: missing })
      }
    }

    // ── 2. Reportes próximos ─────────────────────────────────────────────
    for (const earnings of upcoming ?? []) {
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

  return Response.json({
    ok: true,
    upcoming: upcoming?.length ?? 0,
    reminded: results,
    missingDates: missingReports,
  })
})
