/**
 * Lectura de `price_history` en bloque.
 *
 * Vive acá porque la usan dos consumidores que tienen que ver EXACTAMENTE la
 * misma serie: `portfolio-advisor`, que arma el contexto del asesor, y
 * `backtest`, que simula qué habría hecho ese mismo asesor. Si uno leyera la
 * serie completa y el otro una recortada, el backtest mediría una estrategia
 * que no es la que corre en producción.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * Filas por página.
 *
 * La consulta trae la serie de TODOS los símbolos y la API de Supabase corta en
 * 1.000 filas por request. Con decenas de símbolos y meses de historia se pasa
 * enseguida: sin paginar, PostgREST devolvía las 1.000 más VIEJAS (la consulta
 * ordena ascendente) y todo se calculaba sobre precios de hace meses, sin un
 * solo error visible.
 */
const PAGE = 1000
/** Freno de bucle: 60 páginas son 60.000 filas, muy por encima de lo posible. */
const MAX_PAGES = 60

/**
 * Salto mínimo, en %, para siquiera sospechar de un cambio de ratio.
 *
 * Los cinco artefactos que hay en la base van de -54% a -90%; el movimiento
 * real más grande del período es el rally post-electoral del 27-O, con GGAL
 * +27,9% y SUPV +36,3%. El corte en 45% deja las dos poblaciones separadas sin
 * zona gris.
 */
const RATIO_MIN_MOVE_PCT = 45

/**
 * Cuánto puede alejarse el factor de un entero y seguir contando como ratio.
 *
 * Es la MITAD del criterio, y la que más importa. La magnitud sola no alcanza:
 * un desplome real del 50% —una empresa argentina con un evento de crédito no
 * es ciencia ficción— da un factor de exactamente 2,0 y quedaría "corregido",
 * borrando de la serie la única caída que el asesor necesitaba ver. Pidiendo
 * ADEMÁS que el factor sea casi entero, lo que se corrige son los ÷10,3 y los
 * ÷2,99 que solo puede producir un cambio de certificado.
 */
const RATIO_INTEGER_TOLERANCE = 0.05

/** Un "cambio de ratio" de 1 no existe. */
const MIN_RATIO = 2

/** Un cambio de ratio detectado, para poder auditar qué se tocó y por qué. */
export type RatioChange = {
  symbol: string
  date: string
  rawFactor: number
  /** El entero al que se redondeó. */
  appliedFactor: number
  direction: 'split' | 'reverse_split'
}

export type PriceRow = {
  symbol: string
  close_price: number
  recorded_at: string
  volume: number | null
}

/**
 * Si un factor está lo bastante cerca de un entero como para ser un ratio.
 *
 * Devuelve el entero, o null si no lo está.
 */
function nearestRatio(factor: number): number | null {
  if (!Number.isFinite(factor) || factor <= 0) return null
  const entero = Math.round(factor)
  if (entero < MIN_RATIO) return null
  return Math.abs(factor - entero) / entero <= RATIO_INTEGER_TOLERANCE ? entero : null
}

/**
 * Detecta y corrige cambios de ratio en una serie de cierres.
 *
 * Un cambio de ratio se identifica por DOS condiciones simultáneas:
 * 1. El retorno diario supera ±45% en magnitud.
 * 2. El factor (precio_anterior / precio_siguiente) está dentro del ±5% de un
 *    entero (2, 3, 4, 5, 10, etc.) o de su inverso (1/2, 1/3, etc.).
 *
 * Cuando se detecta, todos los precios ANTERIORES al salto se dividen por el
 * entero más cercano (o se multiplican si fue un split inverso), de modo que la
 * serie quede continua.
 *
 * Con varios cambios en la misma serie se recorre de la barra más NUEVA a la
 * más vieja arrastrando un divisor acumulado, así que el factor del segundo se
 * aplica sobre precios ya corregidos por el primero. El precio más reciente
 * nunca se toca: la serie queda expresada en el certificado de hoy, que es el
 * mismo en el que están los precios que llegan por el sync diario.
 *
 * El VOLUMEN no se corrige. Un cambio de ratio parte el certificado, no las
 * operaciones: reescalar los nominales inventaría un dato que nadie informó.
 *
 * Nada de esto toca la base. Es sobre el array en memoria, así que `price_history`
 * conserva lo que IOL informó y la corrección se puede revisar o revertir.
 */
export function adjustRatioChanges(
  rows: PriceRow[],
): { adjusted: PriceRow[]; ratioChanges: RatioChange[] } {
  const porSimbolo = new Map<string, PriceRow[]>()
  for (const row of rows) {
    const serie = porSimbolo.get(row.symbol) ?? []
    serie.push(row)
    porSimbolo.set(row.symbol, serie)
  }

  const ratioChanges: RatioChange[] = []
  // Precio corregido por símbolo+fecha. Se arma acá y después se reconstituye
  // el array en el ORDEN ORIGINAL: los consumidores esperan las filas ordenadas
  // por fecha, no agrupadas por símbolo.
  const corregidos = new Map<string, number>()

  for (const [symbol, serie] of porSimbolo) {
    // Dentro de un símbolo la consulta ya viene por fecha, pero ordenar acá
    // hace que la función no dependa de cómo la llamaron.
    const ordenada = [...serie].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))

    let divisorAcumulado = 1
    for (let i = ordenada.length - 1; i >= 1; i--) {
      const previo = ordenada[i - 1].close_price
      const actual = ordenada[i].close_price

      if (previo > 0 && actual > 0) {
        const cambioPct = Math.abs((actual / previo - 1) * 100)
        if (cambioPct > RATIO_MIN_MOVE_PCT) {
          const rawFactor = previo / actual
          // Un split baja el precio (factor > 1); uno inverso lo sube, y ahí el
          // entero está del lado del inverso.
          const comoSplit = rawFactor > 1 ? nearestRatio(rawFactor) : null
          const comoInverso = rawFactor < 1 ? nearestRatio(1 / rawFactor) : null

          if (comoSplit) {
            divisorAcumulado *= comoSplit
            ratioChanges.push({
              symbol,
              date: ordenada[i].recorded_at,
              rawFactor,
              appliedFactor: comoSplit,
              direction: 'split',
            })
          } else if (comoInverso) {
            divisorAcumulado /= comoInverso
            ratioChanges.push({
              symbol,
              date: ordenada[i].recorded_at,
              rawFactor,
              appliedFactor: comoInverso,
              direction: 'reverse_split',
            })
          }
        }
      }

      // El divisor ya incluye el cambio detectado en `i`, que es justo el que
      // esta barra —anterior al salto— tiene que absorber.
      if (divisorAcumulado !== 1) {
        corregidos.set(clave(symbol, ordenada[i - 1].recorded_at), previo / divisorAcumulado)
      }
    }
  }

  if (!corregidos.size) return { adjusted: rows, ratioChanges }

  const adjusted = rows.map((row) => {
    const precio = corregidos.get(clave(row.symbol, row.recorded_at))
    return precio === undefined ? row : { ...row, close_price: precio }
  })

  return { adjusted, ratioChanges }
}

const clave = (symbol: string, fecha: string) => `${symbol}:${fecha}`

/**
 * Todos los cierres desde `since` (fecha ISO, YYYY-MM-DD), paginados.
 *
 * Avanza por la cantidad de filas que REALMENTE devolvió cada página, no por el
 * tamaño pedido: si el proyecto tiene configurado un tope más bajo que `PAGE`,
 * esto sigue leyendo desde donde quedó en vez de saltearse el resto. Corta con
 * la primera página vacía.
 *
 * Devuelve las filas ordenadas por fecha ascendente, que es como las esperan
 * todos los cálculos de `indicators.ts`.
 */
export async function fetchPriceHistory(
  db: SupabaseClient,
  since: string,
  onError?: (message: string) => void,
): Promise<PriceRow[]> {
  const rows: PriceRow[] = []

  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await db
      .from('price_history')
      .select('symbol, close_price, recorded_at, volume')
      .gte('recorded_at', since)
      // El símbolo desempata: sin un orden total, dos páginas pueden repetir
      // una fila y saltearse otra del mismo día.
      .order('recorded_at')
      .order('symbol')
      .range(rows.length, rows.length + PAGE - 1)

    if (error) {
      onError?.(error.message)
      break
    }
    if (!data?.length) break
    rows.push(...(data as PriceRow[]))
  }

  // La corrección de ratios va acá, una sola vez y para todos: `fetchPriceHistory`
  // es el único punto por donde el asesor y el backtest ven la serie, así que
  // los dos quedan mirando lo mismo sin pagar un segundo recorrido.
  const { adjusted, ratioChanges } = adjustRatioChanges(rows)
  for (const c of ratioChanges) {
    const signo = c.direction === 'split' ? '÷' : '×'
    const linea =
      `[prices] ratio change: ${c.symbol} ${c.date} ${signo}${c.appliedFactor} ` +
      `(${c.direction}, crudo ${c.rawFactor.toFixed(2)})`

    // El factor 2 es el único ambiguo de verdad: mirando solo el precio, un
    // split 2:1 y un derrumbe del 50% son EXACTAMENTE lo mismo (÷2,00 pasa las
    // dos condiciones). Los demás factores no tienen ese problema — un crash
    // que dé ÷10,3 no existe. Cuando aparezca un ÷2 conviene mirarlo a mano:
    // si era una caída real, esto la borró de la serie.
    if (c.appliedFactor === 2) {
      console.warn(`${linea} — REVISAR: un ÷2 puede ser un derrumbe real del 50%`)
    } else {
      console.log(linea)
    }
  }

  return adjusted
}
