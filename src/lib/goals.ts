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

/**
 * Los tres escenarios con los que se proyecta una meta.
 *
 * ── Por qué tres y no uno ────────────────────────────────────────────────
 *
 * Una tasa única es el instrumento equivocado. Si se elige conservadora,
 * subestima lo que puede pasar en un buen año. Si se elige optimista, pinta de
 * verde metas que no van a llegar, y el costo de ese error es asimétrico: no
 * tenés la plata el día que la necesitabas.
 *
 * El escenario malo se muestra SIEMPRE. Para una meta con fecha es el que más
 * importa: es el que dice cuánto podrías no tener el día del cumpleaños.
 *
 * ── De dónde salen los números ───────────────────────────────────────────
 *
 * Del historial real de los índices, no de una estimación:
 *
 * · Agresivo — Nasdaq-100 desde 2000, que es lo más parecido a una cartera
 *   concentrada en CEDEARs tech. Peor año 2008 (−41,9%) y 2022 (−33%); mejor
 *   año 2023 (+54,9%); promedio anual del período +12,2%.
 *
 * · Moderado — S&P 500: peor año 2008 (−37%), mejor cerca de +30%, promedio
 *   de largo plazo ~10%.
 *
 * El perfil agresivo NO es solo un techo más alto: también tiene un piso más
 * bajo. Esa es la contracara real de buscar retornos altos, y esconderla sería
 * vender una ilusión.
 */
export type RiskProfile = 'agresivo' | 'moderado'

export type ScenarioSet = {
  bad: number
  mid: number
  good: number
  profile: RiskProfile
  source: string
}

const PROFILES: Record<RiskProfile, ScenarioSet> = {
  agresivo: {
    bad: -35,
    mid: 12,
    good: 50,
    profile: 'agresivo',
    source:
      'Rango del Nasdaq-100 desde 2000: su peor año fue −41,9% (2008), el mejor +54,9% (2023) ' +
      'y el promedio anual +12,2%.',
  },
  moderado: {
    bad: -20,
    mid: 10,
    good: 30,
    profile: 'moderado',
    source:
      'Rango del S&P 500: peor año −37% (2008), mejores años cerca de +30%, promedio de largo ' +
      'plazo ~10%.',
  },
}

export function scenarios(profile: RiskProfile = 'agresivo'): ScenarioSet {
  return PROFILES[profile] ?? PROFILES.agresivo
}

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

/**
 * Cuánto crece el capital en `days` según el escenario.
 *
 * ── Por qué no se compone la tasa anual y listo ──────────────────────────
 *
 * Porque los extremos de UN año no se repiten todos los años. Componer −35%
 * anual durante 10 años da que $200.000 se convierten en $2.693, y eso nunca
 * pasó: el peor decenio del Nasdaq-100 (2000-2010) fue −6,3% anual, no −35%.
 *
 * Y al revés en el corto plazo: aplicar −35% anual a 51 días da apenas −5,8%,
 * cuando en marzo de 2020 el índice cayó cerca de 28% en cinco semanas. La
 * tasa plana subestimaba el riesgo corto y exageraba el largo.
 *
 * La dispersión de los rendimientos escala con la RAÍZ del tiempo, no con el
 * tiempo. Se trabaja en logaritmos para que el escenario malo nunca pueda dar
 * menos de −100%, y la calibración reproduce los dos extremos históricos
 * verificados: el peor año (−35%) y el peor decenio (≈ −6% anual).
 */
export function scenarioGrowth(set: ScenarioSet, which: 'bad' | 'mid' | 'good', days: number): number {
  const years = days / 365
  const midLog = Math.log(1 + set.mid / 100)

  if (which === 'mid') return Math.exp(midLog * years)

  const targetLog = Math.log(1 + set[which] / 100)
  // Distancia al escenario medio, medida a un año
  const devLog = Math.abs(targetLog - midLog)
  // Raíz del tiempo: a 10 años la dispersión anual es ~3,2 veces menor
  const scaled = devLog * Math.sqrt(years)

  return Math.exp(midLog * years + (which === 'good' ? scaled : -scaled))
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
  /** Crecimiento ya calculado. Si no viene, se compone la tasa anual. */
  growthOverride?: number,
): Projections | null {
  if (days === null || days <= 0) return null

  const r = ratePct / 100
  const years = days / 365
  const growth = growthOverride ?? Math.pow(1 + r, years)

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

export type GoalAnalysis = {
  /** Valor actual de la meta, para poder expresar los escenarios en % */
  currentValue: number
  daysLeft: number | null
  required: number | null
  band: DifficultyBand | null
  progress: number | null
  /** Una proyección por escenario. `mid` es la que se muestra como principal. */
  bad: Projections | null
  mid: Projections | null
  good: Projections | null
  set: ScenarioSet
  /**
   * La meta no entra ni en el mejor escenario.
   *
   * Es el criterio del veredicto: solo se marca fuera de alcance lo que no
   * llega ni con un año excepcional. Es lo más generoso posible con la
   * ambición del usuario, y hace que cuando la app diga que no, el no sea
   * indiscutible.
   */
  outOfReach: boolean
  /** Objetivo cubierto: el valor actual ya alcanza o supera la meta */
  covered: boolean
}

/** Todo el análisis de una meta en una sola pasada. */
export function analyzeGoal(
  goal: { target_amount: number | null; target_date: string | null },
  currentValue: number,
  set: ScenarioSet,
): GoalAnalysis {
  const target = goal.target_amount ? Number(goal.target_amount) : null
  const daysLeft = daysUntil(goal.target_date)
  const required = requiredReturn(currentValue, target, daysLeft)

  // Los escenarios extremos escalan por raíz del tiempo; el medio se compone
  // normal, que es lo que corresponde a un promedio
  const grow = (which: 'bad' | 'mid' | 'good') =>
    daysLeft === null ? undefined : scenarioGrowth(set, which, daysLeft)

  const good = projections(currentValue, target, daysLeft, set.good, grow('good'))

  return {
    currentValue,
    daysLeft,
    required,
    band: required === null ? null : difficultyBand(required),
    progress: target && target > 0 ? (currentValue / target) * 100 : null,
    bad: projections(currentValue, target, daysLeft, set.bad, grow('bad')),
    mid: projections(currentValue, target, daysLeft, set.mid, grow('mid')),
    good,
    set,
    outOfReach: !!target && !!good && good.achievableAmount < target,
    covered: !!target && target > 0 && currentValue >= target,
  }
}
