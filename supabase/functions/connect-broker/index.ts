/**
 * connect-broker — a pedido, desde la app
 *
 * Conecta la cuenta de IOL de un usuario.
 *
 * ── La contraseña se guarda cifrada ──────────────────────────────────────
 *
 * La API de IOL solo tiene login por usuario y contraseña (grant_type
 * password): no hay OAuth ni tokens de solo lectura. Así que la contraseña
 * tiene que pasar por acá.
 *
 * Antes se canjeaba por tokens y se descartaba — el token puede operar en la
 * cuenta, y guardar además la contraseña era acumular riesgo. Pero IOL rota
 * el refresh token en cada uso y no tiene otra puerta de entrada: cada vez
 * que ese token moría (un corte de red en plena rotación, otra app usando
 * las mismas credenciales), la conexión quedaba muerta hasta reconectar a
 * mano. Pasó tres veces en una semana y el dueño eligió disponibilidad.
 *
 * Ahora queda guardada CIFRADA (AES-GCM, la clave en un secret de las Edge
 * Functions, fuera de la base) y se usa para una sola cosa: volver a entrar
 * cuando IOL rechaza la renovación. Nunca se loguea, nunca sale por la API,
 * y no hay policy de SELECT que permita leerla. Ver la migración 0025.
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
    let { error } = await db
      .from('iol_credentials')
      .update({
        refresh_token: null,
        access_token: null,
        refresh_token_enc: null,
        access_token_enc: null,
        // Desconectar borra TODO, contraseña incluida: es la promesa de la
        // pantalla ("podés desconectar cuando quieras y no queda nada").
        password_enc: null,
        connected_at: null,
        last_sync_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)

    // Sin la 0025 no existe `password_enc`; se borra lo que sí existe
    if (error) {
      const legacy = await db
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
      error = legacy.error
    }

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

  // Si la 0025 todavía no corrió, `password_enc` no existe y PostgREST rechaza
  // el upsert ENTERO. Conectar sin recuperación automática sigue siendo mejor
  // que no poder conectar.
  let { error } = await db.from('iol_credentials').upsert({
    user_id: userId,
    broker: 'iol',
    // El usuario cumple doble función: etiqueta visible y login del rescate
    account_label: username,
    refresh_token_enc: await encrypt(token.refresh_token),
    access_token_enc: await encrypt(token.access_token),
    // La contraseña, cifrada: el último recurso cuando IOL rechaza el refresh
    // token. Sin esto, cada muerte del token era una reconexión a mano.
    password_enc: await encrypt(password),
    refresh_token: null,
    access_token: null,
    access_token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    connected_at: new Date().toISOString(),
    // Un candado viejo no debe demorar la primera renovación de la sesión nueva
    refresh_lock_until: null,
    last_sync_error: null,
    updated_at: new Date().toISOString(),
  })

  if (error) {
    const legacy = await db.from('iol_credentials').upsert({
      user_id: userId,
      broker: 'iol',
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
    error = legacy.error
  }

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
