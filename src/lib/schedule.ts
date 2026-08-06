/**
 * Horarios de los procesos automáticos, para poder mostrarlos en la app.
 *
 * OJO: esto tiene que coincidir con los `cron.schedule` de
 * `supabase/migrations/0003_cron.sql` y siguientes. pg_cron trabaja en UTC y
 * Buenos Aires es UTC−3, así que un cron a las 14:00 UTC corre a las 11:00 de
 * acá. Si cambia el cron, hay que cambiar esto: no hay forma de leer la tabla
 * `cron.job` desde el cliente.
 */

/** portfolio-advisor — cron `0 14,19 * * 1-5` (UTC) */
export const ADVISOR_HOURS = ['11:00', '16:00'] as const

/** Texto listo para mostrar: "11:00 y 16:00" */
export const ADVISOR_HOURS_LABEL = ADVISOR_HOURS.join(' y ')

/** goal-advisor — cron `0 12 * * 0` (UTC), domingos */
export const GOAL_ADVISOR_LABEL = 'los domingos a las 9:00'
