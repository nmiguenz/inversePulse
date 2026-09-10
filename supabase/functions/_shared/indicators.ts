/**
 * Indicadores técnicos sobre una serie de cierres.
 *
 * Aritmética pura sobre arrays de precios: sin dependencias, sin acceso a la
 * base, sin estado. Los indicadores NO se guardan en ninguna tabla — se
 * calculan al vuelo desde `price_history` cada vez que el asesor arma su
 * contexto, así que la serie es lo único que entra y un número o un string es
 * lo único que sale.
 *
 * Todas las funciones devuelven `null` cuando la serie es más corta que lo que
 * el indicador necesita. Un RSI calculado con 4 barras no es un RSI malo, es
 * un número inventado: es preferible que el asesor no vea el dato a que lo lea
 * como si valiera.
 *
 * La serie tiene que venir ordenada de más vieja a más nueva.
 */

/** Período clásico de Wilder para el RSI. */
const RSI_PERIOD = 14
/** Arriba de esto está sobrecomprado; abajo del piso, sobrevendido. */
const RSI_OVERBOUGHT = 70
const RSI_OVERSOLD = 30

/** MACD estándar: EMA rápida, EMA lenta y EMA de la línea (la señal). */
const MACD_FAST = 12
const MACD_SLOW = 26
const MACD_SIGNAL = 9
/**
 * Mínimo de barras para un MACD que signifique algo: 26 para que exista la EMA
 * lenta, más 9 para que la señal tenga su propia ventana completa.
 */
const MIN_MACD_SAMPLES = MACD_SLOW + MACD_SIGNAL

/**
 * Banda muerta del histograma, como fracción del precio.
 *
 * El histograma es una diferencia entre medias, así que su escala es la del
 * activo: 0,4 es ruido en un CEDEAR de $1.200.000 y es una señal clara en uno
 * de $20. Sin normalizar por precio, "alcista" saldría casi siempre en los
 * caros y casi nunca en los baratos.
 */
const MACD_NEUTRAL_BAND = 0.005

/** Ventanas de las medias: 20 para el corto plazo, 50 para el mediano. */
export const SMA_SHORT = 20
export const SMA_LONG = 50

/**
 * Ventana de cierres sobre la que se calcula TODO, en días corridos.
 *
 * `price_history` guarda un cierre por rueda, así que los días corridos se
 * convierten a ~5/7. Lo que manda es el retorno de 90 días: para tenerlo hace
 * falta la barra de hace ~62 ruedas MÁS la de hoy, y 90 días corridos dan justo
 * ~62 — un feriado y el retorno sale null para todos. 120 corridos dan ~85
 * ruedas, que cubren con margen los tres retornos, la SMA50 y el MACD.
 *
 * Vive acá y no en `portfolio-advisor` porque el backtest tiene que usar
 * exactamente la misma ventana: si simula con más historia de la que ve
 * producción, mide otra estrategia.
 */
export const HISTORY_DAYS = 120

/**
 * Cuántas RUEDAS cubre cada plazo del ranking de fuerza relativa.
 *
 * Los retornos se cuentan en barras, no en fechas: la serie tiene un cierre por
 * rueda, así que 7 días corridos son 5 barras, 30 son ~21 y 90 son ~62. La
 * etiqueta que ve el modelo sigue siendo el plazo de calendario.
 */
export const RETURN_BARS = { d7: 5, d30: 21, d90: 62 }

/** Ruedas del promedio de volumen contra el que se compara la última. */
export const VOLUME_BARS = 20

/** Desde acá dos activos se consideran "la misma apuesta". */
export const CORRELATION_THRESHOLD = 0.7

/** Una serie con un NaN o un infinito envenena todo lo que se calcule con ella. */
function usable(prices: number[]): boolean {
  return prices.every((p) => Number.isFinite(p))
}

/**
 * RSI de Wilder, 0-100.
 *
 * Primer promedio simple sobre `period` variaciones y de ahí en adelante el
 * suavizado de Wilder, que es lo que lo distingue de un RSI de medias simples:
 * cada barra nueva pesa 1/period y el resto arrastra la historia.
 *
 * Una serie sin bajas da 100 y una sin subas da 0 — son los extremos reales
 * del indicador, no un error. Una serie plana devuelve 50: no hay fuerza para
 * ningún lado.
 */
export function rsi(prices: number[], period = RSI_PERIOD): number | null {
  if (period < 1) return null
  // Hacen falta period+1 precios para tener period variaciones.
  if (prices.length < period + 1) return null
  if (!usable(prices)) return null

  let avgGain = 0
  let avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1]
    if (change > 0) avgGain += change
    else avgLoss -= change
  }
  avgGain /= period
  avgLoss /= period

  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1]
    const gain = change > 0 ? change : 0
    const loss = change < 0 ? -change : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
  }

  if (avgLoss === 0) return avgGain === 0 ? 50 : 100
  return 100 - 100 / (1 + avgGain / avgLoss)
}

/** Media móvil simple de las últimas `period` barras. */
export function sma(prices: number[], period: number): number | null {
  if (period < 1) return null
  if (prices.length < period) return null

  let sum = 0
  for (let i = prices.length - period; i < prices.length; i++) {
    if (!Number.isFinite(prices[i])) return null
    sum += prices[i]
  }
  return sum / period
}

/**
 * Serie de EMA, sembrada con la media simple de las primeras `period` barras.
 *
 * El resultado arranca en el índice `period - 1` de la serie original: no hay
 * EMA antes de tener la primera ventana completa. Los llamadores alinean con
 * ese corrimiento.
 */
function emaSeries(prices: number[], period: number): number[] {
  const k = 2 / (period + 1)

  let seed = 0
  for (let i = 0; i < period; i++) seed += prices[i]

  let current = seed / period
  const out = [current]
  for (let i = period; i < prices.length; i++) {
    current = prices[i] * k + current * (1 - k)
    out.push(current)
  }
  return out
}

/**
 * MACD estándar (12, 26, 9).
 *
 * `macd` es la distancia entre las dos EMAs, `signal` es la EMA de 9 de esa
 * distancia, y `histogram` es lo que sobra entre las dos: positivo cuando el
 * impulso se acelera, negativo cuando se apaga.
 */
export function macd(
  prices: number[],
): { macd: number; signal: number; histogram: number } | null {
  if (prices.length < MIN_MACD_SAMPLES) return null
  if (!usable(prices)) return null

  const fast = emaSeries(prices, MACD_FAST)
  const slow = emaSeries(prices, MACD_SLOW)

  // La EMA rápida existe desde antes que la lenta: hay que descartarle ese
  // arranque para restar dos valores del MISMO día.
  const offset = MACD_SLOW - MACD_FAST
  const line = slow.map((s, i) => fast[i + offset] - s)
  if (line.length < MACD_SIGNAL) return null

  const signalLine = emaSeries(line, MACD_SIGNAL)
  const macdValue = line[line.length - 1]
  const signal = signalLine[signalLine.length - 1]
  return { macd: macdValue, signal, histogram: macdValue - signal }
}

/**
 * Dónde está el precio respecto de una media, en palabras.
 *
 * `period` es solo para nombrar la media en el texto ("SMA50"): el número ya
 * viene calculado. Sin él la frase queda genérica.
 */
export function priceVsSma(
  currentPrice: number,
  smaValue: number,
  period?: number,
): string {
  const name = period ? `SMA${period}` : 'la media móvil'
  if (!(smaValue > 0) || !Number.isFinite(currentPrice)) return `sin ${name}`

  const diff = (currentPrice / smaValue - 1) * 100
  const side = diff >= 0 ? 'por encima de' : 'por debajo de'
  return `${side} ${name} (${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%)`
}

/** Zona del RSI en una palabra, que es como la lee el prompt. */
export function rsiZone(rsi: number): string {
  if (rsi > RSI_OVERBOUGHT) return 'sobrecompra'
  if (rsi < RSI_OVERSOLD) return 'sobrevendido'
  return 'neutral'
}

/**
 * Dirección del MACD en una palabra.
 *
 * `price` sirve para medir la banda muerta: sin precio no hay contra qué
 * relativizar el histograma, así que solo queda el signo.
 */
export function macdSignal(m: { histogram: number }, price?: number): string {
  const band = price && price > 0 ? price * MACD_NEUTRAL_BAND : 0
  if (Math.abs(m.histogram) <= band) return 'neutral'
  return m.histogram > 0 ? 'alcista' : 'bajista'
}

/**
 * Retorno porcentual de las últimas `days` BARRAS, no días corridos.
 *
 * La serie es de cierres, uno por rueda: entre dos barras hay un día hábil,
 * pero entre la primera y la última de un mes hay un mes de calendario. Quien
 * llama decide cuántas barras representan el plazo que quiere mostrar — acá
 * solo se cuenta hacia atrás desde el último cierre.
 */
export function periodReturn(prices: number[], days: number): number | null {
  if (days < 1) return null
  // days+1 barras: la de hace `days` ruedas y la última.
  if (prices.length < days + 1) return null

  const past = prices[prices.length - 1 - days]
  const last = prices[prices.length - 1]
  if (!(past > 0) || !Number.isFinite(last)) return null
  return (last / past - 1) * 100
}

/** Retornos de un símbolo en los tres plazos que alimentan el ranking. */
export type AssetReturns = {
  symbol: string
  ret7d: number | null
  ret30d: number | null
  ret90d: number | null
}

/** Posición de un símbolo en el ranking de fuerza relativa. */
export type StrengthRank = { symbol: string; rank: number; score: number }

/**
 * Pesos del score compuesto.
 *
 * El plazo medio manda —es el que separa una tendencia de un rebote— y los
 * otros dos lo acompañan: 7 días para que el ranking reaccione a lo que pasó
 * esta semana, 90 para no premiar a un activo que rebotó dentro de una caída
 * larga.
 */
const RS_WEIGHT_7D = 0.3
const RS_WEIGHT_30D = 0.4
const RS_WEIGHT_90D = 0.3

/**
 * Ranking de fuerza relativa: rank 1 es el de mejor momentum.
 *
 * Un activo al que le falta cualquiera de los tres retornos NO compite: su
 * score sería una suma de plazos distintos a la de los demás, y comparar eso
 * es inventar un ganador. Van todos al final, ordenados alfabéticamente para
 * que dos corridas seguidas devuelvan el mismo orden, con score 0 — el número
 * que importa en ellos es el rank, que dice "sin historia suficiente".
 */
export function relativeStrengthRank(assets: AssetReturns[]): StrengthRank[] {
  const scored = assets.map((a) => {
    const complete = a.ret7d !== null && a.ret30d !== null && a.ret90d !== null
    return {
      symbol: a.symbol,
      complete,
      score: complete
        ? a.ret7d! * RS_WEIGHT_7D +
          a.ret30d! * RS_WEIGHT_30D +
          a.ret90d! * RS_WEIGHT_90D
        : 0,
    }
  })

  scored.sort((a, b) => {
    if (a.complete !== b.complete) return a.complete ? -1 : 1
    if (b.score !== a.score) return b.score - a.score
    // Empate real (dos activos que se movieron igual): alfabético, para que el
    // orden no dependa de cómo vino la consulta.
    return a.symbol.localeCompare(b.symbol)
  })

  return scored.map((s, i) => ({ symbol: s.symbol, rank: i + 1, score: s.score }))
}

/**
 * Lo que el prompt muestra de fuerza relativa por símbolo: los tres retornos
 * más la posición en el ranking. `total` es cuántos activos compitieron, que
 * es lo que hace legible un "#3" — no es lo mismo entre 45 que entre 5.
 */
export type RelativeStrength = {
  ret7d: number | null
  ret30d: number | null
  ret90d: number | null
  rank: number
  total: number
}

/** Mínimo de pares para que una correlación signifique algo. */
const MIN_CORRELATION_PAIRS = 20
/** Desde acá se considera que dos activos se mueven juntos. */
const DEFAULT_CORR_THRESHOLD = 0.6
/** Barras en común que necesitan dos series para poder compararse. */
const DEFAULT_MIN_BARS = 30

/**
 * Retornos logarítmicos diarios. Devuelve `prices.length - 1` valores.
 *
 * Un precio no positivo hace explotar el logaritmo, así que ese paso sale como
 * NaN en vez de como un cero: cero afirmaría "no se movió", que es una
 * observación inventada. `pearsonCorrelation` descarta la serie entera si
 * encuentra un NaN, que es el resultado correcto — ese par no se puede medir.
 */
export function dailyReturns(prices: number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < prices.length; i++) {
    const previo = prices[i - 1]
    const actual = prices[i]
    out.push(previo > 0 && actual > 0 ? Math.log(actual / previo) : NaN)
  }
  return out
}

/**
 * Correlación de Pearson entre dos series de retornos diarios.
 *
 * Devuelve null si las series no miden lo mismo, si son cortas, o si alguna no
 * varía en todo el período: sin varianza el coeficiente es una división por
 * cero, no un cero.
 */
export function pearsonCorrelation(a: number[], b: number[]): number | null {
  if (a.length !== b.length) return null
  if (a.length < MIN_CORRELATION_PAIRS) return null
  if (!a.every(Number.isFinite) || !b.every(Number.isFinite)) return null

  const n = a.length
  const meanA = a.reduce((s, v) => s + v, 0) / n
  const meanB = b.reduce((s, v) => s + v, 0) / n

  let cov = 0
  let varA = 0
  let varB = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA
    const dbv = b[i] - meanB
    cov += da * dbv
    varA += da * da
    varB += dbv * dbv
  }

  if (varA <= 0 || varB <= 0) return null

  const r = cov / Math.sqrt(varA * varB)
  // El redondeo de punto flotante puede tirar 1.0000000000000002 y romper a
  // quien asuma el rango.
  return Math.max(-1, Math.min(1, r))
}

/**
 * Cierres de un símbolo indexados por fecha.
 *
 * La matriz recibe esto y no un array plano porque las series NO vienen
 * alineadas: un activo puede no haber cotizado un día que el otro sí. Con dos
 * arrays sueltos de distinto largo no hay forma de saber qué barra de uno
 * corresponde a qué barra del otro, y emparejarlas por posición compararía
 * días distintos — que es exactamente el error que una correlación no perdona.
 */
export type PricesByDate = Map<string, number>

/**
 * Matriz de correlación entre múltiples series.
 *
 * Cada par se alinea por su cuenta, quedándose solo con las fechas donde los
 * DOS tienen precio. Alinear una sola vez contra las fechas comunes a todos
 * recortaría cada par al peor de la lista.
 *
 * Solo devuelve los pares que superan `threshold`. Las correlaciones negativas
 * quedan afuera a propósito: la matriz existe para detectar concentración
 * escondida, y dos activos que se mueven al revés no la agravan.
 *
 * La clave es "A:B" con los símbolos en orden alfabético, así que cada par
 * aparece una sola vez y siempre igual.
 */
export function correlationMatrix(
  series: Map<string, PricesByDate>,
  opts: { threshold?: number; minBars?: number } = {},
): Map<string, number> {
  const threshold = opts.threshold ?? DEFAULT_CORR_THRESHOLD
  const minBars = opts.minBars ?? DEFAULT_MIN_BARS
  const symbols = [...series.keys()].sort()
  const out = new Map<string, number>()

  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      const a = series.get(symbols[i])!
      const b = series.get(symbols[j])!

      // Fechas en común, en orden. Un cierre no positivo descarta el día:
      // así los retornos nunca ven un precio con el que no se puede calcular.
      const fechas = [...a.keys()]
        .filter((f) => {
          const pa = a.get(f)
          const pb = b.get(f)
          return pa !== undefined && pb !== undefined && pa > 0 && pb > 0
        })
        .sort()

      if (fechas.length < minBars) continue

      const r = pearsonCorrelation(
        dailyReturns(fechas.map((f) => a.get(f)!)),
        dailyReturns(fechas.map((f) => b.get(f)!)),
      )
      if (r === null || r < threshold) continue

      out.set(`${symbols[i]}:${symbols[j]}`, r)
    }
  }

  return out
}

/**
 * Cuánto vale, como máximo, cada componente del score.
 *
 * Se sacaron a un objeto para poder correr el backtest con varias
 * configuraciones sin tocar la lógica: lo que cambia es cuánto PESA cada
 * componente, no cómo se evalúa. Las bandas de RSI, MACD, volumen y demás son
 * las mismas en todas las variantes (la única excepción está documentada en
 * `contrarianRsi`).
 */
export type ScoreWeights = {
  momentum: number
  technical: number
  volume: number
  correlation: number
  freshness: number
  sectorCap: number
}

/** Los pesos originales. Es lo que usa producción y el default de la función. */
export const SCORE_WEIGHTS_V1: ScoreWeights = {
  momentum: 25,
  technical: 25,
  volume: 15,
  correlation: 15,
  freshness: 10,
  sectorCap: 10,
}

/** Baja momentum, sube técnico. Hipótesis: el momentum extendido revierte. */
export const SCORE_WEIGHTS_V2: ScoreWeights = {
  momentum: 10,
  technical: 35,
  volume: 15,
  correlation: 15,
  freshness: 10,
  sectorCap: 15,
}

/** Contrarian: premia pullback en tendencia. Va con `contrarianRsi`. */
export const SCORE_WEIGHTS_V3: ScoreWeights = {
  momentum: 5,
  technical: 40,
  volume: 15,
  correlation: 15,
  freshness: 15,
  sectorCap: 10,
}

/**
 * Cómo se reparte la componente técnica entre sus cuatro señales.
 *
 * Son las proporciones que tenía la versión original (10, 8, 4 y 3 puntos sobre
 * 25), expresadas como fracción para que sigan valiendo cuando el máximo de la
 * componente deja de ser 25.
 */
const RSI_SHARE = 10 / 25
const MACD_SHARE = 8 / 25
const SMA50_SHARE = 4 / 25
const SMA20_SHARE = 3 / 25

/**
 * Desglose del score de un activo como candidato a compra.
 *
 * Va desglosado y no como un número solo porque el total no dice nada por sí
 * mismo: 55 puede ser "buen activo en un sector saturado" o "activo mediocre
 * sin nada en contra", y son decisiones distintas. El modelo necesita ver de
 * dónde salen los puntos para poder discutirlos.
 */
export type ScoreBreakdown = {
  momentum: number
  technical: number
  volume: number
  correlation: number
  freshness: number
  sectorCap: number
  total: number
}

/**
 * Score compuesto de un activo como candidato a compra.
 *
 * Los puntajes parciales suman 100 en el mejor caso —con los pesos por defecto—
 * y cada componente vale una fracción de su máximo según lo que observó. No es
 * un puntaje absoluto: es relativo al estado actual de la cartera. Un activo con
 * score 80 en una cartera concentrada en tech puede tener score 50 en una
 * diversificada, porque la penalización de correlación cambia.
 *
 * Los datos que faltan no puntúan, con una excepción: el volumen sin datos da el
 * valor del medio. La diferencia es deliberada — un activo sin RSI es un activo
 * del que no sabemos nada y no merece puntos, mientras que un volumen ausente es
 * una limitación NUESTRA y castigar a todos por igual solo agregaría ruido.
 *
 * Cada componente se redondea a entero: con pesos que no son múltiplos de las
 * fracciones internas los parciales salen con decimales, y un desglose que no
 * cierra con su total es más confuso que la precisión que se pierde.
 */
export function investmentScore(params: {
  rank: number
  totalRanked: number
  rsi: number | null
  macdSignal: 'alcista' | 'bajista' | 'neutral'
  aboveSma50: boolean | null
  aboveSma20: boolean | null
  avgVolume20d: number | null
  lastVolume: number | null
  maxCorrelationWithHeld: number | null
  sectorWeightPct: number
  daysSinceLastRec: number | null
  weights?: ScoreWeights
  /**
   * Invierte la lectura del RSI: la mejor nota pasa a ser el activo sobrevendido
   * que se está dando vuelta (30-45) en lugar del que todavía no se estiró.
   * Es la hipótesis contrarian de V3, y la ÚNICA banda que cambia entre
   * variantes.
   */
  contrarianRsi?: boolean
}): ScoreBreakdown {
  const w = params.weights ?? SCORE_WEIGHTS_V1

  // ── Momentum: en qué percentil del ranking cae ──
  const percentil = params.totalRanked > 0 ? params.rank / params.totalRanked : 1
  const momentumFrac = percentil <= 0.10
    ? 1
    : percentil <= 0.25
    ? 0.8
    : percentil <= 0.50
    ? 0.48
    : percentil <= 0.75
    ? 0.2
    : 0

  // ── Técnico: RSI + MACD + posición contra las dos medias ──
  let rsiFrac = 0
  if (params.rsi !== null) {
    rsiFrac = params.contrarianRsi
      // Contrarian: lo que más puntúa es el rebote empezado.
      ? params.rsi < 30
        ? 0.5
        : params.rsi < 45
        ? 1
        : params.rsi < 55
        ? 0.6
        : params.rsi <= 70
        ? 0.3
        : 0
      // El mejor puntaje es el rebote potencial (30-50), no el impulso ya
      // desatado: arriba de 70 comprar es llegar tarde. Sobrevendido puntúa
      // bien pero menos, porque "barato" también puede ser "cayendo".
      : params.rsi < 30
      ? 0.8
      : params.rsi < 50
      ? 1
      : params.rsi <= 70
      ? 0.5
      : 0
  }
  const macdFrac = params.macdSignal === 'alcista' ? 1 : params.macdSignal === 'neutral' ? 0.375 : 0
  const technicalFrac = RSI_SHARE * rsiFrac +
    MACD_SHARE * macdFrac +
    SMA50_SHARE * (params.aboveSma50 === true ? 1 : 0) +
    SMA20_SHARE * (params.aboveSma20 === true ? 1 : 0)

  // ── Volumen: interés reciente contra el promedio ──
  const { avgVolume20d, lastVolume } = params
  const volumeFrac = avgVolume20d !== null && avgVolume20d > 0 && lastVolume !== null
    ? lastVolume > avgVolume20d * 1.5
      ? 1
      : lastVolume >= avgVolume20d * 0.8
      ? 8 / 15
      : 3 / 15
    : 5 / 15

  // ── Correlación: cuánto se parece a lo que ya se tiene ──
  const corr = params.maxCorrelationWithHeld
  const correlationFrac = corr === null || corr < 0.7 ? 1 : corr < 0.8 ? 8 / 15 : corr < 0.9 ? 3 / 15 : 0

  // ── Frescura: no repetir la misma sugerencia todas las semanas ──
  const dias = params.daysSinceLastRec
  const freshnessFrac = dias === null || dias > 30 ? 1 : dias >= 14 ? 0.6 : dias >= 7 ? 0.3 : 0

  // ── Techo sectorial: cuánto pesa ya el sector del activo ──
  const sectorFrac = params.sectorWeightPct < 20
    ? 1
    : params.sectorWeightPct < 30
    ? 0.6
    : params.sectorWeightPct < 40
    ? 0.2
    : 0

  const momentum = Math.round(w.momentum * momentumFrac)
  const technical = Math.round(w.technical * technicalFrac)
  const volume = Math.round(w.volume * volumeFrac)
  const correlation = Math.round(w.correlation * correlationFrac)
  const freshness = Math.round(w.freshness * freshnessFrac)
  const sectorCap = Math.round(w.sectorCap * sectorFrac)

  return {
    momentum,
    technical,
    volume,
    correlation,
    freshness,
    sectorCap,
    total: momentum + technical + volume + correlation + freshness + sectorCap,
  }
}

/**
 * Todo lo que el asesor mira de un símbolo, calculado de una vez.
 *
 * `price` es el precio de referencia contra el que se comparan las medias: el
 * precio actual cuando se lo conoce, y si no el último cierre de la serie.
 */
export type Technicals = {
  rsi14: number | null
  sma20: number | null
  sma50: number | null
  macd: { macd: number; signal: number; histogram: number } | null
  price: number
}

/**
 * Arma los indicadores de un símbolo.
 *
 * Devuelve null cuando no hay precio de referencia o cuando la serie es tan
 * corta que no se pudo calcular ni uno: una entrada vacía en el contexto solo
 * agrega una línea que no dice nada.
 */
export function technicals(
  prices: number[],
  currentPrice?: number | null,
): Technicals | null {
  const last = prices.length ? prices[prices.length - 1] : null
  const price = currentPrice && currentPrice > 0 ? currentPrice : last
  if (!price || !Number.isFinite(price)) return null

  const result: Technicals = {
    rsi14: rsi(prices),
    sma20: sma(prices, SMA_SHORT),
    sma50: sma(prices, SMA_LONG),
    macd: macd(prices),
    price,
  }

  const empty =
    result.rsi14 === null &&
    result.sma20 === null &&
    result.sma50 === null &&
    result.macd === null
  return empty ? null : result
}
