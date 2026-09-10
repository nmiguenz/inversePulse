/**
 * Detector de régimen de mercado.
 *
 * El scoring mide señales técnicas activo por activo y es ciego a lo macro:
 * puede darle 80 puntos a un semiconductor con buen momentum el mismo día en
 * que todo el sector se está desarmando. Esto es la síntesis que falta — una
 * sola señal de nivel superior que diga "hoy es día de proteger capital" antes
 * de que el asesor y el scoring corran.
 *
 * NO usa IA. Es aritmética sobre datos que ya están en la base: el sentimiento
 * que `analyze-news` dejó en `news_analysis`, el comportamiento de SPY en
 * `price_history`, y cuántas posiciones del usuario están en rojo hoy. No
 * inventa un dato nuevo: convierte cuatro que ya existen en una decisión.
 *
 * Tampoco se guarda en ninguna tabla. Se calcula al vuelo, como los
 * indicadores: un régimen guardado es un régimen viejo.
 *
 * ── Sobre los factores que faltan ───────────────────────────────────────
 *
 * Los cuatro factores no siempre están. El backtest solo puede reconstruir dos
 * —SPY y volatilidad— porque las noticias viejas no están en `news_analysis` y
 * la composición de la cartera de hace ocho meses no existe. Un factor ausente
 * NO se renormaliza: aporta cero, o sea neutral. La consecuencia es deliberada
 * y hay que tenerla presente al leer un backtest: con la mitad del peso
 * disponible, el total nunca llega a `crisis` y el régimen se ve más benigno de
 * lo que fue.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { realizedVol, rsi } from './indicators.ts'

export type MarketRegime = 'risk_on' | 'risk_off' | 'crisis'

export type RegimeFactor = {
  source: 'news' | 'spy' | 'breadth' | 'volatility'
  signal: 'bullish' | 'bearish' | 'neutral'
  weight: number
  detail: string
  /**
   * La contribución real, de -1 a +1.
   *
   * Va aparte de `signal` porque hay medias tintas que las tres etiquetas no
   * saben expresar: una cartera con el 70% en rojo no está "neutral" ni
   * "bearish" del todo, y redondearla a cualquiera de las dos falsea la suma.
   */
  score: number
}

export type RegimeSignal = {
  regime: MarketRegime
  /** 0-100: qué tan clara es la señal, no qué tan mala. */
  confidence: number
  summary: string
  factors: RegimeFactor[]
  spyTrend: string
  newsSentiment: string
  /** Multiplicador del scoring: 1.0 normal, 0.5 risk-off, 0.2 crisis. */
  scoringModifier: number
}

/** Cuánto pesa cada factor en el total. Suman 1. */
const WEIGHTS = { news: 0.35, spy: 0.30, breadth: 0.20, volatility: 0.15 }

/** Ventana de noticias que se considera "reciente". */
const NEWS_HOURS = 24
/** Ventanas de volatilidad: la corta capta el cambio, la larga es la referencia. */
const VOL_SHORT_BARS = 11
const VOL_LONG_BARS = 31

/** El benchmark. El mismo que usan las evaluaciones y el backtest. */
const BENCHMARK = 'SPY'

/**
 * Días de MEP mínimos para animarse a convertir a dólares.
 *
 * Con menos que esto la serie en dólares no tiene forma, y el fallback en pesos
 * —sesgado, pero estable— es mejor que una conversión sobre cuatro puntos.
 */
const MIN_MEP_DAYS = 5

/** Cuánto pesa una noticia según su impacto. */
const IMPACT_POINTS: Record<string, number> = { high: 3, medium: 2, low: 1 }

// ============================================================
// Factores
// ============================================================

/**
 * A) Sentimiento de noticias.
 *
 * Se pondera por impacto: una noticia de impacto alto vale tres veces una de
 * impacto bajo. Las neutrales cuentan en el denominador —diluyen— pero no
 * empujan para ningún lado.
 */
export function newsFactor(
  rows: Array<{ sentiment: string | null; impact_level: string | null }>,
): { factor: RegimeFactor; sentiment: string } {
  let positivos = 0
  let negativos = 0
  let neutrales = 0
  let total = 0

  for (const r of rows) {
    const puntos = IMPACT_POINTS[r.impact_level ?? 'low'] ?? 1
    total += puntos
    if (r.sentiment === 'positive') positivos += puntos
    else if (r.sentiment === 'negative') negativos += puntos
    else neutrales += puntos
  }

  if (!rows.length || total === 0) {
    return {
      factor: {
        source: 'news',
        signal: 'neutral',
        weight: WEIGHTS.news,
        detail: 'sin noticias analizadas en las últimas 24hs',
        score: 0,
      },
      sentiment: 'sin noticias recientes',
    }
  }

  const score = (positivos - negativos) / total
  const signal = score < -0.3 ? 'bearish' : score > 0.3 ? 'bullish' : 'neutral'
  const negCount = rows.filter((r) => r.sentiment === 'negative').length

  return {
    factor: {
      source: 'news',
      signal,
      weight: WEIGHTS.news,
      detail: `${negCount} de ${rows.length} noticias negativas (score ${score.toFixed(2)} ponderado por impacto)`,
      score: signal === 'bearish' ? -1 : signal === 'bullish' ? 1 : 0,
    },
    sentiment: `${negCount} de ${rows.length} noticias recientes son negativas`,
  }
}

/**
 * B) Tendencia de SPY.
 *
 * Tres días seguidos de caída con el acumulado en rojo es distinto de una
 * caída fuerte de un solo día: lo primero es un mercado que se está dando
 * vuelta, lo segundo puede ser una noticia puntual.
 */
export function spyFactor(closes: number[]): { factor: RegimeFactor; trend: string; ret5d: number } {
  if (closes.length < 6) {
    return {
      factor: {
        source: 'spy',
        signal: 'neutral',
        weight: WEIGHTS.spy,
        detail: 'sin serie suficiente de SPY',
        score: 0,
      },
      trend: 'sin datos de SPY',
      ret5d: 0,
    }
  }

  const ultimo = closes[closes.length - 1]
  const hace5 = closes[closes.length - 6]
  const ret5d = hace5 > 0 ? (ultimo / hace5 - 1) * 100 : 0

  let diasEnBaja = 0
  for (let i = closes.length - 1; i >= 1; i--) {
    if (closes[i] < closes[i - 1]) diasEnBaja++
    else break
  }

  const rsiSpy = rsi(closes)

  const bearish = diasEnBaja >= 3 && ret5d < -2
  const bullish = ret5d > 2 && (rsiSpy === null || rsiSpy < 70)
  const signal = bearish ? 'bearish' : bullish ? 'bullish' : 'neutral'

  const trend = diasEnBaja >= 2
    ? `cayendo ${diasEnBaja} días consecutivos (${ret5d >= 0 ? '+' : ''}${ret5d.toFixed(1)}% en 5d)`
    : `${ret5d >= 0 ? '+' : ''}${ret5d.toFixed(1)}% en 5 días`

  return {
    factor: {
      source: 'spy',
      signal,
      weight: WEIGHTS.spy,
      detail: `SPY ${trend}${rsiSpy !== null ? `, RSI ${rsiSpy.toFixed(0)}` : ''}`,
      score: bearish ? -1 : bullish ? 1 : 0,
    },
    trend,
    ret5d,
  }
}

/**
 * Serie de cierres en dólares, sin huecos.
 *
 * Solo se toma el tramo MÁS RECIENTE que tiene MEP para todas sus ruedas: si
 * faltara el tipo de cambio de un día del medio, saltearlo pegaría dos ruedas
 * no consecutivas y el conteo de "días seguidos de caída" mediría algo que no
 * pasó. Se corta en el primer hueco yendo hacia atrás.
 */
export function toUsdSeries(
  arsByDate: Array<{ date: string; close: number }>,
  mepByDate: Map<string, number>,
): number[] {
  const out: number[] = []
  for (let i = arsByDate.length - 1; i >= 0; i--) {
    const { date, close } = arsByDate[i]
    const mep = mepByDate.get(date)
    if (!mep || mep <= 0 || close <= 0) break
    out.push(close / mep)
  }
  return out.reverse()
}

/**
 * El factor de SPY mirando las dos monedas y quedándose con la peor.
 *
 * El CEDEAR cotiza en pesos, así que una devaluación lo empuja para arriba
 * mientras el índice cae en dólares: medido solo en pesos, el régimen se pierde
 * exactamente las caídas que más importan. Cuando hay MEP suficiente se calcula
 * también la serie en dólares y gana la señal más pesimista de las dos — no un
 * promedio: si en alguna de las dos monedas el mercado se está cayendo, el día
 * es defensivo.
 *
 * Sin MEP suficiente devuelve lo mismo que antes, en pesos.
 */
export function spyFactorDual(
  ars: number[],
  usd: number[] | null,
): { factor: RegimeFactor; trend: string; comparison: string | null } {
  const enPesos = spyFactor(ars)
  if (!usd || usd.length < 6) return { ...enPesos, comparison: null }

  const enUsd = spyFactor(usd)
  // "Peor" es el score más bajo: bearish (-1) < neutral (0) < bullish (+1).
  const peor = enUsd.factor.score < enPesos.factor.score ? enUsd : enPesos
  const cual = peor === enUsd ? 'USD' : 'pesos'

  const comparison =
    `pesos ${enPesos.ret5d >= 0 ? '+' : ''}${enPesos.ret5d.toFixed(1)}% (${enPesos.factor.signal}) ` +
    `vs USD ${enUsd.ret5d >= 0 ? '+' : ''}${enUsd.ret5d.toFixed(1)}% (${enUsd.factor.signal}) ` +
    `-> usando ${peor.factor.signal} (${cual})`

  return {
    factor: {
      ...peor.factor,
      detail: `${peor.factor.detail} [en ${cual}; 5d en pesos ${enPesos.ret5d.toFixed(1)}%, en USD ${enUsd.ret5d.toFixed(1)}%]`,
    },
    trend: peor.trend,
    comparison,
  }
}

/**
 * C) Breadth de la cartera.
 *
 * No es un indicador de mercado sino de IMPACTO PERSONAL. Un día en que tech
 * cae 3% es peor para alguien con el 39% en semiconductores que para alguien
 * diversificado, y el régimen tiene que hablarle a la cartera que existe, no
 * al índice.
 */
export function breadthFactor(
  positions: Array<{ current_price: number; previous_close: number | null }>,
): RegimeFactor {
  const conDato = positions.filter((p) => (p.previous_close ?? 0) > 0)
  if (!conDato.length) {
    return {
      source: 'breadth',
      signal: 'neutral',
      weight: WEIGHTS.breadth,
      detail: 'sin variación diaria disponible',
      score: 0,
    }
  }

  const enRojo = conDato.filter((p) => p.current_price < (p.previous_close ?? 0)).length
  const pct = (enRojo / conDato.length) * 100

  // El tramo 60-80% es el que no entra en ninguna etiqueta: no es un día
  // normal, pero tampoco es la cartera entera en rojo. Puntúa medio punto
  // negativo en vez de redondearse a una de las dos.
  const score = pct > 80 ? -1 : pct > 60 ? -0.5 : pct < 40 ? 1 : 0
  const signal = score < 0 ? 'bearish' : score > 0 ? 'bullish' : 'neutral'

  return {
    source: 'breadth',
    signal,
    weight: WEIGHTS.breadth,
    detail: `${enRojo} de ${conDato.length} posiciones en rojo hoy (${pct.toFixed(0)}%)`,
    score,
  }
}

/**
 * D) Volatilidad.
 *
 * Lo que importa no es el nivel sino el CAMBIO: una volatilidad de 40% es
 * normal en semis y alarmante en un defensivo. Comparar la ventana de 10
 * ruedas contra la de 30 dice si el mercado se está poniendo nervioso ahora.
 */
export function volatilityFactor(closes: number[]): RegimeFactor {
  const corta = realizedVol(closes.slice(-VOL_SHORT_BARS))
  const larga = realizedVol(closes.slice(-VOL_LONG_BARS))

  if (corta === null || larga === null || larga <= 0) {
    return {
      source: 'volatility',
      signal: 'neutral',
      weight: WEIGHTS.volatility,
      detail: 'sin serie suficiente para comparar volatilidades',
      score: 0,
    }
  }

  const ratio = corta / larga
  const score = ratio > 1.5 ? -1 : ratio < 0.8 ? 1 : 0
  const signal = score < 0 ? 'bearish' : score > 0 ? 'bullish' : 'neutral'

  return {
    source: 'volatility',
    signal,
    weight: WEIGHTS.volatility,
    detail: `vol 10d ${corta.toFixed(0)}% vs 30d ${larga.toFixed(0)}% (${ratio.toFixed(2)}x)`,
    score,
  }
}

// ============================================================
// Combinación
// ============================================================

/**
 * De los factores al régimen.
 *
 * La suma ponderada NO se renormaliza por los factores presentes: uno que
 * falta aporta cero, que es lo mismo que decir "no sé nada, no empujo". Eso
 * hace que un contexto con datos incompletos —el backtest— tienda al centro en
 * vez de amplificar los dos factores que sí tiene.
 */
export function combineFactors(
  factors: RegimeFactor[],
  extras: { spyTrend: string; newsSentiment: string },
): RegimeSignal {
  const total = factors.reduce((sum, f) => sum + f.score * f.weight, 0)

  const regime: MarketRegime = total < -0.5 ? 'crisis' : total < -0.2 ? 'risk_off' : 'risk_on'
  const scoringModifier = total < -0.5 ? 0.2 : total < -0.2 ? 0.5 : total <= 0.2 ? 0.85 : 1.0
  const confidence = Math.max(0, Math.min(100, Math.round(Math.abs(total) * 100)))

  const contras = factors.filter((f) => f.score < 0)
  const aFavor = factors.filter((f) => f.score > 0)

  const summary = regime === 'crisis'
    ? `Mercado en modo crisis: ${contras.map((f) => f.detail).join('; ')}.`
    : regime === 'risk_off'
    ? `Mercado defensivo: ${contras.map((f) => f.detail).join('; ')}.`
    : contras.length
    ? `Mercado sin señales de alarma, con reservas: ${contras.map((f) => f.detail).join('; ')}.`
    : `Mercado normal${aFavor.length ? `: ${aFavor.map((f) => f.detail).join('; ')}` : ''}.`

  return {
    regime,
    confidence,
    summary,
    factors,
    spyTrend: extras.spyTrend,
    newsSentiment: extras.newsSentiment,
    scoringModifier,
  }
}

/**
 * Régimen a partir SOLO de la serie de SPY: tendencia y volatilidad.
 *
 * Es lo que puede reconstruir el backtest para una semana de hace meses. Le
 * faltan noticias y breadth, o sea el 55% del peso, así que subestima el
 * régimen a propósito — ver la nota del encabezado.
 */
export function regimeFromPrices(spyCloses: number[], spyUsd?: number[] | null): RegimeSignal {
  const { factor: spy, trend } = spyFactorDual(spyCloses, spyUsd ?? null)
  // La volatilidad se mide sobre la misma serie que la tendencia: si hay
  // dólares, la expansión de volatilidad también se mide ahí.
  const vol = volatilityFactor(spyUsd && spyUsd.length >= 6 ? spyUsd : spyCloses)
  return combineFactors([spy, vol], {
    spyTrend: trend,
    newsSentiment: 'sin noticias (backtest histórico)',
  })
}

/**
 * Calcula el régimen de mercado actual con los cuatro factores.
 *
 * Las tres consultas van en paralelo: ninguna depende de las otras y el asesor
 * está esperando para armar su contexto.
 */
export async function detectMarketRegime(
  db: SupabaseClient,
  userId: string,
): Promise<RegimeSignal> {
  const desde = new Date(Date.now() - NEWS_HOURS * 3600_000).toISOString()

  const [{ data: news }, { data: spyRows }, { data: positions }, { data: mepRows }] = await Promise.all([
    db
      .from('news_analysis')
      .select('sentiment, impact_level')
      .eq('user_id', userId)
      .gte('created_at', desde),
    db
      .from('price_history')
      .select('close_price, recorded_at')
      .eq('symbol', BENCHMARK)
      .order('recorded_at', { ascending: false })
      .limit(VOL_LONG_BARS),
    db
      .from('positions')
      .select('current_price, previous_close')
      .eq('user_id', userId),
    db
      .from('daily_mep')
      .select('recorded_date, mep_rate')
      .order('recorded_date', { ascending: false })
      .limit(VOL_LONG_BARS),
  ])

  // La consulta trae de la más nueva a la más vieja porque el LIMIT tiene que
  // agarrar las últimas; los cálculos las quieren al revés.
  const spyPorFecha = (spyRows ?? [])
    .map((r) => ({ date: String(r.recorded_at), close: Number(r.close_price) }))
    .reverse()
  const closes = spyPorFecha.map((r) => r.close)

  // La serie en dólares solo se intenta con MEP suficiente. Mientras la tabla
  // se llena —arranca vacía, sin backfill posible— esto devuelve null y todo
  // sigue midiéndose en pesos.
  const mepPorFecha = new Map(
    (mepRows ?? []).map((r) => [String(r.recorded_date), Number(r.mep_rate)]),
  )
  const enUsd = mepPorFecha.size >= MIN_MEP_DAYS ? toUsdSeries(spyPorFecha, mepPorFecha) : null

  const { factor: spy, trend, comparison } = spyFactorDual(closes, enUsd)
  if (comparison) console.log(`[regime] SPY: ${comparison}`)

  const { factor: newsF, sentiment } = newsFactor(news ?? [])
  const breadth = breadthFactor(positions ?? [])
  const vol = volatilityFactor(enUsd && enUsd.length >= 6 ? enUsd : closes)

  // El orden importa solo para cómo se lee el prompt: primero lo macro, después
  // lo que le pasa a esta cartera en particular.
  return combineFactors([newsF, spy, breadth, vol], {
    spyTrend: trend,
    newsSentiment: sentiment,
  })
}

/** Cuántas ruedas de SPY necesita el detector para no quedarse corto. */
export const REGIME_SPY_BARS = VOL_LONG_BARS
