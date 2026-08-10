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

/**
 * portfolio-advisor — cron `0 15,19 * * 1-5` (UTC)
 *
 * Los dos momentos están elegidos para caer dentro de la rueda en cualquier
 * época del año:
 *
 * - **15:00 UTC** — hora y media después de la apertura local y ya con Wall
 *   Street abierto incluso sin horario de verano allá. Las 14:00 que usábamos
 *   antes caían antes de la apertura de EE.UU. medio año, con los CEDEARs
 *   todavía sin referencia.
 * - **19:00 UTC** — una hora antes del cierre de BYMA: se ve el movimiento del
 *   día y todavía se puede operar.
 */
export const ADVISOR_HOURS_UTC = [15, 19] as const

/** Los mismos horarios en la hora del dispositivo: "11:00 y 16:00" en Buenos Aires. */
export function advisorHoursLabel(): string {
  const base = new Date()
  return ADVISOR_HOURS_UTC.map((h) => {
    const at = new Date(base)
    at.setUTCHours(h, 0, 0, 0)
    return at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }).join(' y ')
}

/**
 * La ventana de sincronización: la rueda de BYMA, 13:30–20:00 UTC.
 *
 * Tiene que coincidir con `_shared/market.ts` del lado de las funciones y con
 * los cron de la 0023. Fuera de esta ventana los precios no se mueven y nada
 * sincroniza — y eso hay que DECIRLO en la pantalla: un "último sync 17:03"
 * a las 22:00 parece un error si nadie te contó que el mercado cierra.
 */
export const MARKET_OPEN_UTC = { hour: 13, minute: 30 } as const
export const MARKET_CLOSE_UTC = { hour: 20, minute: 0 } as const

/** "10:30 a 17:00" en la hora del dispositivo. */
export function marketWindowLabel(): string {
  const fmt = (h: number, m: number) => {
    const at = new Date()
    at.setUTCHours(h, m, 0, 0)
    return at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }
  return `${fmt(MARKET_OPEN_UTC.hour, MARKET_OPEN_UTC.minute)} a ${fmt(MARKET_CLOSE_UTC.hour, MARKET_CLOSE_UTC.minute)}`
}

/** ¿Estamos dentro de la ventana, un día hábil? Espejo de isMarketOpen del server. */
export function isMarketOpenNow(now = new Date()): boolean {
  const day = now.getUTCDay()
  if (day === 0 || day === 6) return false
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes()
  return (
    minutes >= MARKET_OPEN_UTC.hour * 60 + MARKET_OPEN_UTC.minute &&
    minutes < MARKET_CLOSE_UTC.hour * 60 + MARKET_CLOSE_UTC.minute
  )
}

/**
 * goal-advisor — cron `30 16 * * 1` (UTC), lunes
 *
 * Estaba los domingos, pero con el corte por horario de mercado esa corrida se
 * saltea siempre. Ver la 0024.
 */
export const GOAL_ADVISOR_LABEL = 'los lunes'
