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
import { computeImpliedFx, saveImpliedFx } from '../_shared/impliedFx.ts'
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

/**
 * Suma al universo las acciones argentinas del panel Merval.
 *
 * ── Por qué solo el Merval ───────────────────────────────────────────────
 *
 * Del universo que expone IOL, las 20 acciones del panel líder son las únicas
 * con volumen suficiente para que una sugerencia sea ejecutable. El panel de
 * obligaciones negociables trae 883 papeles, la mayoría casi sin operar: una
 * recomendación de comprar algo que no tiene contraparte es peor que ninguna.
 *
 * ── Por qué el sector es "Argentina" ─────────────────────────────────────
 *
 * No porque no se sepa a qué rubro pertenece cada una, sino porque para una
 * cartera como esta el factor que las mueve juntas es el riesgo argentino, no
 * la industria. Agrupadas así, el límite de concentración por sector pasa a
 * medir algo útil: cuánto de la cartera depende del país.
 *
 * Los símbolos y descripciones salen del panel real de IOL, no de una lista
 * cargada a mano — que es exactamente el error que hizo que un fondo de
 * commodities figurara como money market durante semanas.
 */
async function syncMervalUniverse(token: string) {
  type Panel = { simbolo?: string; descripcion?: string; volumen?: number }

  // IOL devuelve el panel envuelto en `{ titulos: [...] }`, no como array
  // plano. La sonda normalizaba las dos formas y esa normalización no llegó
  // acá: el primer intento reventó con "filter is not a function".
  let panel: Panel[] = []
  try {
    const raw = await iol.raw.get<Panel[] | { titulos?: Panel[] }>(
      token,
      '/api/v2/Cotizaciones/acciones/merval/argentina',
    )
    panel = Array.isArray(raw) ? raw : (raw?.titulos ?? [])
  } catch (err) {
    console.error('[universe] no se pudo leer el panel Merval:', err)
    return { added: 0 }
  }

  const rows = panel
    .filter((p) => p.simbolo)
    .map((p) => ({
      symbol: p.simbolo!,
      sector: 'Argentina',
      asset_type: 'ACCION',
      rescue_time: 'T+1',
      display_name: p.descripcion ?? p.simbolo!,
      suggestable: true,
    }))

  if (!rows.length) return { added: 0 }

  // onConflict sin pisar lo curado: si un símbolo ya está con su sector y
  // nombre, se deja como está
  const { error } = await db
    .from('asset_metadata')
    .upsert(rows, { onConflict: 'symbol', ignoreDuplicates: true })

  if (error) {
    console.error('[universe] no se pudo guardar el panel:', error.message)
    return { added: 0 }
  }

  return { added: rows.length }
}

/**
 * Sonda de paneles: qué instrumentos ofrece IOL además de CEDEARs y FCI.
 *
 * No escribe nada. Sirve para descubrir el universo REAL en vez de cargar
 * tickers de memoria, que ya nos costó caro con los nombres de los fondos.
 */
async function probePanels(token: string) {
  const candidates = [
    '/api/v2/Cotizaciones/acciones/merval/argentina',
    '/api/v2/Cotizaciones/titulosPublicos/todos/argentina',
    '/api/v2/Cotizaciones/obligacionesNegociables/todas/argentina',
    '/api/v2/Cotizaciones/cedears/todos/argentina',
    '/api/v2/argentina/Titulos/Cotizacion/Instrumentos',
    '/api/v2/argentina/Titulos/Cotizacion/Paneles/acciones',
  ]

  const out: Array<Record<string, unknown>> = []

  for (const path of candidates) {
    try {
      const data = await iol.raw.get<unknown>(token, path)
      const list = Array.isArray(data)
        ? data
        : Array.isArray((data as { titulos?: unknown[] })?.titulos)
          ? (data as { titulos: unknown[] }).titulos
          : null

      out.push({
        path,
        ok: true,
        count: list ? list.length : 'no es lista',
        sample: list ? list.slice(0, 2) : data,
      })
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      out.push({ path, ok: false, status: raw.match(/→ (\d{3})/)?.[1] ?? '?' })
    }
  }

  return out
}

Deno.serve(async (req) => {
  // Sin este envoltorio, cualquier `throw` de acá adentro sale como un 500 con
  // el cuerpo "Internal Server Error" y cero información. Diagnosticar eso
  // requiere leer los logs de la plataforma, que la CLI ni siquiera expone.
  try {
    return await handle(req)
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err)
    console.error('[fetch-market-quotes]', message)
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
})

async function handle(req: Request): Promise<Response> {
  if (!isServiceRole(req)) return unauthorized()

  // Las cotizaciones son datos públicos y se comparten entre todos, pero para
  // pedirlas hace falta el token de ALGUIEN. Se usa la primera conexión activa
  // que haya, no `users[0]`: con varios usuarios, ese primero puede ser alguien
  // que nunca conectó nada, y la corrida entera fallaba.
  // Se busca por la columna CIFRADA además de la vieja: desde la 0019 el token
  // en claro queda en NULL, así que filtrar solo por `refresh_token` no
  // encontraba ninguna conexión y los paneles de mercado se quedaban vacíos.
  const { data: connected } = await db
    .from('iol_credentials')
    .select('user_id, refresh_token, refresh_token_enc')
    .or('refresh_token_enc.not.is.null,refresh_token.not.is.null')
    .order('last_sync_at', { ascending: false, nullsFirst: false })
    .limit(1)

  const userId = connected?.[0]?.user_id
  if (!userId) {
    return Response.json({ ok: true, skipped: 'ninguna cuenta de IOL conectada' })
  }

  const token = await getAccessToken(db, userId)

  if (new URL(req.url).searchParams.get('probe') === 'panels') {
    return Response.json({ ok: true, panels: await probePanels(token) })
  }

  // El universo se refresca ANTES de leerlo, no después: al revés, los símbolos
  // nuevos recién se cotizaban en la corrida siguiente.
  const universeSync = await syncMervalUniverse(token)

  const [{ data: universe }, { data: held }] = await Promise.all([
    db.from('asset_metadata').select('symbol').eq('suggestable', true),
    db.from('positions').select('symbol'),
  ])

  const symbols = [
    ...new Set([...(universe ?? []), ...(held ?? [])].map((r) => r.symbol)),
  ]
  if (!symbols.length) return Response.json({ ok: true, note: 'universo vacío' })

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

  // Prima cambiaria del universo sugerible.
  //
  // `fetch-portfolio` ya calcula la de lo que TENÉS, cada 5 minutos. Acá se
  // cubre lo que el asesor podría recomendarte COMPRAR, que es justamente
  // donde el dato decide algo: sin esto sabía si tu GOOGL estaba caro en pesos
  // pero no si el KO que te iba a sugerir lo estaba.
  //
  // Va una vez por día al cierre y no cada 5 min porque son ~40 requests más:
  // para decidir una compra alcanza con la prima del cierre anterior, que se
  // mueve mucho menos que el precio.
  const { data: types } = await db
    .from('asset_metadata')
    .select('symbol, asset_type')
    .in('symbol', quotes.map((q) => q.symbol))

  const typeBySymbol = new Map((types ?? []).map((t) => [t.symbol as string, t.asset_type as string]))
  const fxRows = await computeImpliedFx(
    db,
    token,
    quotes.map((q) => ({
      symbol: q.symbol,
      arsPrice: q.price,
      assetType: typeBySymbol.get(q.symbol) ?? null,
    })),
    'fetch-market-quotes',
  )

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

  // Después del upsert de cotizaciones, no antes: así el implícito no puede
  // quedar pisado por una fila de precios que se escribe encima.
  await saveImpliedFx(db, fxRows, 'fetch-market-quotes')

  // El cierre del día alimenta la variación semanal de las próximas corridas
  //
  // El volumen va desde ahora: la columna existe desde la 0001 pero nunca se
  // escribió, así que estaba vacía en las 1.501 filas. Lo consume la componente
  // de volumen del score del asesor, que compara la última rueda contra el
  // promedio de 20 — o sea que empieza a puntuar de verdad recién cuando se
  // junten 20 ruedas desde este deploy. Hasta entonces el score le da a todos
  // el valor neutro.
  const today = todayBA()
  const { error: historyError } = await db.from('price_history').upsert(
    quotes.map((q) => ({
      symbol: q.symbol,
      close_price: q.price,
      volume: q.volume,
      recorded_at: today,
    })),
    { onConflict: 'symbol,recorded_at' },
  )
  if (historyError) throw historyError

  return Response.json({
    ok: true,
    quoted: quotes.length,
    withWeekly: weekly.size,
    withImpliedFx: fxRows.length,
    universe: universeSync,
    failed,
  })
}
