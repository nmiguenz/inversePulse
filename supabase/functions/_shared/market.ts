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

  // 0 domingo, 6 sábado. Los feriados NO se contemplan acá a propósito: esto
  // decide si vale la pena sincronizar, y equivocarse cuesta una corrida de
  // más. Para saber si un día HUBO RUEDA —que es otra pregunta, y ahí
  // equivocarse inventa datos— está `isTradingDay`.
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


// ============================================================
// Días de rueda
// ============================================================

/**
 * Feriados argentinos por año, cacheados en el módulo.
 *
 * La fuente es argentinadatos.com, la misma familia que dolarapi.com que ya
 * usa `fetch-dollar-rates`. Es gratuita y devuelve `[{ fecha, tipo, nombre }]`.
 *
 * Un fallo NO se cachea: se degrada a "solo fines de semana" y se reintenta en
 * la corrida siguiente. Preferimos perdernos un feriado —y que ese día quede
 * sin resultado, como antes— a cachear un set vacío por horas.
 */
const feriadosPorAnio = new Map<number, Set<string>>()

async function feriados(anio: number): Promise<Set<string>> {
  const cacheado = feriadosPorAnio.get(anio)
  if (cacheado) return cacheado

  try {
    const res = await fetch(`https://api.argentinadatos.com/v1/feriados/${anio}`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const lista = (await res.json()) as Array<{ fecha?: string }>
    const set = new Set(lista.map((f) => f.fecha).filter((f): f is string => !!f))
    if (!set.size) throw new Error('respuesta vacía')
    feriadosPorAnio.set(anio, set)
    return set
  } catch (err) {
    console.warn(
      `[market] no se pudo leer el calendario de feriados ${anio}: ${err instanceof Error ? err.message : err}. ` +
        'Se descartan solo los fines de semana.',
    )
    return new Set()
  }
}

/**
 * ¿Hubo rueda ese día?
 *
 * Distinta de `isMarketOpen`, que mira la hora: esto mira el CALENDARIO. Un
 * sábado o un feriado los precios no se mueven, así que IOL sigue devolviendo
 * la variación del último día operado. Guardar eso como resultado del día
 * duplica la jornada anterior — que es exactamente lo que pasó el fin de
 * semana del 15/8/2026 más el feriado del lunes 17: el viernes se contó cuatro
 * veces y la pérdida del período salió al doble de la real.
 *
 * `fecha` es un día calendario de Buenos Aires en formato YYYY-MM-DD.
 */
export async function isTradingDay(fecha: string): Promise<boolean> {
  // Mediodía UTC: para un valor que es solo fecha, evita que el huso lo corra
  // al día anterior o al siguiente.
  const dow = new Date(`${fecha}T12:00:00Z`).getUTCDay()
  if (dow === 0 || dow === 6) return false

  const set = await feriados(Number(fecha.slice(0, 4)))
  return !set.has(fecha)
}
