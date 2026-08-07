/**
 * Horarios de los procesos automáticos, para poder mostrarlos en la app.
 *
 * OJO: esto tiene que coincidir con los `cron.schedule` de
 * `supabase/migrations/0003_cron.sql` y siguientes. No hay forma de leer la
 * tabla `cron.job` desde el cliente, así que si cambia el cron hay que cambiar
 * esto.
 *
 * Se guarda en **UTC**, que es como trabaja pg_cron, y la conversión a la hora
 * del dispositivo la hace el navegador. Antes había una constante con "11:00 y
 * 16:00" ya convertida, que era correcta solo para alguien en Buenos Aires.
 */

/** portfolio-advisor — cron `0 14,19 * * 1-5` (UTC) */
export const ADVISOR_HOURS_UTC = [14, 19] as const

/** Los mismos horarios en la hora del dispositivo: "11:00 y 16:00" en Buenos Aires. */
export function advisorHoursLabel(): string {
  const base = new Date()
  return ADVISOR_HOURS_UTC.map((h) => {
    const at = new Date(base)
    at.setUTCHours(h, 0, 0, 0)
    return at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }).join(' y ')
}

/** goal-advisor — cron `0 12 * * 0` (UTC), domingos */
export const GOAL_ADVISOR_LABEL = 'los domingos'
