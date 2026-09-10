/**
 * backtest — a mano, nunca por CRON
 *
 * Contesta una sola pregunta: si cada semana hubiera comprado los 3 activos con
 * mejor score, ¿le habría ganado a SPY? Es lo que dice si el scoring agrega
 * valor ANTES de que la IA intervenga.
 *
 * NO simula la IA. Simula el SCORING. El modelo explica y matiza lo que el
 * score selecciona, así que lo que se mide acá es la parte determinística —
 * la única que se puede reproducir.
 *
 * Sin IA, sin llamadas externas y sin escritura fuera de `backtest_results`:
 * es aritmética sobre `price_history`.
 *
 * ── Por qué es reproducible ─────────────────────────────────────────────
 *
 * Dos corridas seguidas tienen que dar lo mismo. Las tres fuentes de deriva
 * están cerradas a propósito:
 *
 * 1. La ventana NO se ancla en el reloj sino en el último cierre que hay en la
 *    base. `Date.now()` cambia entre corridas; el dato, no.
 * 2. Todos los ordenamientos desempatan por símbolo. Un `.sort()` por score
 *    solo deja el orden de los empatados librado a la implementación.
 * 3. Los indicadores se calculan con las MISMAS funciones que producción, sin
 *    reimplementar nada: si el backtest calculara distinto, mediría otra cosa.
 *
 * ── Look-ahead ──────────────────────────────────────────────────────────
 *
 * En cada semana simulada solo se miran cierres con fecha <= esa semana, y
 * sobre la misma ventana de `HISTORY_DAYS` que ve el asesor. El futuro se usa
 * únicamente para medir el resultado, nunca para elegir.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isServiceRole, unauthorized } from '../_shared/auth.ts'
import {
  CORRELATION_THRESHOLD,
  correlationMatrix,
  HISTORY_DAYS,
  investmentScore,
  macdSignal,
  periodReturn,
  type PricesByDate,
  relativeStrengthRank,
  RETURN_BARS,
  type ScoreBreakdown,
  SCORE_WEIGHTS_V1,
  SCORE_WEIGHTS_V2,
  SCORE_WEIGHTS_V3,
  type ScoreWeights,
  technicals,
  VOLUME_BARS,
} from '../_shared/indicators.ts'
import { fetchPriceHistory, type PriceRow } from '../_shared/priceHistory.ts'
import { regimeFromPrices, toUsdSeries } from '../_shared/marketRegime.ts'
import { UNCORRELATABLE_TYPES } from '../_shared/profile.ts'

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

/**
 * Las variantes de pesos que se pueden simular.
 *
 * V3 va con `contrarianRsi`: es la única que además cambia una banda de
 * evaluación —la del RSI— y no solo cuánto pesa cada componente.
 */
const VARIANTES: Record<string, { weights: ScoreWeights; contrarianRsi: boolean }> = {
  v1: { weights: SCORE_WEIGHTS_V1, contrarianRsi: false },
  v2: { weights: SCORE_WEIGHTS_V2, contrarianRsi: false },
  v3: { weights: SCORE_WEIGHTS_V3, contrarianRsi: true },
}

/** La variante por defecto: la que corre hoy en producción. */
const VARIANTE_DEFAULT = 'v1'
/** El benchmark, igual que en las evaluaciones. */
const BENCHMARK = 'SPY'
/** Cuántos activos se "compran" por semana. */
const TOP_N = 3
/** Debajo de esto el scoring dice que no es momento: esa semana no se opera. */
const MIN_SCORE = 60
/** Horizontes de medición, en semanas. */
const HORIZONS = [1, 2, 4] as const

const DAY_MS = 864e5
const WEEK_MS = 7 * DAY_MS
/** Días corridos por mes, para traducir el parámetro `months` a fechas. */
const DAYS_PER_MONTH = 30.44

/**
 * Ruedas de calentamiento antes de la primera semana simulada.
 *
 * El retorno de 90 días necesita la barra de hace 62 ruedas más la de hoy. Una
 * semana sin esa profundidad no puede puntuar momentum, así que simularla sería
 * medir una estrategia distinta de la real.
 */
const WARMUP_BARS = RETURN_BARS.d90 + 1

type UniverseRow = { symbol: string; sector: string; asset_type: string }

/** Una semana simulada, tal como se guarda. */
type WeekResult = {
  week_start: string
  selected_symbols: string[]
  selected_scores: Record<string, number>
  return_1w: number | null
  return_2w: number | null
  return_4w: number | null
  spy_return_1w: number | null
  spy_return_2w: number | null
  spy_return_4w: number | null
  alpha_1w: number | null
  alpha_2w: number | null
  alpha_4w: number | null
}

/** El último cierre con fecha <= `date`, o null si no hay ninguno. */
function closeAsOf(fechas: string[], porFecha: PricesByDate, date: string): number | null {
  // Búsqueda binaria: esto se llama decenas de miles de veces.
  let lo = 0
  let hi = fechas.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (fechas[mid] <= date) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (found < 0) return null
  const precio = porFecha.get(fechas[found])
  return precio !== undefined && precio > 0 ? precio : null
}

/** Retorno porcentual entre dos fechas, con el último cierre disponible en cada una. */
function returnBetween(
  fechas: string[],
  porFecha: PricesByDate,
  desde: string,
  hasta: string,
): number | null {
  const a = closeAsOf(fechas, porFecha, desde)
  const b = closeAsOf(fechas, porFecha, hasta)
  if (a === null || b === null || a <= 0) return null
  return (b / a - 1) * 100
}

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Lo que devuelve una simulación, antes de guardarse y de resumirse. */
export type BacktestOutput = {
  weeks: WeekResult[]
  skipped: { sinHistoria: number; sinFuturo: number; sinSenal: number }
  calendar: { desde: string; hasta: string; ruedas: number }
}

/**
 * La simulación completa, sin base de datos de por medio.
 *
 * Es una función pura —mismas entradas, misma salida, sin reloj ni red— y esa
 * es la propiedad que hace que el backtest sirva para algo: se puede correr dos
 * veces y comparar, y se puede probar con series armadas a mano.
 */
export function simulate(
  universeRows: UniverseRow[],
  history: PriceRow[],
  months: number,
  scoring: { weights: ScoreWeights; contrarianRsi: boolean } = VARIANTES[VARIANTE_DEFAULT],
  /**
   * MEP por fecha, para medir el régimen en dólares.
   *
   * Hoy llega casi vacío —`daily_mep` arranca sin historia y no hay backfill
   * posible—, así que las semanas viejas se miden en pesos igual que antes. El
   * backtest mejora solo a medida que la tabla se llena.
   */
  mepByDate: Map<string, number> = new Map(),
): BacktestOutput {
  // Los FCI y los bonos no son candidatos: un money market sube todos los días
  // un poquito y sin volatilidad, así que barre cualquier ranking de momentum y
  // se llevaría las tres compras de casi todas las semanas. Hoy en la base
  // vienen con `suggestable = false`, pero el backtest no puede depender de que
  // ese flag nunca cambie — es la misma lista negra que usa la matriz.
  const universe = universeRows.filter((u) => !UNCORRELATABLE_TYPES.has(u.asset_type))

  // ---------- Índices por símbolo ----------
  const closesByDate = new Map<string, PricesByDate>()
  const datesBySymbol = new Map<string, string[]>()
  const volumesBySymbol = new Map<string, Array<{ date: string; volume: number }>>()

  for (const row of history) {
    const porFecha = closesByDate.get(row.symbol) ?? new Map<string, number>()
    porFecha.set(row.recorded_at, row.close_price)
    closesByDate.set(row.symbol, porFecha)

    const fechas = datesBySymbol.get(row.symbol) ?? []
    fechas.push(row.recorded_at)
    datesBySymbol.set(row.symbol, fechas)

    if (row.volume !== null && Number.isFinite(row.volume)) {
      const vols = volumesBySymbol.get(row.symbol) ?? []
      vols.push({ date: row.recorded_at, volume: row.volume })
      volumesBySymbol.set(row.symbol, vols)
    }
  }

  // El calendario de mercado sale de los datos, no del almanaque: una fecha sin
  // ninguna rueda no existe para el backtest.
  const calendario = [...new Set(history.map((r) => r.recorded_at))].sort()
  const ultimaRueda = calendario[calendario.length - 1]

  // ---------- Semanas a simular ----------
  // Ancladas al último cierre de la base y NO al reloj: es lo que hace que dos
  // corridas del mismo día —y de días distintos, mientras no entren datos
  // nuevos— devuelvan exactamente lo mismo.
  const finMs = Date.parse(`${ultimaRueda}T00:00:00Z`)
  const inicioMs = finMs - months * DAYS_PER_MONTH * DAY_MS

  const semanas: string[] = []
  for (let t = inicioMs; t <= finMs; t += WEEK_MS) {
    const objetivo = isoDate(t)
    // La rueda efectiva de esa semana: la última con datos hasta esa fecha.
    let rueda: string | null = null
    for (let i = calendario.length - 1; i >= 0; i--) {
      if (calendario[i] <= objetivo) {
        rueda = calendario[i]
        break
      }
    }
    if (rueda && !semanas.includes(rueda)) semanas.push(rueda)
  }

  // ---------- Simulación ----------
  const resultados: WeekResult[] = []
  const saltadas = { sinHistoria: 0, sinFuturo: 0, sinSenal: 0 }

  // Lo que se estaría teniendo al momento de decidir: lo comprado la semana
  // anterior. Es lo que le da sentido a las componentes de correlación y de
  // concentración sectorial del score — sin cartera simulada esas dos serían
  // constantes y no ordenarían nada.
  let holdings: string[] = []
  const ultimaSeleccion = new Map<string, string>()

  for (const asOf of semanas) {
    const asOfMs = Date.parse(`${asOf}T00:00:00Z`)
    const ventanaDesde = isoDate(asOfMs - HISTORY_DAYS * DAY_MS)

    // Series recortadas a lo que se sabía ESE día, sobre la misma ventana que
    // ve el asesor en producción.
    const seriesHasta = new Map<string, number[]>()
    const porFechaHasta = new Map<string, PricesByDate>()

    for (const u of universe) {
      const fechas = datesBySymbol.get(u.symbol)
      const porFecha = closesByDate.get(u.symbol)
      if (!fechas || !porFecha) continue

      const visibles = fechas.filter((f) => f <= asOf && f >= ventanaDesde)
      if (!visibles.length) continue

      seriesHasta.set(u.symbol, visibles.map((f) => porFecha.get(f)!))
      porFechaHasta.set(u.symbol, new Map(visibles.map((f) => [f, porFecha.get(f)!])))
    }

    const profundidad = Math.max(0, ...[...seriesHasta.values()].map((s) => s.length))
    if (profundidad < WARMUP_BARS) {
      saltadas.sinHistoria++
      continue
    }

    // ── Ranking de fuerza relativa, igual que producción ──
    const ranking = relativeStrengthRank(
      [...seriesHasta.entries()].map(([symbol, serie]) => ({
        symbol,
        ret7d: periodReturn(serie, RETURN_BARS.d7),
        ret30d: periodReturn(serie, RETURN_BARS.d30),
        ret90d: periodReturn(serie, RETURN_BARS.d90),
      })),
    )
    const rankOf = new Map(ranking.map((r) => [r.symbol, r.rank]))

    // ── Correlaciones contra la cartera simulada ──
    const correlacionables = new Map<string, PricesByDate>()
    for (const u of universe) {
      const porFecha = porFechaHasta.get(u.symbol)
      if (porFecha) correlacionables.set(u.symbol, porFecha)
    }
    const matriz = correlationMatrix(correlacionables, { threshold: CORRELATION_THRESHOLD })

    const held = new Set(holdings)
    const maxCorrConCartera = new Map<string, number>()
    for (const [par, r] of matriz) {
      const [a, b] = par.split(':')
      for (const [uno, otro] of [[a, b], [b, a]]) {
        if (!held.has(otro) || held.has(uno)) continue
        maxCorrConCartera.set(uno, Math.max(maxCorrConCartera.get(uno) ?? 0, r))
      }
    }

    // ── Peso sectorial de la cartera simulada: equiponderada en TOP_N ──
    const sectorDe = new Map(universe.map((u) => [u.symbol, u.sector]))
    const pesoSector = new Map<string, number>()
    for (const symbol of holdings) {
      const sector = sectorDe.get(symbol)
      if (!sector) continue
      pesoSector.set(sector, (pesoSector.get(sector) ?? 0) + 100 / holdings.length)
    }

    // ── Régimen de esa semana ──
    // Solo con SPY: las noticias de hace ocho meses no están en `news_analysis`
    // y la cartera de entonces no existe, así que faltan dos de los cuatro
    // factores. El régimen que ve el backtest es más benigno que el real —
    // subestima, nunca exagera.
    const spyHasta = seriesHasta.get(BENCHMARK) ?? []
    const spyFechasHasta = (datesBySymbol.get(BENCHMARK) ?? [])
      .filter((f) => f <= asOf && f >= ventanaDesde)
    const spyUsd = mepByDate.size
      ? toUsdSeries(
        spyFechasHasta.map((f) => ({ date: f, close: closesByDate.get(BENCHMARK)!.get(f)! })),
        mepByDate,
      )
      : null
    const regimen = regimeFromPrices(spyHasta, spyUsd)

    // ── Score ──
    const scores: Array<{ symbol: string; score: ScoreBreakdown }> = []
    for (const u of universe) {
      const serie = seriesHasta.get(u.symbol)
      if (!serie?.length) continue

      const ind = technicals(serie, serie[serie.length - 1])
      const vols = (volumesBySymbol.get(u.symbol) ?? [])
        .filter((v) => v.date <= asOf)
        .map((v) => v.volume)
      const ventanaVol = vols.slice(-VOLUME_BARS)

      const ultimaRec = ultimaSeleccion.get(u.symbol)
      const diasDesdeRec = ultimaRec
        ? Math.floor((asOfMs - Date.parse(`${ultimaRec}T00:00:00Z`)) / DAY_MS)
        : null

      const crudo = investmentScore({
        rank: rankOf.get(u.symbol) ?? ranking.length,
        totalRanked: ranking.length,
        rsi: ind?.rsi14 ?? null,
        macdSignal: ind?.macd
          ? (macdSignal(ind.macd, ind.price) as 'alcista' | 'bajista' | 'neutral')
          : 'neutral',
        aboveSma50: ind?.sma50 != null ? ind.price > ind.sma50 : null,
        aboveSma20: ind?.sma20 != null ? ind.price > ind.sma20 : null,
        avgVolume20d: ventanaVol.length >= VOLUME_BARS
          ? ventanaVol.reduce((s, v) => s + v, 0) / ventanaVol.length
          : null,
        lastVolume: vols.length ? vols[vols.length - 1] : null,
        maxCorrelationWithHeld: maxCorrConCartera.get(u.symbol) ?? null,
        sectorWeightPct: pesoSector.get(u.sector) ?? 0,
        daysSinceLastRec: diasDesdeRec,
        weights: scoring.weights,
        contrarianRsi: scoring.contrarianRsi,
      })

      // Mismo tratamiento que en producción: el régimen multiplica el total.
      scores.push({
        symbol: u.symbol,
        score: { ...crudo, total: Math.round(crudo.total * regimen.scoringModifier) },
      })
    }

    // Desempate por símbolo: sin esto el orden de dos scores iguales queda
    // librado a la implementación del sort y la corrida deja de ser reproducible.
    const elegidos = scores
      .filter((s) => s.score.total >= MIN_SCORE)
      .sort((a, b) => b.score.total - a.score.total || a.symbol.localeCompare(b.symbol))
      .slice(0, TOP_N)

    // ── Medición ──
    const retornoPorHorizonte = new Map<number, number | null>()
    const spyPorHorizonte = new Map<number, number | null>()

    for (const semanas_ of HORIZONS) {
      const hasta = isoDate(asOfMs + semanas_ * WEEK_MS)
      // Más allá del último dato no hay futuro que medir: es null, no cero.
      if (hasta > ultimaRueda) {
        retornoPorHorizonte.set(semanas_, null)
        spyPorHorizonte.set(semanas_, null)
        continue
      }

      const spyFechas = datesBySymbol.get(BENCHMARK)
      const spyPrecios = closesByDate.get(BENCHMARK)
      spyPorHorizonte.set(
        semanas_,
        spyFechas && spyPrecios ? returnBetween(spyFechas, spyPrecios, asOf, hasta) : null,
      )

      if (!elegidos.length) {
        retornoPorHorizonte.set(semanas_, null)
        continue
      }

      const rets = elegidos
        .map((e) => {
          const fechas = datesBySymbol.get(e.symbol)
          const precios = closesByDate.get(e.symbol)
          return fechas && precios ? returnBetween(fechas, precios, asOf, hasta) : null
        })
        .filter((r): r is number => r !== null)

      retornoPorHorizonte.set(
        semanas_,
        rets.length ? rets.reduce((s, r) => s + r, 0) / rets.length : null,
      )
    }

    const alpha = (h: number) => {
      const propio = retornoPorHorizonte.get(h)
      const spy = spyPorHorizonte.get(h)
      return propio !== null && propio !== undefined && spy !== null && spy !== undefined
        ? propio - spy
        : null
    }

    if (!elegidos.length) saltadas.sinSenal++
    if (retornoPorHorizonte.get(1) === null && elegidos.length) saltadas.sinFuturo++

    resultados.push({
      week_start: asOf,
      selected_symbols: elegidos.map((e) => e.symbol),
      selected_scores: Object.fromEntries(elegidos.map((e) => [e.symbol, e.score.total])),
      return_1w: retornoPorHorizonte.get(1) ?? null,
      return_2w: retornoPorHorizonte.get(2) ?? null,
      return_4w: retornoPorHorizonte.get(4) ?? null,
      spy_return_1w: spyPorHorizonte.get(1) ?? null,
      spy_return_2w: spyPorHorizonte.get(2) ?? null,
      spy_return_4w: spyPorHorizonte.get(4) ?? null,
      alpha_1w: alpha(1),
      alpha_2w: alpha(2),
      alpha_4w: alpha(4),
    })

    // La cartera de la semana que viene es lo que se compró en esta.
    if (elegidos.length) {
      holdings = elegidos.map((e) => e.symbol)
      for (const e of elegidos) ultimaSeleccion.set(e.symbol, asOf)
    }
  }

  return {
    weeks: resultados,
    skipped: saltadas,
    calendar: { desde: calendario[0], hasta: ultimaRueda, ruedas: calendario.length },
  }
}

/**
 * El resumen que se devuelve por HTTP. También puro: se calcula sobre lo que
 * devolvió `simulate`, sin volver a la base.
 */
export function summarize(out: BacktestOutput, strategy: string, months: number) {
  const resultados = out.weeks
  const conAlpha = (h: 'alpha_1w' | 'alpha_2w' | 'alpha_4w') =>
    resultados.map((r) => r[h]).filter((v): v is number => v !== null)

  const promedio = (vals: number[]) =>
    vals.length ? Number((vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(2)) : null
  const winRate = (vals: number[]) =>
    vals.length ? Number((vals.filter((v) => v > 0).length / vals.length).toFixed(2)) : null

  const alpha1 = conAlpha('alpha_1w')
  const alpha4 = conAlpha('alpha_4w')

  const medidas = resultados.filter((r) => r.alpha_4w !== null)
  const ordenadas = [...medidas].sort(
    (a, b) => a.alpha_4w! - b.alpha_4w! || a.week_start.localeCompare(b.week_start),
  )

  return {
    strategy,
    months,
    weeks_tested: medidas.length,
    weeks_simulated: resultados.length,
    // Por qué no se midieron todas: sin esto, un `weeks_tested: 0` no dice si
    // falta historia vieja o futuro para medir.
    skipped: {
      sin_historia_suficiente: out.skipped.sinHistoria,
      sin_futuro_para_medir: out.skipped.sinFuturo,
      sin_senal_sobre_el_minimo: out.skipped.sinSenal,
    },
    data_range: out.calendar,
    avg_alpha_1w: promedio(alpha1),
    avg_alpha_4w: promedio(alpha4),
    win_rate_1w: winRate(alpha1),
    win_rate_4w: winRate(alpha4),
    cumulative_alpha: alpha4.length
      ? Number(alpha4.reduce((s, v) => s + v, 0).toFixed(2))
      : null,
    worst_week: ordenadas.length
      ? { date: ordenadas[0].week_start, alpha_4w: Number(ordenadas[0].alpha_4w!.toFixed(2)) }
      : null,
    best_week: ordenadas.length
      ? {
        date: ordenadas[ordenadas.length - 1].week_start,
        alpha_4w: Number(ordenadas[ordenadas.length - 1].alpha_4w!.toFixed(2)),
      }
      : null,
  }
}

Deno.serve(async (req) => {
  // Solo service role: es una corrida pesada y no tiene por qué dispararse
  // desde la app.
  if (!isServiceRole(req)) return unauthorized()

  let body: { strategy?: string; months?: number; weights?: string } = {}
  try {
    body = await req.json()
  } catch {
    // Sin body se usan los defaults.
  }

  const variante = body.weights ?? VARIANTE_DEFAULT
  const scoring = VARIANTES[variante]
  if (!scoring) {
    return Response.json(
      { error: `variante de pesos desconocida: ${variante}. Opciones: ${Object.keys(VARIANTES).join(', ')}` },
      { status: 400 },
    )
  }

  // El nombre de la estrategia sale de la variante, así que las corridas quedan
  // distinguibles en `backtest_results` sin que haya que acordarse de pasarlo.
  const strategy = body.strategy ?? `score_${variante}`
  const months = body.months ?? 12

  const { data: universeRows } = await db
    .from('asset_metadata')
    .select('symbol, sector, asset_type')
    .eq('suggestable', true)

  const universe = (universeRows ?? []) as UniverseRow[]
  if (!universe.length) {
    return Response.json({ error: 'no hay universo sugerible' }, { status: 400 })
  }

  // Se lee todo de una: la ventana simulada más el calentamiento que necesita
  // la primera semana, más el horizonte más largo para poder medirla.
  const desdeMs = Date.now() - (months * DAYS_PER_MONTH + HISTORY_DAYS + 60) * DAY_MS
  const history = await fetchPriceHistory(db, isoDate(desdeMs), (m) =>
    console.error('[backtest] price_history:', m),
  )
  if (!history.length) {
    return Response.json({ error: 'no hay price_history en la ventana pedida' }, { status: 400 })
  }

  // El MEP disponible del período. Mientras `daily_mep` esté vacía esto es un
  // mapa vacío y el régimen se mide en pesos, que es el comportamiento actual.
  const { data: mepRows } = await db
    .from('daily_mep')
    .select('recorded_date, mep_rate')
    .gte('recorded_date', isoDate(desdeMs))
  const mepByDate = new Map(
    (mepRows ?? []).map((r) => [String(r.recorded_date), Number(r.mep_rate)]),
  )

  const out = simulate(universe, history, months, scoring, mepByDate)
  const resultados = out.weeks

  // ---------- Persistencia ----------
  // Se agrega, no se pisa: comparar 'score_v1' contra la próxima versión de los
  // pesos es justamente para lo que sirve la tabla.
  if (resultados.length) {
    const { error } = await db.from('backtest_results').insert(
      resultados.map((r) => ({ strategy, ...r })),
    )
    if (error) {
      console.error('[backtest] no se pudo guardar:', error.message)
      return Response.json({ error: `no se pudo guardar: ${error.message}` }, { status: 500 })
    }
  }

  return Response.json({ ...summarize(out, strategy, months), weights: variante })
})
