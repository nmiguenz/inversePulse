/**
 * CORS para las functions que se llaman desde el navegador.
 *
 * ── Por qué hace falta ───────────────────────────────────────────────────
 *
 * Todas las functions nacieron para el cron, que las llama de servidor a
 * servidor y no pasa por CORS. Cuando la app empezó a invocar dos de ellas
 * desde el browser, el navegador mandó primero un preflight OPTIONS —lo hace
 * siempre que la request lleva un header no trivial, y `Authorization` lo es— y
 * ese OPTIONS venía SIN Authorization, así que nuestro propio chequeo lo
 * rechazaba con 401 antes de contestar ningún header de CORS. El browser
 * mostraba "Failed to send a request to the Edge Function", que no dice nada
 * del problema real.
 *
 * ── Sobre el origen abierto ──────────────────────────────────────────────
 *
 * `*` es aceptable acá porque la autenticación va por bearer token, que el
 * navegador NO adjunta solo: un sitio de terceros puede hacer el request pero
 * no puede firmarlo. No hay cookies de sesión en juego. Además los previews de
 * Vercel cambian de dominio en cada deploy, así que una lista blanca se
 * rompería sola.
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

/** Respuesta al preflight. Va ANTES de cualquier chequeo de autorización. */
export function preflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null
  return new Response(null, { status: 204, headers: corsHeaders })
}

/** Como Response.json, pero con los headers de CORS puestos */
export function jsonWithCors(body: unknown, init?: ResponseInit): Response {
  const res = Response.json(body, init)
  for (const [k, v] of Object.entries(corsHeaders)) res.headers.set(k, v)
  return res
}
