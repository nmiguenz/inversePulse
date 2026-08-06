/**
 * fetch-market-quotes — al cierre del mercado, lun-vie
 *
 * Cotiza el universo de activos sugeribles (`asset_metadata.suggestable`) más
 * lo que tengas en cartera, para poder mostrar qué se mueve AFUERA de tu
 * cartera. Hasta ahora la app solo conocía precios de lo que ya tenías, así
 * que no podía responder "¿qué anduvo bien hoy?".
 *
 * Guarda dos cosas:
 *   · `market_quotes` — el estado actual, una fila por símbolo
 *   · `price_history` — el cierre del día, que es lo que después permite
 *     calcular la variación semanal
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAccessToken, iol } from '../_shared/iol.ts'
import { isServiceRole, unauthorized } from '../_shared/auth.ts'

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

/** Cuántos símbolos cotizar en paralelo. */
const BATCH = 10

function todayBA(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
}

type Quote = {
  symbol: string
  price: number
  previous_close: number | null
  daily_change_pct: number | null
  volume: number | null
  quoted_at: string | null
}

/**
 * Lee la cotización cruda de IOL con tolerancia a los nombres de campo.
 *
 * Devuelve null si no hay precio: un símbolo sin CEDEAR en BCBA, o el mercado
 * cerrado sin datos, tiene que quedar afuera de los paneles en vez de entrar
 * con precio 0 y aparecer como la peor caída del día.
 */
function parseQuote(symbol: string, raw: Record<string, unknown>): Quote | null {
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null

  const price = num(raw.ultimoPrecio) ?? num(raw.precio)
  if (price === null || price === 0) return null

  const previousClose = num(raw.cierreAnterior)
  const variation = num(raw.variacion)

  return {
    symbol,
    price,
    previous_close: previousClose,
    // Se prefiere la variación que informa IOL; solo se calcula si no viene.
    daily_change_pct:
      variation ??
      (previousClose && previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : null),
    volume: num(raw.volumenNominal) ?? num(raw.montoOperado),
    quoted_at: typeof raw.fechaHora === 'string' ? raw.fechaHora : null,
  }
}

/**
 * Variación de los últimos 7 días para cada símbolo, contra `price_history`.
 *
 * Devuelve un mapa parcial a propósito: los símbolos sin cierre viejo quedan
 * afuera y el frontend muestra "faltan datos" en vez de un 0% que parecería
 * un activo que no se movió.
 */
async function weeklyChange(symbols: string[], current: Map<string, number>) {
  const since = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10)
  const until = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10)

  const { data } = await db
    .from('price_history')
    .select('symbol, close_price, recorded_at')
    .in('symbol', symbols)
    .gte('recorded_at', since)
    .lte('recorded_at', until)
    .order('recorded_at', { ascending: false })

  // La primera fila de cada símbolo es la más cercana a hace una semana
  const reference = new Map<string, number>()
  for (const row of data ?? []) {
    if (!reference.has(row.symbol) && row.close_price > 0) {
      reference.set(row.symbol, row.close_price)
    }
  }

  const out = new Map<string, number>()
  for (const [symbol, price] of current) {
    const old = reference.get(symbol)
    if (old) out.set(symbol, ((price - old) / old) * 100)
  }
  return out
}

Deno.serve(async (req) => {
  if (!isServiceRole(req)) return unauthorized()

  // Las cotizaciones son datos públicos y se comparten entre todos, pero para
  // pedirlas hace falta el token de ALGUIEN. Se usa la primera conexión activa
  // que haya, no `users[0]`: con varios usuarios, ese primero puede ser alguien
  // que nunca conectó nada, y la corrida entera fallaba.
  const { data: connected } = await db
    .from('iol_credentials')
    .select('user_id')
    .not('refresh_token', 'is', null)
    .order('last_sync_at', { ascending: false, nullsFirst: false })
    .limit(1)

  const userId = connected?.[0]?.user_id
  if (!userId) {
    return Response.json({ ok: true, skipped: 'ninguna cuenta de IOL conectada' })
  }

  const [{ data: universe }, { data: held }] = await Promise.all([
    db.from('asset_metadata').select('symbol').eq('suggestable', true),
    db.from('positions').select('symbol'),
  ])

  const symbols = [
    ...new Set([...(universe ?? []), ...(held ?? [])].map((r) => r.symbol)),
  ]
  if (!symbols.length) return Response.json({ ok: true, note: 'universo vacío' })

  const token = await getAccessToken(db, userId)

  // De a tandas: 40 llamadas simultáneas hacen que IOL empiece a rechazar.
  // `allSettled` para que un símbolo sin CEDEAR no tumbe toda la corrida.
  const quotes: Quote[] = []
  const failed: string[] = []

  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH)
    const settled = await Promise.allSettled(
      batch.map(async (symbol) => {
        const raw = await iol.cotizacion(token, symbol)
        return parseQuote(symbol, raw)
      }),
    )

    settled.forEach((result, idx) => {
      if (result.status === 'fulfilled' && result.value) quotes.push(result.value)
      else failed.push(batch[idx])
    })
  }

  if (!quotes.length) {
    return Response.json({ ok: false, error: 'ninguna cotización válida', failed }, { status: 502 })
  }

  const weekly = await weeklyChange(
    quotes.map((q) => q.symbol),
    new Map(quotes.map((q) => [q.symbol, q.price])),
  )

  const now = new Date().toISOString()
  const { error: quotesError } = await db.from('market_quotes').upsert(
    quotes.map((q) => ({
      ...q,
      week_change_pct: weekly.get(q.symbol) ?? null,
      updated_at: now,
    })),
    { onConflict: 'symbol' },
  )
  if (quotesError) throw quotesError

  // El cierre del día alimenta la variación semanal de las próximas corridas
  const today = todayBA()
  const { error: historyError } = await db.from('price_history').upsert(
    quotes.map((q) => ({ symbol: q.symbol, close_price: q.price, recorded_at: today })),
    { onConflict: 'symbol,recorded_at' },
  )
  if (historyError) throw historyError

  return Response.json({
    ok: true,
    quoted: quotes.length,
    withWeekly: weekly.size,
    failed,
  })
})
