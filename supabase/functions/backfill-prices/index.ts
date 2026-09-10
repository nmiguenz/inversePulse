/**
 * backfill-prices — a mano, UNA vez (o cuando entra un símbolo nuevo al universo)
 *
 * Carga la serie histórica de IOL en `price_history`. No va por CRON: es un
 * one-shot pesado que existe para tapar un agujero de datos, no una tarea
 * recurrente.
 *
 * ── Por qué hace falta ──────────────────────────────────────────────────
 *
 * `price_history` se llenaba solo hacia adelante, una fila por rueda desde que
 * el proyecto empezó a correr. Con ~25 barras por símbolo, la mitad de lo que
 * el asesor calcula no existe: el MACD necesita 35, la SMA50 necesita 50 y el
 * retorno de 90 días necesita 63. Peor que eso, `relativeStrengthRank` manda a
 * todos los símbolos sin ret90d al grupo de "incompletos", que se ordena
 * ALFABÉTICAMENTE — así que la componente de momentum del score venía repartida
 * por abecedario.
 *
 * ── Lo que NO hace ──────────────────────────────────────────────────────
 *
 * No pisa nada. El upsert va con `ignoreDuplicates`, o sea ON CONFLICT DO
 * NOTHING sobre `(symbol, recorded_at)`: los cierres que ya estaban quedan como
 * están, y correrlo dos veces es barato y no cambia nada.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isServiceRole, unauthorized } from '../_shared/auth.ts'
import { getAccessToken, iol } from '../_shared/iol.ts'

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

/** Cuánta historia se pide por defecto. 14 meses cubren el retorno de 90 días con margen. */
const DEFAULT_MONTHS = 14
/** Mercado de los CEDEARs y las acciones locales. */
const MERCADO = 'bCBA'
/** Los precios de `price_history` son sin ajustar; la serie tiene que venir igual. */
const AJUSTE = 'sinAjustar'

/**
 * Pausa entre símbolos.
 *
 * IOL no documenta su límite de requests. De a uno y con freno: son 14 meses de
 * datos por símbolo y el costo de que nos corten a mitad de camino es tener que
 * empezar de nuevo.
 */
const DELAY_MS = 500

/** Filas por upsert. Payloads de 250 filas por símbolo se agrupan solos. */
const CHUNK = 500

/**
 * Presupuesto de tiempo de la corrida.
 *
 * Una Edge Function no corre para siempre, y 60 símbolos × (medio segundo de
 * freno + lo que tarde IOL) se pasa del límite. Al llegar acá corta y devuelve
 * los que faltan en `remaining`: como nada se pisa, volver a llamarla con esa
 * lista termina el trabajo.
 */
const MAX_RUN_SECONDS = 110

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Número o null: IOL manda strings, nulls y a veces el campo directamente no viene. */
function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : null
  return n !== null && Number.isFinite(n) ? n : null
}

type SerieRow = Record<string, unknown>
type PriceRow = {
  symbol: string
  close_price: number
  volume: number | null
  recorded_at: string
}

/** Una fila mapeada, con su timestamp completo para poder desempatar el día. */
type Mapped = { row: PriceRow; ts: string }

/**
 * Una fila de la serie de IOL a una fila de `price_history`.
 *
 * La fecha se CORTA del string, no se parsea: `fechaHora` viene en hora local
 * de Buenos Aires y sin offset, así que pasarla por `new Date().toISOString()`
 * la correría tres horas y un cierre de las 17:00 terminaría guardado con la
 * fecha del día anterior.
 */
function toMapped(symbol: string, raw: SerieRow): Mapped | null {
  const fecha = typeof raw.fechaHora === 'string' ? raw.fechaHora.slice(0, 10) : null
  if (!fecha || fecha.length !== 10) return null

  // `precioPromedio` solo entra si `ultimoPrecio` no vino: los dos son
  // observaciones reales de ESE día. `cierreAnterior` NO se usa como respaldo
  // aunque venga en la respuesta — es el precio de otro día, y copiarlo acá
  // inventaría una rueda con retorno cero, que es exactamente el problema que
  // la 0034 tuvo que salir a limpiar en la otra tabla.
  const close = num(raw.ultimoPrecio) ?? num(raw.precioPromedio)
  // Un cierre en cero es una rueda sin operaciones, no un precio. Guardarlo
  // rompería todo lo que divide o logaritma después. Ojo con `??`: no cae por
  // un cero, así que un `ultimoPrecio: 0` termina descartado acá, que es lo
  // correcto.
  if (close === null || close <= 0) return null

  // Sábados y domingos no existen como rueda. Si IOL los devuelve repitiendo el
  // cierre del viernes, guardarlos inventa días de retorno cero — que es
  // exactamente lo que la 0034 tuvo que salir a limpiar en otra tabla.
  const dia = new Date(`${fecha}T12:00:00Z`).getUTCDay()
  if (dia === 0 || dia === 6) return null

  return {
    ts: raw.fechaHora as string,
    row: {
      symbol,
      close_price: close,
      // En la fila de cierre `volumenNominal` viene acumulado del día (358.671
      // contra los 41 de un tick suelto), así que quedarse con la última fila
      // de la rueda también da el volumen correcto.
      volume: num(raw.volumenNominal) ?? num(raw.montoOperado),
      recorded_at: fecha,
    },
  }
}

/**
 * De la serie INTRADIARIA de IOL al cierre de cada rueda.
 *
 * Verificado contra la respuesta real: `seriehistorica` no devuelve una fila
 * por día sino ~15, con la hora dentro de `fechaHora` y ordenadas de la más
 * NUEVA a la más vieja. Quedarse con la última fila iterada de cada fecha —lo
 * natural si uno asume orden ascendente— guardaría el primer tick de la rueda
 * como si fuera el cierre.
 *
 * Por eso el desempate es explícito por timestamp y no por posición en el
 * array: no depende de cómo venga ordenada la respuesta.
 */
export function dailyCloses(symbol: string, serie: SerieRow[]): PriceRow[] {
  const porFecha = new Map<string, Mapped>()

  for (const raw of serie) {
    const m = toMapped(symbol, raw)
    if (!m) continue

    const previa = porFecha.get(m.row.recorded_at)
    if (!previa || masNuevo(m.ts, previa.ts)) porFecha.set(m.row.recorded_at, m)
  }

  return [...porFecha.values()]
    .map((m) => m.row)
    .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
}

/**
 * Si `a` es posterior a `b`.
 *
 * `fechaHora` no trae offset, así que `Date.parse` la interpreta como hora
 * local del runtime — da igual cuál sea, porque las dos se interpretan igual y
 * lo único que importa es el orden relativo. Si el formato cambiara y dejara de
 * parsear, la comparación de strings ISO sigue siendo cronológica.
 */
function masNuevo(a: string, b: string): boolean {
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  return Number.isFinite(ta) && Number.isFinite(tb) ? ta > tb : a > b
}

Deno.serve(async (req) => {
  if (!isServiceRole(req)) return unauthorized()

  const empezado = Date.now()

  let body: { months?: number; symbols?: string[]; probe?: string; ajuste?: string } = {}
  try {
    body = await req.json()
  } catch {
    // Sin body, defaults.
  }
  const months = body.months ?? DEFAULT_MONTHS
  // `sinAjustar` por defecto, que es la base de los precios que ya están
  // guardados. Se puede pedir 'ajustada' para comparar: los CEDEARs argentinos
  // cambian de ratio seguido y sin ajustar eso entra a la serie como una caída
  // del 90% que no ocurrió.
  const ajuste = body.ajuste ?? AJUSTE

  // Las cotizaciones son públicas, pero para pedirlas hace falta el token de
  // ALGUIEN. Se toma la conexión activa más reciente, igual que
  // `fetch-market-quotes`: `users[0]` puede ser alguien que nunca conectó IOL.
  const { data: connected } = await db
    .from('iol_credentials')
    .select('user_id')
    .or('refresh_token_enc.not.is.null,refresh_token.not.is.null')
    .order('last_sync_at', { ascending: false, nullsFirst: false })
    .limit(1)

  const userId = connected?.[0]?.user_id
  if (!userId) {
    return Response.json({ error: 'ninguna cuenta de IOL conectada' }, { status: 400 })
  }

  // El token se pide DE NUEVO antes de cada símbolo, no una sola vez al
  // arrancar.
  //
  // `getAccessToken` devuelve el cacheado mientras le queden más de 60 segundos
  // de vida, un margen pensado para una llamada suelta. En un bucle de 110
  // segundos eso significa arrancar con un token que puede morirse a los 30: la
  // primera corrida cargó 22 símbolos y los otros 40 fallaron con 401
  // "Authorization has been denied". Pedirlo por símbolo es una consulta local
  // más por vuelta —barata— y hace que la renovación ocurra sola en cuanto haga
  // falta. El candado de `iol.ts` evita que se pisen dos renovaciones.
  const tokenFresco = () => getAccessToken(db, userId)

  let token: string
  try {
    token = await tokenFresco()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ error: `no se pudo autenticar contra IOL: ${message}` }, { status: 502 })
  }

  // Cartera Y universo sugerible: las dos listas alimentan al asesor y las dos
  // necesitan profundidad. Se piden todas las posiciones, de todos los usuarios.
  let symbols: string[]
  if (body.symbols?.length) {
    symbols = [...new Set(body.symbols)]
  } else {
    const [{ data: universe }, { data: held }] = await Promise.all([
      db.from('asset_metadata').select('symbol').eq('suggestable', true),
      db.from('positions').select('symbol'),
    ])
    symbols = [
      ...new Set([
        ...(universe ?? []).map((u) => u.symbol as string),
        ...(held ?? []).map((p) => p.symbol as string),
      ]),
    ]
  }
  // Orden estable: si la corrida se corta por tiempo, la siguiente arranca por
  // donde iba y no por un orden distinto.
  symbols.sort()

  if (!symbols.length) {
    return Response.json({ error: 'no hay símbolos que cargar' }, { status: 400 })
  }

  const hasta = new Date().toISOString().slice(0, 10)
  const desde = new Date(Date.now() - months * 30.44 * 864e5).toISOString().slice(0, 10)

  // Sonda: pide la serie de UN símbolo y devuelve las dos primeras filas tal
  // como vinieron, más cómo quedarían mapeadas. No escribe nada.
  //
  // Existe porque el nombre de los campos de esta respuesta no está verificado
  // contra la API real —los de `Cotizacion` sí, y se asume que la serie usa los
  // mismos—. Si no coinciden, esto lo muestra en un request en vez de después
  // de veinte minutos de carga que no insertó nada.
  if (body.probe) {
    const symbol = body.probe
    try {
      const serie = await iol.raw.get<SerieRow[]>(
        token,
        `/api/v2/${MERCADO}/Titulos/${symbol}/Cotizacion/seriehistorica/${desde}/${hasta}/${ajuste}`,
      )
      const filas = Array.isArray(serie) ? serie : []
      const cierres = dailyCloses(symbol, filas)
      return Response.json({
        ok: true,
        probe: symbol,
        range: { desde, hasta, ajuste },
        // La serie es intradiaria: lo que importa no es cuántas filas vinieron
        // sino cuántas RUEDAS distintas quedan después de agrupar.
        total_filas: filas.length,
        ruedas: cierres.length,
        filas_por_rueda: cierres.length
          ? Number((filas.length / cierres.length).toFixed(1))
          : 0,
        primera_rueda: cierres[0]?.recorded_at ?? null,
        ultima_rueda: cierres[cierres.length - 1]?.recorded_at ?? null,
        con_volumen: cierres.filter((c) => c.volume !== null).length,
        campos: filas.length ? Object.keys(filas[0]) : [],
        primeros_cierres: cierres.slice(0, 3),
        ultimos_cierres: cierres.slice(-3),
        // Saltos diarios grandes: es lo que distingue una serie ajustada de una
        // que arrastra cambios de ratio.
        saltos: cierres
          .map((c, i) =>
            i === 0 || cierres[i - 1].close_price <= 0
              ? null
              : {
                fecha: c.recorded_at,
                de: cierres[i - 1].close_price,
                a: c.close_price,
                pct: Number(((c.close_price / cierres[i - 1].close_price - 1) * 100).toFixed(1)),
              }
          )
          .filter((x) => x && Math.abs(x.pct) >= 25),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return Response.json({ ok: false, probe: symbol, error: message }, { status: 502 })
    }
  }

  let processed = 0
  let inserted = 0
  let skipped = 0
  const errors: string[] = []
  const remaining: string[] = []

  for (const [i, symbol] of symbols.entries()) {
    if ((Date.now() - empezado) / 1000 > MAX_RUN_SECONDS) {
      remaining.push(...symbols.slice(i))
      break
    }

    // El freno va ANTES de cada request menos la primera: así el delay no se
    // paga cuando no hay nadie más a quien esperar.
    if (i > 0) await sleep(DELAY_MS)

    try {
      token = await tokenFresco()
    } catch (err) {
      // Si la sesión de IOL se cayó del todo, seguir es gastar medio segundo
      // por símbolo para juntar sesenta errores iguales.
      const message = err instanceof Error ? err.message : String(err)
      errors.push(`${symbol}: sesión de IOL caída (${message.slice(0, 120)})`)
      remaining.push(...symbols.slice(i))
      break
    }

    const pedirSerie = (t: string) =>
      iol.raw.get<SerieRow[]>(
        t,
        `/api/v2/${MERCADO}/Titulos/${symbol}/Cotizacion/seriehistorica/${desde}/${hasta}/${ajuste}`,
      )

    try {
      let serie: SerieRow[]
      try {
        serie = await pedirSerie(token)
      } catch (err) {
        // Un 401 justo en el borde del margen: se renueva y se reintenta UNA
        // vez. Cualquier otro error sube y lo maneja el catch de afuera.
        const message = err instanceof Error ? err.message : String(err)
        if (!message.includes('401')) throw err
        token = await tokenFresco()
        serie = await pedirSerie(token)
      }

      if (!Array.isArray(serie) || !serie.length) {
        errors.push(`${symbol}: serie vacía`)
        processed++
        continue
      }

      const rows = dailyCloses(symbol, serie)

      if (!rows.length) {
        errors.push(`${symbol}: sin ruedas utilizables`)
        processed++
        continue
      }

      for (let c = 0; c < rows.length; c += CHUNK) {
        const lote = rows.slice(c, c + CHUNK)
        // `ignoreDuplicates` es ON CONFLICT DO NOTHING: lo que ya estaba no se
        // toca. El select devuelve SOLO lo insertado, que es de dónde sale la
        // cuenta de nuevas contra ya existentes.
        const { data, error } = await db
          .from('price_history')
          .upsert(lote, { onConflict: 'symbol,recorded_at', ignoreDuplicates: true })
          .select('id')

        if (error) {
          errors.push(`${symbol}: ${error.message}`)
          break
        }
        inserted += data?.length ?? 0
        skipped += lote.length - (data?.length ?? 0)
      }

      processed++
    } catch (err) {
      // Un símbolo que no cotizaba hace un año da 404, y uno con rate limit da
      // 429. Ninguno de los dos justifica abortar los otros cincuenta.
      const message = err instanceof Error ? err.message : String(err)
      errors.push(`${symbol}: ${message.slice(0, 200)}`)
      processed++
    }
  }

  return Response.json({
    ok: true,
    processed,
    inserted,
    skipped,
    errors,
    duration_seconds: Math.round((Date.now() - empezado) / 1000),
    range: { desde, hasta, months },
    // Si quedaron afuera por presupuesto de tiempo: volvé a llamar con esta
    // lista en `symbols` para terminar. Nada se pisa, así que es seguro.
    ...(remaining.length ? { remaining } : {}),
  })
})
