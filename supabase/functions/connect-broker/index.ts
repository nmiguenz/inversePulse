/**
 * connect-broker — a pedido, desde la app
 *
 * Conecta la cuenta de IOL de un usuario.
 *
 * ── La contraseña no se guarda ───────────────────────────────────────────
 *
 * La API de IOL solo tiene login por usuario y contraseña (grant_type
 * password): no hay OAuth ni tokens de solo lectura. Así que la contraseña
 * tiene que pasar por acá una vez.
 *
 * Lo que se hace con ella es lo único que se puede hacer bien: se canjea por
 * tokens y se descarta. Vive en el body de la request y en memoria durante la
 * llamada, y no se escribe en ningún lado — ni en la base, ni en los logs.
 * Lo que queda guardado es el refresh token, cifrado.
 *
 * Esto importa porque el token que se obtiene **puede operar** en la cuenta:
 * la misma API tiene /operar/comprar. Guardar además la contraseña sería
 * acumular un riesgo que no hace falta correr.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { exchangePassword, IolAuthError } from '../_shared/iol.ts'
import { encrypt } from '../_shared/crypto.ts'
import { userIdFromJwt } from '../_shared/auth.ts'
import { jsonWithCors, preflight } from '../_shared/cors.ts'

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre

  // Solo el propio usuario conecta su cuenta. No hay camino de cron acá: no
  // tendría sentido que un proceso automático conectara cuentas.
  const userId = userIdFromJwt(req)
  if (!userId) return jsonWithCors({ error: 'No autorizado' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    username?: string
    password?: string
    action?: 'connect' | 'disconnect'
  }

  // ── Desconectar ────────────────────────────────────────────────────────
  if (body.action === 'disconnect') {
    const { error } = await db
      .from('iol_credentials')
      .update({
        refresh_token: null,
        access_token: null,
        refresh_token_enc: null,
        access_token_enc: null,
        connected_at: null,
        last_sync_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)

    if (error) return jsonWithCors({ error: error.message }, { status: 500 })
    return jsonWithCors({ ok: true, connected: false })
  }

  // ── Conectar ───────────────────────────────────────────────────────────
  const username = body.username?.trim()
  const password = body.password

  if (!username || !password) {
    return jsonWithCors({ error: 'Faltan el usuario y la contraseña' }, { status: 400 })
  }

  let token
  try {
    token = await exchangePassword(username, password)
  } catch (err) {
    // El mensaje de IOL se pasa tal cual: distinguir "contraseña incorrecta" de
    // "la cuenta no tiene la API habilitada" le ahorra al usuario media hora
    // de probar cosas. Nunca se loguea la contraseña.
    const message =
      err instanceof IolAuthError
        ? err.message
        : 'No se pudo conectar con IOL. Probá de nuevo en un rato.'
    console.error(`[connect-broker] ${userId}: falló el canje de credenciales`)
    return jsonWithCors({ error: message }, { status: 400 })
  }

  const { error } = await db.from('iol_credentials').upsert({
    user_id: userId,
    broker: 'iol',
    // El usuario se guarda solo como etiqueta, para que reconozca qué cuenta
    // conectó. La contraseña NO se guarda en ningún campo.
    account_label: username,
    refresh_token_enc: await encrypt(token.refresh_token),
    access_token_enc: await encrypt(token.access_token),
    refresh_token: null,
    access_token: null,
    access_token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    connected_at: new Date().toISOString(),
    last_sync_error: null,
    updated_at: new Date().toISOString(),
  })

  if (error) return jsonWithCors({ error: error.message }, { status: 500 })

  // El primer sync se dispara enseguida: esperar al cron dejaría la app vacía
  // hasta cinco minutos después de conectar, que se siente como que no anduvo.
  try {
    await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/fetch-portfolio`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json',
      },
    })
  } catch {
    // Que falle el sync inicial no invalida la conexión: el cron lo reintenta
  }

  return jsonWithCors({ ok: true, connected: true, account: username })
})
