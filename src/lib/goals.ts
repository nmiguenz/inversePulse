/**
 * Dificultad y proyecciones de una meta.
 *
 * Aritmética pura, sin IA: corre mientras escribís el objetivo, así el semáforo
 * responde en el momento en vez de esperar al servidor.
 *
 * ── Por qué esto importa más que verse lindo ─────────────────────────────
 *
 * "$200.000 a $500.000 en 51 días" son +150%, que anualizado da ~70.000%.
 * Ninguna cartera diversificada hace eso; solo lo haría una apuesta muy
 * concentrada que también puede terminar en cero. Una app que acepta ese
 * objetivo en silencio y después "hace todo lo posible" por cumplirlo termina
 * empujando a jugarse la plata, que es exactamente cómo se descapitaliza uno.
 *
 * Por eso la meta nunca se bloquea —es plata del usuario— pero la dificultad
 * se dice, y se acompaña con las tres salidas reales: más capital, más tiempo,
 * o menos objetivo.
 */

/** Referencia histórica: retorno nominal anual de largo plazo de las acciones americanas. */
export const HISTORICAL_RATE = 10

/**
 * Techo de la tasa de referencia cuando pasa a usar el rendimiento medido.
 *
 * Sin techo, un trimestre con suerte anualiza a tres dígitos y pinta de verde
 * una meta imposible — justo lo que el semáforo tiene que evitar. Sostener más
 * de 25% anual durante años es territorio de un puñado de nombres célebres, no
 * un supuesto de planificación.
 */
export const RATE_CAP = 25

/** Días de historia antes de confiar en el rendimiento medido en vez del histórico. */
export const RATE_MIN_HISTORY_DAYS = 180

export type DifficultyBand = 'comodo' | 'exigente' | 'dificil' | 'improbable' | 'inalcanzable'

export const BAND_LABEL: Record<DifficultyBand, string> = {
  comodo: 'Cómodo',
  exigente: 'Exigente',
  dificil: 'Difícil',
  improbable: 'Improbable',
  inalcanzable: 'Fuera de alcance',
}

export const BAND_HINT: Record<DifficultyBand, string> = {
  comodo: 'Por debajo del promedio histórico de las acciones.',
  exigente: 'Necesita un buen año de mercado.',
  dificil: 'Está en el techo histórico: posible, pero no planificable.',
  improbable: 'Requiere concentrar y que además salga bien.',
  inalcanzable: 'No hay cartera diversificada que rinda esto.',
}

/** Días entre hoy y la fecha objetivo, anclando ambas al mediodía local. */
export function daysUntil(date: string | null): number | null {
  if (!date) return null
  const target = new Date(`${date}T12:00:00`).getTime()
  if (Number.isNaN(target)) return null

  const now = new Date()
  const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime()
  return Math.round((target - todayNoon) / 864e5)
}

/**
 * Rendimiento anual necesario para llegar al objetivo, en porcentaje.
 *
 * Devuelve null cuando la pregunta no tiene sentido: sin objetivo, sin fecha,
 * sin capital (dividir por cero), o con la fecha ya pasada.
 * `Infinity` nunca sale de acá.
 */
export function requiredReturn(
  current: number,
  target: number | null,
  days: number | null,
): number | null {
  if (!target || target <= 0) return null
  if (days === null || days <= 0) return null
  // Sin capital no hay rendimiento que alcance: ningún porcentaje sobre cero da
  // un número. Es un caso de "falta capital", no de dificultad infinita.
  if (current <= 0) return null
  if (current >= target) return 0

  const years = days / 365
  return (Math.pow(target / current, 1 / years) - 1) * 100
}

export function difficultyBand(requiredAnnualPct: number): DifficultyBand {
  if (requiredAnnualPct <= 10) return 'comodo'
  if (requiredAnnualPct <= 20) return 'exigente'
  if (requiredAnnualPct <= 40) return 'dificil'
  if (requiredAnnualPct <= 100) return 'improbable'
  return 'inalcanzable'
}

export type Projections = {
  /** A cuánto llegás en la fecha, al ritmo de referencia */
  achievableAmount: number
  /** Cuánto habría que tener hoy para llegar al objetivo en la fecha */
  capitalNeededToday: number
  /** Cuántos años faltan para llegar al objetivo con lo que tenés */
  yearsToTarget: number | null
  /** La fecha de arriba, en ISO */
  dateReached: string | null
}

/**
 * Las tres salidas cuando el objetivo no cierra: más plata, más tiempo, o
 * menos objetivo. Es lo que convierte un "no llegás" en algo accionable.
 */
export function projections(
  current: number,
  target: number | null,
  days: number | null,
  ratePct: number,
): Projections | null {
  if (days === null || days <= 0) return null

  const r = ratePct / 100
  const years = days / 365
  const growth = Math.pow(1 + r, years)

  const achievableAmount = current * growth
  const capitalNeededToday = target && target > 0 ? target / growth : 0

  let yearsToTarget: number | null = null
  let dateReached: string | null = null

  // Con tasa 0 o sin capital nunca se llega: devolver un número sería inventar
  if (target && target > 0 && current > 0 && r > 0 && target > current) {
    yearsToTarget = Math.log(target / current) / Math.log(1 + r)
    const d = new Date()
    d.setFullYear(d.getFullYear() + Math.floor(yearsToTarget))
    d.setDate(d.getDate() + Math.round((yearsToTarget % 1) * 365))
    dateReached = d.toISOString().slice(0, 10)
  }

  return { achievableAmount, capitalNeededToday, yearsToTarget, dateReached }
}

export type ReferenceRate = {
  pct: number
  source: 'historical' | 'measured'
  /** Por qué se usa esta tasa, para mostrarlo en pantalla */
  explanation: string
}

/**
 * La tasa con la que se proyecta.
 *
 * Arranca en el histórico y pasa al rendimiento medido de la cartera cuando hay
 * suficiente historia — así, si la cartera rinde 18% sostenido, las metas se
 * evalúan contra 18% y no contra un promedio ajeno.
 *
 * Acotada entre 0% y RATE_CAP: proyectar una racha buena hacia adelante es
 * proyectar suerte, y proyectar una mala haría inalcanzable cualquier meta.
 */
export function referenceRate(
  reviews: Array<{ period_start: string; period_end: string; return_pct: number | null }>,
): ReferenceRate {
  const usable = reviews.filter((r) => r.return_pct != null)

  if (usable.length) {
    const oldest = usable.reduce((min, r) => (r.period_start < min ? r.period_start : min),
      usable[0].period_start)
    const historyDays = daysUntil(oldest)
    const span = historyDays === null ? 0 : -historyDays

    if (span >= RATE_MIN_HISTORY_DAYS) {
      // Se anualiza el promedio de los períodos medidos
      const avg = usable.reduce((s, r) => s + (r.return_pct ?? 0), 0) / usable.length
      const periodDays =
        usable.reduce((s, r) => {
          const d = daysUntil(r.period_start)
          const e = daysUntil(r.period_end)
          return s + (d !== null && e !== null ? e - d : 30)
        }, 0) / usable.length

      const annualized = (Math.pow(1 + avg / 100, 365 / Math.max(1, periodDays)) - 1) * 100
      const capped = Math.min(RATE_CAP, Math.max(0, annualized))

      return {
        pct: capped,
        source: 'measured',
        explanation:
          capped < annualized
            ? `Tu cartera viene rindiendo más que ${RATE_CAP}% anual, pero las proyecciones usan ${RATE_CAP}% como techo: extrapolar una racha buena es extrapolar suerte.`
            : `Proyectado con el ${capped.toFixed(1)}% anual que viene rindiendo tu cartera.`,
      }
    }
  }

  return {
    pct: HISTORICAL_RATE,
    source: 'historical',
    explanation:
      `Proyectado con ${HISTORICAL_RATE}% anual, el promedio histórico de largo plazo de las ` +
      `acciones americanas. Cuando la app tenga 6 meses de historia medida, pasa a usar el ` +
      `rendimiento real de tu cartera.`,
  }
}

export type GoalAnalysis = {
  daysLeft: number | null
  required: number | null
  band: DifficultyBand | null
  progress: number | null
  projections: Projections | null
  rate: ReferenceRate
  /** Objetivo cubierto: el valor actual ya alcanza o supera la meta */
  covered: boolean
}

/** Todo el análisis de una meta en una sola pasada. */
export function analyzeGoal(
  goal: { target_amount: number | null; target_date: string | null },
  currentValue: number,
  rate: ReferenceRate,
): GoalAnalysis {
  const target = goal.target_amount ? Number(goal.target_amount) : null
  const daysLeft = daysUntil(goal.target_date)
  const required = requiredReturn(currentValue, target, daysLeft)

  return {
    daysLeft,
    required,
    band: required === null ? null : difficultyBand(required),
    progress: target && target > 0 ? (currentValue / target) * 100 : null,
    projections: projections(currentValue, target, daysLeft, rate.pct),
    rate,
    covered: !!target && target > 0 && currentValue >= target,
  }
}
