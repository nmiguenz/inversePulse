/**
 * keep-session-alive — cada 6 horas, todos los días
 *
 * Renueva el token de IOL y nada más. No sincroniza posiciones, no crea
 * alertas, no usa IA.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────
 *
 * El resto de las funciones corre solo en horario de mercado, lunes a viernes.
 * Del viernes a las 20:00 UTC al lunes a las 13:30 pasan más de 60 horas sin
 * que nadie renueve el token, y si el refresh token de IOL caduca por
 * inactividad la conexión aparece muerta cada lunes a la mañana.
 *
 * Es la excepción deliberada a la regla de "solo en horario de mercado": la
 * regla existe para no gastar en IA ni en datos que no se mueven, y esto no
 * hace ninguna de las dos cosas. Es una sola llamada que mantiene viva la
 * sesión, contra la alternativa de reconectar a mano escribiendo la contraseña.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAccessToken, NoConnectionError } from '../_shared/iol.ts'
import { isServiceRole, unauthorized } from '../_shared/auth.ts'

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

Deno.serve(async (req) => {
  if (!isServiceRole(req)) return unauthorized()

  const { data: users, error } = await db.from('users').select('id')
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const results: Record<string, unknown> = {}

  for (const user of users ?? []) {
    try {
      // `getAccessToken` renueva solo si hace falta y guarda la rotación. Si el
      // token vigente todavía sirve, esto no le pide nada a IOL.
      await getAccessToken(db, user.id)
      results[user.id] = { ok: true }
    } catch (err) {
      if (err instanceof NoConnectionError) {
        results[user.id] = { skipped: 'sin cuenta conectada' }
        continue
      }
      const message = err instanceof Error ? err.message : String(err)
      results[user.id] = { error: message }
      console.error(`[keep-session-alive] ${user.id}:`, message)
    }
  }

  return Response.json({ ok: true, results })
})
