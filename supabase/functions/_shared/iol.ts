/**
 * Cliente de la API REST de IOL (api.invertironline.com).
 *
 * Auth: POST /token con grant_type=password (form-urlencoded) devuelve un
 * access_token válido 15 minutos + un refresh_token. El refresh token ROTA en
 * cada renovación, por eso se persiste en la tabla `iol_credentials` y no en
 * una env var.
 *
 * Docs: https://api.invertironline.com/Help/Autenticacion
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encrypt, decryptOrPlain } from './crypto.ts'

const BASE = 'https://api.invertironline.com'

/** La API pública documentada. Es el host de todo lo que la app usa hoy. */
export const PUBLIC_API = BASE

/**
 * Gateway interno de IOL — INALCANZABLE desde acá.
 *
 * Es el host que usa el conector MCP para opciones y para stop loss / take
 * profit. El nombre NO EXISTE en DNS público: no resuelve ni en 1.1.1.1 ni en
 * 8.8.8.8 (solo matchea con `.com.ar` agregado, que es un catch-all de
 * typosquatting, con IPs distintas según el resolver). Es interno de verdad.
 *
 * Queda documentado para que nadie vuelva a intentarlo: una Edge Function que
 * le pegue se cuelga hasta agotar el presupuesto de cómputo. No lo uses.
 */
export const GATEWAY = 'https://gateway-api-internal.invertironline.com'

export type IolTitulo = {
  simbolo: string
  descripcion: string
  pais: string
  mercado: string
  tipo: string // CEDEARS, FondoComundeInversion, TitulosPublicos, ACCIONES, ...
  plazo: string // t0, t1, t2
  moneda: string // peso_Argentino, dolar_Estadounidense
}

export type IolActivo = {
  cantidad: number
  comprometido: number
  puntosVariacion: number
  variacionDiaria: number
  ultimoPrecio: number
  ppc: number
  gananciaPorcentaje: number
  gananciaDinero: number
  valorizado: number
  titulo: IolTitulo
  parking?: { disponibleInmediato?: number }
}

export type IolPortfolio = { pais: string; activos: IolActivo[] }

/**
 * Una fila por plazo de liquidación.
 *
 * `liquidacion` viene como texto de IOL ("Inmediato" es el único valor que
 * confirma la documentación; los de 24h y 48h se ven en datos reales). Se
 * guarda crudo y se traduce en el frontend, para no inventar etiquetas.
 *
 * `disponible` ≠ `disponibleOperar`: el segundo es lo que se puede usar para
 * poner una orden.
 */
export type IolSaldo = {
  liquidacion: string
  saldo: number
  comprometido: number
  disponible: number
  disponibleOperar: number
}

export type IolCuenta = {
  numero: string
  tipo: string
  moneda: string
  disponible: number
  comprometido: number
  saldo: number
  titulosValorizados: number
  total: number
  margenDescubierto: number
  estado: string
  saldos?: IolSaldo[]
}

export type IolEstadoCuenta = {
  cuentas: IolCuenta[]
  estadisticas: Array<{ descripcion: string; cantidad: number; volumen: number }>
  totalEnPesos: number
}

type TokenResponse = {
  access_token: string
  refresh_token: string
  expires_in: number
  error?: string
  error_description?: string
}

export class IolAuthError extends Error {}

/**
 * El usuario no conectó ninguna cuenta.
 *
 * Es un tipo aparte para que las funciones que recorren usuarios puedan
 * saltearlo en silencio: no es un error del sistema, es alguien que todavía no
 * terminó de configurarse.
 */
export class NoConnectionError extends Error {}

async function requestToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })

  const json = (await res.json().catch(() => ({}))) as TokenResponse
  if (!res.ok || !json.access_token) {
    throw new IolAuthError(
      json.error_description ?? json.error ?? `token endpoint devolvió ${res.status}`,
    )
  }
  return json
}

/** Cuánto dura el candado de renovación antes de vencer solo. */
const REFRESH_LOCK_SECONDS = 30

/** Cuánto espera un proceso a que el otro termine de renovar, antes de rendirse. */
const LOCK_WAIT_MS = 12_000
const LOCK_POLL_MS = 800

type Creds = {
  refresh_token?: string | null
  access_token?: string | null
  refresh_token_enc?: string | null
  access_token_enc?: string | null
  access_token_expires_at?: string | null
  token_version?: number | null
  /** El usuario de IOL. Etiqueta visible y, desde la 0025, login del rescate. */
  account_label?: string | null
  /** Contraseña cifrada (0025). Último recurso cuando el refresh muere. */
  password_enc?: string | null
  last_sync_error?: string | null
}

/** Lee la fila de credenciales, tolerando esquemas viejos. */
async function readCreds(db: SupabaseClient, userId: string): Promise<Creds | null> {
  const full = await db
    .from('iol_credentials')
    .select(
      'refresh_token, access_token, refresh_token_enc, access_token_enc, access_token_expires_at, token_version, account_label, password_enc, last_sync_error',
    )
    .eq('user_id', userId)
    .maybeSingle()

  if (!full.error) return full.data as Creds | null

  // Si la 0019 o la 0023 todavía no corrieron, esas columnas no existen y
  // PostgREST rechaza el select ENTERO. Sin este fallback, un error de esquema
  // se convertía en "no tenés cuenta conectada" y el sync se cortaba con un
  // diagnóstico falso.
  const legacy = await db
    .from('iol_credentials')
    .select('refresh_token, access_token, access_token_expires_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (legacy.error) throw new Error(`No se pudo leer la conexión: ${legacy.error.message}`)
  return legacy.data as Creds | null
}

/** El access token guardado, si todavía sirve. */
async function cachedAccessToken(creds: Creds | null): Promise<string | null> {
  const token = await decryptOrPlain(creds?.access_token_enc ?? creds?.access_token ?? null)
  if (!token || !creds?.access_token_expires_at) return null
  // 60s de margen para que no venza en medio de una llamada
  return new Date(creds.access_token_expires_at).getTime() - Date.now() > 60_000 ? token : null
}

/**
 * Intenta quedarse con el derecho a renovar.
 *
 * Un UPDATE condicional hace de candado distribuido sin necesidad de RPC: si la
 * fila se actualiza, este proceso ganó; si no se actualizó ninguna, otro está
 * renovando ahora mismo.
 *
 * El vencimiento es lo que evita que un proceso que murió a la mitad deje la
 * conexión trabada para siempre.
 */
async function claimRefreshLock(db: SupabaseClient, userId: string): Promise<boolean> {
  const until = new Date(Date.now() + REFRESH_LOCK_SECONDS * 1000).toISOString()

  const { data, error } = await db
    .from('iol_credentials')
    .update({ refresh_lock_until: until })
    .eq('user_id', userId)
    .or(`refresh_lock_until.is.null,refresh_lock_until.lt.${new Date().toISOString()}`)
    .select('user_id')

  // Sin la columna (0023 sin correr) se sigue de largo sin candado: es el
  // comportamiento de antes, no peor.
  if (error) return true

  return (data ?? []).length > 0
}

async function releaseRefreshLock(db: SupabaseClient, userId: string) {
  await db.from('iol_credentials').update({ refresh_lock_until: null }).eq('user_id', userId)
}

/**
 * Devuelve un access token válido, renovándolo si hace falta.
 *
 * ── Por qué toda esta ceremonia ──────────────────────────────────────────
 *
 * IOL ROTA el refresh token en cada uso: apenas entrega uno nuevo, el anterior
 * deja de servir. Con varias funciones pidiendo token en paralelo, dos podían
 * leer el mismo refresh token y renovarlo las dos — una lo consumía y la otra
 * escribía encima el valor ya gastado, dejando la conexión muerta de forma
 * permanente. Pasó de verdad: seis corridas seguidas fallaron sin recuperarse.
 *
 * El candado evita que dos renueven a la vez; la versión evita que una
 * escritura tardía pise un token nuevo con uno viejo.
 */
export async function getAccessToken(db: SupabaseClient, userId: string): Promise<string> {
  const creds = await readCreds(db, userId)

  const cached = await cachedAccessToken(creds)
  if (cached) return cached

  // Sin credenciales propias no hay sync. NO existe un login global de
  // respaldo.
  //
  // Antes había uno, con IOL_USERNAME/IOL_PASSWORD de env, y era un agujero:
  // como el alta de usuarios estaba abierta, cualquiera que se registrara caía
  // acá sin credenciales, se usaban las globales, y la cartera del dueño
  // terminaba copiada adentro de la cuenta del desconocido.
  //
  // La contraseña guardada cuenta como conexión: aunque el refresh token haya
  // muerto, con ella se puede volver a entrar.
  const refreshToken = await decryptOrPlain(creds?.refresh_token_enc ?? creds?.refresh_token ?? null)
  if (!refreshToken && !creds?.password_enc) {
    throw new NoConnectionError(`El usuario ${userId} no tiene una cuenta de IOL conectada`)
  }

  // ── El candado ───────────────────────────────────────────────────────
  if (!(await claimRefreshLock(db, userId))) {
    // Otro proceso está renovando. Se espera a que publique el token nuevo en
    // vez de pedir uno en paralelo — que es exactamente lo que rompía la
    // conexión: dos renovaciones simultáneas, una consumía el refresh token y
    // la otra guardaba encima el valor ya gastado.
    const deadline = Date.now() + LOCK_WAIT_MS
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, LOCK_POLL_MS))
      const token = await cachedAccessToken(await readCreds(db, userId))
      if (token) return token
    }
    throw new IolAuthError('Otro proceso está renovando la sesión y tardó demasiado')
  }

  let locked: Creds | null = null
  let triedPassword = false

  try {
    // Se relee ADENTRO del candado: entre la primera lectura y el candado, otro
    // proceso pudo haber renovado y rotado el token.
    locked = await readCreds(db, userId)

    const fresh = await cachedAccessToken(locked)
    if (fresh) return fresh

    const current =
      (await decryptOrPlain(locked?.refresh_token_enc ?? locked?.refresh_token ?? null)) ??
      refreshToken

    let token: TokenResponse
    try {
      if (!current) throw new IolAuthError('no hay refresh token guardado')
      token = await requestToken({ refresh_token: current, grant_type: 'refresh_token' })
    } catch (refreshErr) {
      // ── El rescate ─────────────────────────────────────────────────────
      // IOL rota el refresh token en cada uso y no tiene otra puerta de
      // entrada, así que ese token muere por cosas que no controlamos: un
      // corte de red en plena rotación, otra aplicación entrando a IOL con
      // las mismas credenciales. Antes cada una de esas muertes era una
      // reconexión a mano; ahora se vuelve a entrar con la contraseña
      // guardada (cifrada, 0025) y la sesión se recupera sola.
      const password = await decryptOrPlain(locked?.password_enc ?? null)
      const username = locked?.account_label

      if (!password || !username) throw refreshErr

      triedPassword = true
      console.warn(
        `[iol] refresh rechazado para ${userId}; reintentando con usuario y contraseña`,
      )
      token = await requestToken({ username, password, grant_type: 'password' })
    }

    return await persist(db, userId, token, locked?.token_version ?? 0)
  } catch (err) {
    if (err instanceof PersistError) throw err

    // NO se borran las credenciales: un token muerto no molesta, y mientras
    // esté la contraseña guardada la próxima corrida puede intentar de nuevo.
    const message = triedPassword
      ? 'IOL rechazó la sesión y también el usuario y contraseña guardados. Si cambiaste la contraseña, reconectá tu cuenta.'
      : locked?.password_enc
        ? 'No se pudo renovar la sesión de IOL. Se reintenta solo en la próxima corrida.'
        : 'IOL rechazó la renovación de la sesión. Reconectá tu cuenta una vez para activar la recuperación automática.'

    await db
      .from('iol_credentials')
      .update({ last_sync_error: message, updated_at: new Date().toISOString() })
      .eq('user_id', userId)

    // Aviso inmediato, solo en la TRANSICIÓN de sana a rota y solo cuando ya
    // no queda recuperación automática. El aviso de las 20hs de evaluate-alerts
    // sigue existiendo como red; este existe porque enterarse un día después
    // era perder un día de mercado.
    if (triedPassword && !locked?.last_sync_error) {
      await notifyConnectionDead(db, userId)
    }

    throw new IolAuthError(
      `No se pudo renovar la sesión de IOL: ${err instanceof Error ? err.message : String(err)}`,
    )
  } finally {
    await releaseRefreshLock(db, userId)
  }
}

/**
 * Alerta + push en el momento en que la conexión queda irrecuperable.
 *
 * Import dinámico para no encadenar web-push a todas las funciones que solo
 * quieren un token.
 */
async function notifyConnectionDead(db: SupabaseClient, userId: string) {
  try {
    const { data: alert } = await db
      .from('alerts')
      .insert({
        user_id: userId,
        alert_type: 'connection_lost',
        symbol: null,
        title: 'Tu cuenta de IOL se desconectó',
        message:
          'IOL rechazó la sesión y la contraseña guardada. Hasta que reconectes, los datos quedan congelados.',
        severity: 'critical',
        action_suggested: 'Reconectar en Configuración',
      })
      .select('id')
      .maybeSingle()

    const { data: user } = await db
      .from('users')
      .select('push_subscription')
      .eq('id', userId)
      .maybeSingle()

    if (user?.push_subscription) {
      const { sendPush } = await import('./push.ts')
      await sendPush(db, userId, user.push_subscription, {
        title: 'Tu cuenta de IOL se desconectó',
        body: 'Hay que volver a poner usuario y contraseña. Hasta entonces, los datos quedan congelados.',
        tag: 'connection_lost',
        url: '/config',
        alertId: alert?.id,
        severity: 'critical',
      })
    }
  } catch (err) {
    // El aviso es cortesía: si falla, no tiene que tapar el error real
    console.error(`[iol] no se pudo avisar la desconexión de ${userId}:`, err)
  }
}

/**
 * Falla al guardar el token rotado.
 *
 * Es un tipo aparte porque NO se puede tratar como "IOL rechazó la sesión": el
 * token nuevo es válido pero se perdió, y decir que IOL lo rechazó mandaría a
 * reconectar cuando el problema es nuestro.
 */
export class PersistError extends Error {}

/**
 * Guarda los tokens nuevos y devuelve el access token.
 *
 * ── Por qué el guardado no puede fallar en silencio ──────────────────────
 *
 * IOL invalida el refresh token viejo en cuanto entrega uno nuevo. Si el nuevo
 * no queda guardado, la conexión ya está muerta aunque esta llamada haya
 * funcionado: el próximo intento va a usar uno que IOL ya descartó. Antes esto
 * se ignoraba.
 *
 * ── La versión ───────────────────────────────────────────────────────────
 *
 * El UPDATE exige la versión que se leyó. Si otro proceso guardó en el medio,
 * no coincide y esta escritura se rechaza en vez de pisar un token más nuevo
 * con uno ya consumido — que es lo que dejó la conexión muerta el viernes.
 */
async function persist(
  db: SupabaseClient,
  userId: string,
  token: TokenResponse,
  expectedVersion: number,
): Promise<string> {
  const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString()

  const { data, error } = await db
    .from('iol_credentials')
    .update({
      refresh_token_enc: await encrypt(token.refresh_token),
      access_token_enc: await encrypt(token.access_token),
      // Se limpian las columnas viejas: en cuanto la fila pasa por acá, deja de
      // haber tokens en claro en la base
      refresh_token: null,
      access_token: null,
      access_token_expires_at: expiresAt,
      token_version: expectedVersion + 1,
      last_sync_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('token_version', expectedVersion)
    .select('user_id')

  if (!error && (data ?? []).length > 0) return token.access_token

  // Si la 0023 no corrió, `token_version` no existe y el update falla por
  // esquema. Se guarda sin control de versión: es el comportamiento anterior,
  // no peor.
  if (error) {
    const { error: legacyError } = await db
      .from('iol_credentials')
      .update({
        refresh_token_enc: await encrypt(token.refresh_token),
        access_token_enc: await encrypt(token.access_token),
        refresh_token: null,
        access_token: null,
        access_token_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)

    if (!legacyError) return token.access_token

    throw new PersistError(
      `Se renovó la sesión pero no se pudo guardar el token: ${legacyError.message}. ` +
        'La conexión va a fallar hasta que reconectes.',
    )
  }

  // Update sin error y sin filas: otro proceso ganó la carrera y ya guardó un
  // token más nuevo. Este quedó viejo, así que se usa el del otro.
  const winner = await cachedAccessToken(await readCreds(db, userId))
  if (winner) return winner

  throw new PersistError(
    'Otro proceso renovó la sesión al mismo tiempo y no se pudo recuperar el token nuevo.',
  )
}

/**
 * Canjea usuario y contraseña por tokens.
 *
 * La usa `connect-broker` y NADIE más: la contraseña llega en la request, se
 * usa una vez y se descarta. Nunca se guarda ni se lee de una env var.
 */
export function exchangePassword(username: string, password: string): Promise<TokenResponse> {
  return requestToken({ username, password, grant_type: 'password' })
}

async function get<T>(token: string, path: string): Promise<T> {
  return getFrom<T>(BASE, token, path)
}

/**
 * GET contra un host arbitrario.
 *
 * Existe por el gateway interno: los endpoints de opciones y de stop loss no
 * están en `api.invertironline.com` sino en
 * `gateway-api-internal.invertironline.com`, y antes de construir nada encima
 * hay que saber si el bearer de la app autentica ahí. No usar para código
 * nuevo salvo que el sondeo confirme el host.
 */
export async function getFrom<T>(host: string, token: string, path: string): Promise<T> {
  const res = await fetch(`${host}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`IOL ${path} → ${res.status} ${await res.text().catch(() => '')}`)
  }
  return (await res.json()) as T
}

/**
 * POST con cuerpo JSON.
 *
 * Es la primera vez que la app ESCRIBE en IOL: hasta ahora todo era lectura.
 * Cualquier uso tiene que venir de una acción explícita del usuario, nunca de
 * un CRON — del otro lado hay plata real.
 */
export async function post<T>(
  token: string,
  path: string,
  body: unknown,
  host = BASE,
): Promise<T> {
  const res = await fetch(`${host}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`IOL POST ${path} → ${res.status} ${await res.text().catch(() => '')}`)
  }
  return (await res.json()) as T
}

/**
 * Una operación cerrada (compra, venta, suscripción o rescate de FCI, pago de
 * dividendos).
 *
 * Campos verificados contra la respuesta real de la cuenta, no contra la
 * documentación. El detalle que importa: en una orden a precio de mercado
 * `cantidad` trae el MONTO en pesos, no la cantidad de papeles — para una
 * compra de 1 GOOGL vino `cantidad: 10813` y `cantidadOperada: 1`. Los campos
 * de la ejecución son los "Operada".
 */
export type IolOperacion = {
  numero?: number
  fechaOrden?: string
  fechaOperada?: string
  tipo?: string // Compra, Venta, Suscripción FCI, Rescate FCI, Pago de Dividendos
  estado?: string // terminada, cancelada, pendiente
  mercado?: string
  simbolo?: string
  cantidad?: number
  cantidadOperada?: number
  monto?: number
  montoOperado?: number
  precioOperado?: number
  precio?: number
  moneda?: string
  descripcion?: string
}

/** Formato de fecha que espera la API en los filtros */
function isoDate(d: string | Date): string {
  return typeof d === 'string' ? d : d.toISOString().slice(0, 10)
}

export const iol = {
  portfolio: (token: string, pais = 'argentina') =>
    get<IolPortfolio>(token, `/api/v2/portafolio/${pais}`),

  estadoCuenta: (token: string) => get<IolEstadoCuenta>(token, '/api/v2/estadocuenta'),

  /**
   * Operaciones cerradas en un rango. Se piden TODOS los estados y el filtrado
   * se hace después: una orden cancelada tiene que quedar registrada como
   * cancelada, no desaparecer.
   */
  operaciones: (token: string, desde: string | Date, hasta: string | Date) =>
    get<IolOperacion[]>(
      token,
      `/api/v2/operaciones?filtro.fechaDesde=${isoDate(desde)}&filtro.fechaHasta=${isoDate(hasta)}`,
    ),

  /** Cotización puntual de un título, tenga o no posición abierta */
  cotizacion: (token: string, simbolo: string, mercado = 'bCBA', plazo = 't1') =>
    get<Record<string, unknown>>(
      token,
      `/api/v2/${mercado}/Titulos/${simbolo}/Cotizacion?model.mercado=${mercado}&model.simbolo=${simbolo}&model.plazo=${plazo}`,
    ),

  /** Acceso crudo, para sondear rutas todavía no confirmadas */
  raw: { get, getFrom, post },

  // NO hay endpoint de movimientos de dinero (depósitos y extracciones).
  // Probé /cuentas-bancarias/movimientos en GET y POST con cuatro bodies,
  // /estadocuenta/movimientos, /micuenta/movimientos y /Cuenta/Movimientos:
  // las seis devuelven el mismo "Runtime Error" 500 genérico de ASP.NET, que
  // es lo mismo que devuelve una ruta inexistente. No es un problema de
  // parámetros. `fetch-transactions` los detecta por diferencia de saldo y
  // pregunta en vez de inventarlos.
}
