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

/**
 * Devuelve un access token válido, renovándolo si hace falta.
 * Orden: token en cache (si no venció) → refresh_token → usuario/password de env.
 */
export async function getAccessToken(db: SupabaseClient, userId: string): Promise<string> {
  // Se piden las columnas cifradas y las viejas juntas. Si la 0019 todavía no
  // corrió, las cifradas no existen y PostgREST rechaza el select ENTERO: sin
  // este fallback, un error de esquema se convertía en "no tenés cuenta
  // conectada" y el sync del dueño se cortaba con un diagnóstico falso.
  let { data: creds, error: credsError } = await db
    .from('iol_credentials')
    .select(
      'refresh_token, access_token, refresh_token_enc, access_token_enc, access_token_expires_at',
    )
    .eq('user_id', userId)
    .maybeSingle()

  if (credsError) {
    const legacy = await db
      .from('iol_credentials')
      .select('refresh_token, access_token, access_token_expires_at')
      .eq('user_id', userId)
      .maybeSingle()

    // Si tampoco anda el select viejo, el problema es otro y hay que verlo
    if (legacy.error) throw new Error(`No se pudo leer la conexión: ${legacy.error.message}`)
    creds = legacy.data
  }

  // Se prefiere la columna cifrada; la de texto plano queda solo para las filas
  // anteriores a la 0019 y se reescribe cifrada en el próximo refresh.
  const refreshToken = await decryptOrPlain(creds?.refresh_token_enc ?? creds?.refresh_token ?? null)
  const accessToken = await decryptOrPlain(creds?.access_token_enc ?? creds?.access_token ?? null)

  // Cache con 60s de margen
  if (accessToken && creds?.access_token_expires_at) {
    const expiresAt = new Date(creds.access_token_expires_at).getTime()
    if (expiresAt - Date.now() > 60_000) return accessToken
  }

  // Sin token propio no hay sync. NO existe un login global de respaldo.
  //
  // Antes había uno, con IOL_USERNAME/IOL_PASSWORD de env, y era un agujero:
  // como el alta de usuarios estaba abierta, cualquiera que se registrara caía
  // acá sin credenciales, se usaban las globales, y la cartera del dueño
  // —posiciones, saldos y movimientos— terminaba copiada adentro de la cuenta
  // del desconocido. Un solo camino para todos es lo que lo evita.
  if (!refreshToken) {
    throw new NoConnectionError(`El usuario ${userId} no tiene una cuenta de IOL conectada`)
  }

  let token: TokenResponse
  try {
    token = await requestToken({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    })
  } catch (err) {
    // El refresh token murió: hay que reconectar desde la app. Se deja
    // registrado para que el frontend muestre el cartel en vez de fallar en
    // silencio hasta que alguien mire los logs.
    await db
      .from('iol_credentials')
      .update({
        refresh_token: null,
        access_token: null,
        refresh_token_enc: null,
        access_token_enc: null,
        last_sync_error: 'La conexión con IOL venció. Volvé a conectar tu cuenta.',
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)

    throw new IolAuthError(
      `La conexión con IOL venció: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString()

  const { error: saveError } = await db.from('iol_credentials').upsert({
    user_id: userId,
    refresh_token_enc: await encrypt(token.refresh_token),
    access_token_enc: await encrypt(token.access_token),
    // Se limpian las columnas viejas: en cuanto la fila pasa por acá, deja de
    // haber tokens en claro en la base
    refresh_token: null,
    access_token: null,
    access_token_expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  })

  // Mismo caso que el select: antes de la 0019 las columnas cifradas no
  // existen. Se guarda como antes para no perder el refresh token rotado —
  // perderlo obligaría a reconectar a mano.
  if (saveError) {
    await db.from('iol_credentials').upsert({
      user_id: userId,
      refresh_token: token.refresh_token,
      access_token: token.access_token,
      access_token_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
  }

  return token.access_token
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
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`IOL ${path} → ${res.status} ${await res.text().catch(() => '')}`)
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

  // NO hay endpoint de movimientos de dinero (depósitos y extracciones).
  // Probé /cuentas-bancarias/movimientos en GET y POST con cuatro bodies,
  // /estadocuenta/movimientos, /micuenta/movimientos y /Cuenta/Movimientos:
  // las seis devuelven el mismo "Runtime Error" 500 genérico de ASP.NET, que
  // es lo mismo que devuelve una ruta inexistente. No es un problema de
  // parámetros. `fetch-transactions` los detecta por diferencia de saldo y
  // pregunta en vez de inventarlos.
}
