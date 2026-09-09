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
