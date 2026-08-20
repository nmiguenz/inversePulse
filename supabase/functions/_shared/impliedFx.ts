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

  const overrides = await dollarTickers(db, usable.map((i) => i.symbol))
  const rows: FxRow[] = []
  const unresolved: string[] = []

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
          unresolved.push(`${symbol}→${ticker}`)
        }
      }),
    )
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
