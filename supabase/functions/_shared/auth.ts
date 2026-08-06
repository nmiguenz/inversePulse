/**
 * Estas functions solo las puede invocar el CRON (o vos a mano) con la service
 * role key. NUNCA el frontend: la anon key es pública — está en el bundle que
 * baja cualquier visitante — y con `verify_jwt: true` la plataforma la acepta
 * como JWT válido. Sin este chequeo, cualquiera podría disparar un sync.
 *
 * Cómo se valida:
 *  1. Si el token es igual al secret inyectado, listo (formato clásico).
 *  2. Si es un JWT, la plataforma YA verificó la firma antes de llegar acá
 *     (verify_jwt), así que alcanza con mirar el claim `role`. Esto cubre los
 *     proyectos con el sistema nuevo de API keys, donde el secret inyectado no
 *     tiene el mismo formato que el token del header.
 */
export function isServiceRole(req: Request): boolean {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!token) return false

  const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (expected && token === expected) return true

  const parts = token.split('.')
  if (parts.length !== 3) return false

  try {
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')),
    ) as { role?: string }
    return payload.role === 'service_role'
  } catch {
    return false
  }
}

export function unauthorized(): Response {
  return Response.json({ error: 'Se requiere la service role key' }, { status: 401 })
}

/**
 * El id del usuario cuando la llamada viene de la app con su sesión.
 *
 * La plataforma ya verificó la firma del JWT antes de llegar acá
 * (`verify_jwt`), así que alcanza con leer el claim `sub`. Se usa en las
 * functions que además de correr por cron se disparan desde un botón — hoy
 * solo `goal-advisor`.
 *
 * Devuelve null para la anon key, que no tiene `sub`: una key pública no
 * identifica a nadie.
 */
export function userIdFromJwt(req: Request): string | null {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!token) return null

  const parts = token.split('.')
  if (parts.length !== 3) return null

  try {
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')),
    ) as { sub?: string; role?: string }
    // `authenticated` es el rol de un usuario logueado; la anon key trae `anon`
    return payload.role === 'authenticated' && payload.sub ? payload.sub : null
  } catch {
    return null
  }
}
