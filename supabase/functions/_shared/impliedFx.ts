/**
 * Dólar implícito de un activo: precio en pesos ÷ precio en dólar MEP.
 *
 * Un mismo instrumento cotiza en pesos y, cuando tiene par, en dólar MEP con
 * otro ticker. El cociente es el tipo de cambio metido adentro de ese papel, y
 * comparado contra el MEP de mercado dice si comprarlo en pesos sale caro o
 * barato. No dice nada sobre el activo en sí: dice cuál de las dos puertas de
 * entrada conviene.
 *
 * Vive acá y no en una Edge Function porque lo necesitan dos con cadencias
 * distintas: `fetch-portfolio` para lo que tenés (cada 5 min, tiene que estar
 * fresco) y `fetch-market-quotes` para el universo sugerible (una vez por día,
 * al cierre) — sin esto último el asesor sabe la prima de lo que YA tenés pero
 * no la de lo que podría recomendarte comprar.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { iol } from './iol.ts'

/** Cuántos tickers en dólares cotizar en paralelo. */
const BATCH = 10

/**
 * Los FCI no tienen par en dólares — verificado contra la API: el detalle de
 * CNXPOPA y PRMCAPB trae `dollar: null`. CEDEARs, bonos y acciones locales sí:
 * NVDA→NVDAD, TZXD6→TXD6D, GGAL→GGALD.
 */
const SIN_PAR = new Set(['FCI'])

export type FxInput = { symbol: string; arsPrice: number; assetType: string | null }
export type FxRow = {
  symbol: string
  usd_price: number
  implied_fx: number
  implied_fx_at: string
}

/**
 * Ticker del par en dólares.
 *
 * La convención es agregar una D, pero NO es universal: los símbolos de 5
 * caracteres se abrevian para que el par entre en 5, y la abreviatura no se
 * puede derivar (GOOGL→GOGLD tira la segunda O, TZXD6→TXD6D tira la Z). Las
 * excepciones se curan en `asset_metadata.dollar_symbol`.
 */
async function dollarTickers(
  db: SupabaseClient,
  symbols: string[],
): Promise<Map<string, string>> {
  const { data } = await db
    .from('asset_metadata')
    .select('symbol, dollar_symbol')
    .in('symbol', symbols)
    .not('dollar_symbol', 'is', null)

  return new Map((data ?? []).map((o) => [o.symbol as string, o.dollar_symbol as string]))
}


/**
 * Qué tan lejos del MEP puede caer un implícito antes de ser sospechoso.
 *
 * Las primas reales viven en ±5%. Un 20% deja margen de sobra para un día
 * dislocado y sigue descartando un ticker que resolvió a OTRO instrumento.
 */
const MAX_DESVIO_MEP = 0.20

/**
 * Descubre el par en dólares de un símbolo fuera de convención.
 *
 * Las excepciones conocidas son todas la misma operación: borrar un carácter y
 * agregar la D (GOOGL→GOGLD tira la segunda O, TZXD6→TXD6D tira la Z). No se
 * puede saber CUÁL carácter, pero son pocos candidatos, así que se prueban.
 *
 * El detalle del título en la API pública NO sirve para esto: devuelve solo
 * descripcion, mercado, moneda, pais, plazo, simbolo y tipo — sondeado, no hay
 * campo de símbolos relacionados.
 *
 * La red de seguridad es el MEP: un candidato que resolvió a otro instrumento
 * da un implícito absurdo, y se descarta. Sin esto, "borrar un carácter" podría
 * pegarle a un ticker real que no tiene nada que ver.
 */
async function discoverDollarTicker(
  token: string,
  symbol: string,
  arsPrice: number,
  mep: number,
): Promise<{ ticker: string; usd: number } | null> {
  if (mep <= 0 || symbol.length < 4) return null

  const candidatos = new Set<string>()
  for (let i = 0; i < symbol.length; i++) {
    candidatos.add(symbol.slice(0, i) + symbol.slice(i + 1) + 'D')
  }

  for (const ticker of candidatos) {
    try {
      const raw = await iol.cotizacion(token, ticker, 'bCBA', 't1')
      const usd = typeof raw.ultimoPrecio === 'number' ? raw.ultimoPrecio : null
      if (usd === null || usd <= 0) continue
      const desvio = Math.abs(arsPrice / usd / mep - 1)
      if (desvio <= MAX_DESVIO_MEP) return { ticker, usd }
      console.warn(
        `[impliedFx] ${symbol}: ${ticker} cotiza pero da un implícito ${(desvio * 100).toFixed(0)}% ` +
          'lejos del MEP. Es otro instrumento, se descarta.',
      )
    } catch {
      // Candidato inexistente: es lo esperado en casi todos.
    }
  }
  return null
}

/** Último MEP de mercado, para validar lo que se descubre. */
async function mepRate(db: SupabaseClient): Promise<number> {
  const { data } = await db
    .from('dollar_rates')
    .select('sell_price')
    .eq('rate_type', 'mep')
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.sell_price ?? 0
}

/**
 * Cotiza el par en dólares de cada activo y calcula el implícito.
 *
 * Nunca tira: es un enriquecimiento. Si IOL no responde, el asesor y el
 * dashboard siguen andando sin el dato, que es mejor que romper la corrida
 * entera por una prima cambiaria. Lo que no resuelve se loguea junto, así un
 * ticker nuevo fuera de convención aparece en vez de desaparecer.
 */
export async function computeImpliedFx(
  db: SupabaseClient,
  token: string,
  inputs: FxInput[],
  tag: string,
): Promise<FxRow[]> {
  const usable = inputs.filter((i) => i.arsPrice > 0 && !SIN_PAR.has(i.assetType ?? ''))
  if (!usable.length) return []

  const [overrides, mep] = await Promise.all([
    dollarTickers(db, usable.map((i) => i.symbol)),
    mepRate(db),
  ])
  const rows: FxRow[] = []
  const unresolved: string[] = []
  /** Lo que se descubrió solo, para no volver a buscarlo la próxima corrida. */
  const aprendidos: Array<{ symbol: string; dollar_symbol: string }> = []

  for (let i = 0; i < usable.length; i += BATCH) {
    await Promise.all(
      usable.slice(i, i + BATCH).map(async ({ symbol, arsPrice }) => {
        const ticker = overrides.get(symbol) ?? `${symbol}D`
        try {
          const raw = await iol.cotizacion(token, ticker, 'bCBA', 't1')
          const usd = typeof raw.ultimoPrecio === 'number' ? raw.ultimoPrecio : null
          // Un cero acá no es "gratis", es "no cotizó": dividir por él daría
          // Infinity y el asesor leería una prima delirante.
          if (usd === null || usd <= 0) {
            unresolved.push(`${symbol}→${ticker} (sin precio)`)
            return
          }
          rows.push({
            symbol,
            usd_price: usd,
            implied_fx: arsPrice / usd,
            implied_fx_at: new Date().toISOString(),
          })
        } catch {
          // El ticker por convención no existe. Antes de rendirse, se buscan
          // los candidatos de "borrar un carácter": es lo único que distingue
          // a las excepciones conocidas.
          const found = await discoverDollarTicker(token, symbol, arsPrice, mep)
          if (!found) {
            unresolved.push(`${symbol}→${ticker}`)
            return
          }
          console.log(`[${tag}] ${symbol}: par en dólares descubierto → ${found.ticker}`)
          aprendidos.push({ symbol, dollar_symbol: found.ticker })
          rows.push({
            symbol,
            usd_price: found.usd,
            implied_fx: arsPrice / found.usd,
            implied_fx_at: new Date().toISOString(),
          })
        }
      }),
    )
  }

  // Se guarda lo descubierto: la próxima corrida sale por el override y no
  // vuelve a gastar los intentos. Solo UPDATE — si el símbolo no está en el
  // universo curado, no es esta función la que decide meterlo.
  for (const a of aprendidos) {
    const { error } = await db
      .from('asset_metadata')
      .update({ dollar_symbol: a.dollar_symbol })
      .eq('symbol', a.symbol)
    if (error) console.warn(`[${tag}] no se pudo guardar ${a.symbol}→${a.dollar_symbol}: ${error.message}`)
  }

  if (unresolved.length) {
    console.warn(
      `[${tag}] sin par en dólares: ${unresolved.join(', ')}. ` +
        'Si el ticker existe con otro nombre, cargalo en asset_metadata.dollar_symbol.',
    )
  }
  return rows
}

/** Guarda los implícitos. `market_quotes` es global: el de NVDA es igual para todos. */
export async function saveImpliedFx(db: SupabaseClient, rows: FxRow[], tag: string) {
  if (!rows.length) return
  const { error } = await db.from('market_quotes').upsert(rows, { onConflict: 'symbol' })
  if (error) console.error(`[${tag}] implied_fx:`, error.message)
}
