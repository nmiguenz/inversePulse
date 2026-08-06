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
  const { data: creds } = await db
    .from('iol_credentials')
    .select('refresh_token, access_token, access_token_expires_at')
    .eq('user_id', userId)
    .maybeSingle()

  // Cache con 60s de margen
  if (creds?.access_token && creds.access_token_expires_at) {
    const expiresAt = new Date(creds.access_token_expires_at).getTime()
    if (expiresAt - Date.now() > 60_000) return creds.access_token
  }

  let token: TokenResponse
  if (creds?.refresh_token) {
    try {
      token = await requestToken({
        refresh_token: creds.refresh_token,
        grant_type: 'refresh_token',
      })
    } catch {
      token = await loginWithPassword()
    }
  } else {
    token = await loginWithPassword()
  }

  await db.from('iol_credentials').upsert({
    user_id: userId,
    refresh_token: token.refresh_token,
    access_token: token.access_token,
    access_token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  })

  return token.access_token
}

function loginWithPassword(): Promise<TokenResponse> {
  const username = Deno.env.get('IOL_USERNAME')
  const password = Deno.env.get('IOL_PASSWORD')
  if (!username || !password) {
    throw new IolAuthError('Faltan los secrets IOL_USERNAME / IOL_PASSWORD')
  }
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

export const iol = {
  portfolio: (token: string, pais = 'argentina') =>
    get<IolPortfolio>(token, `/api/v2/portafolio/${pais}`),
  estadoCuenta: (token: string) => get<IolEstadoCuenta>(token, '/api/v2/estadocuenta'),
}
