/**
 * Horario de mercado — fuente única para todas las funciones.
 *
 * ── Los horarios ─────────────────────────────────────────────────────────
 *
 * BYMA opera de 10:30 a 17:00 hora argentina, lunes a viernes. Como Argentina
 * no tiene horario de verano, eso es siempre 13:30–20:00 UTC.
 *
 * Wall Street opera de 9:30 a 16:00 de Nueva York, que SÍ cambia con el horario
 * de verano:
 *
 *   marzo–noviembre (EDT)   13:30–20:00 UTC   = 10:30–17:00 argentina
 *   noviembre–marzo (EST)   14:30–21:00 UTC   = 11:30–18:00 argentina
 *
 * O sea que medio año la rueda argentina arranca una hora antes que la de allá.
 * Importa porque los CEDEARs siguen al activo de Estados Unidos.
 *
 * ── Para qué se usa ──────────────────────────────────────────────────────
 *
 * Fuera de la rueda los precios no se mueven, así que sincronizar es gastar
 * llamadas al pedo — y, sobre todo, analizar con IA es pagar tokens por una
 * recomendación que no se puede ejecutar hasta el otro día, cuando los precios
 * ya cambiaron.
 *
 * Está acá y no repartido en cada cron para que haya un solo lugar donde
 * corregirlo si BYMA cambia el horario, como hizo el 28 de julio.
 */

/** Apertura de BYMA en minutos desde medianoche UTC: 13:30. */
const BYMA_OPEN_UTC = 13 * 60 + 30
/** Cierre de BYMA: 20:00 UTC. */
const BYMA_CLOSE_UTC = 20 * 60

/**
 * Margen después del cierre para que las tareas de fin de rueda entren.
 *
 * `fetch-market-quotes` y `fetch-transactions` corren justo después del cierre
 * a propósito: necesitan los precios y las operaciones ya cerradas del día.
 */
const AFTER_CLOSE_GRACE_MIN = 120

export type MarketState = {
  open: boolean
  /** Dentro de la rueda o en la ventana de cierre. Para tareas de fin de día. */
  openOrClosing: boolean
  /** Por qué está cerrado, para poder decírselo al usuario. */
  reason: string
}

export function marketState(now = new Date()): MarketState {
  const day = now.getUTCDay()
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes()

  // 0 domingo, 6 sábado. No se contemplan los feriados de BYMA: no hay una
  // fuente confiable y gratuita del calendario, y el costo de equivocarse es
  // una corrida de más que no encuentra precios nuevos.
  if (day === 0 || day === 6) {
    return { open: false, openOrClosing: false, reason: 'Es fin de semana: el mercado está cerrado.' }
  }

  const open = minutes >= BYMA_OPEN_UTC && minutes < BYMA_CLOSE_UTC
  const openOrClosing = minutes >= BYMA_OPEN_UTC && minutes < BYMA_CLOSE_UTC + AFTER_CLOSE_GRACE_MIN

  if (open) return { open: true, openOrClosing: true, reason: '' }

  return {
    open: false,
    openOrClosing,
    reason:
      minutes < BYMA_OPEN_UTC
        ? 'El mercado todavía no abrió. Opera de 10:30 a 17:00.'
        : 'El mercado ya cerró. Opera de 10:30 a 17:00.',
  }
}

/** ¿Se puede sincronizar o analizar ahora? */
export function isMarketOpen(now = new Date()): boolean {
  return marketState(now).open
}

/**
 * ¿Se puede gastar en IA ahora?
 *
 * Fuera de la rueda no, ni siquiera a pedido, salvo que el usuario lo habilite
 * explícitamente. Viene apagado por defecto porque la plata la pone él y el
 * análisis pierde vigencia de un día para el otro.
 */
export function canUseAI(
  settings: { allow_ai_after_hours?: boolean } | null | undefined,
  now = new Date(),
): { allowed: boolean; reason: string } {
  if (settings?.allow_ai_after_hours) return { allowed: true, reason: '' }

  const state = marketState(now)
  if (state.open) return { allowed: true, reason: '' }

  return {
    allowed: false,
    reason: `${state.reason} El análisis con IA queda en pausa para no gastar en recomendaciones que no vas a poder ejecutar. Podés habilitarlo en Configuración.`,
  }
}
