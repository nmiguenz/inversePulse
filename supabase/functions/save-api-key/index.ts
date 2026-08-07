/**
 * save-api-key — a pedido, desde Configuración
 *
 * Guarda la API key de Anthropic de un usuario, cifrada.
 *
 * El cifrado tiene que pasar acá y no en el navegador: la clave vive en un
 * secret de las Edge Functions, fuera de la base y fuera del bundle que baja
 * cualquier visitante.
 *
 * Antes de guardar, la key se PRUEBA contra la API. Guardar una key inválida
 * dejaría al usuario creyendo que configuró todo mientras el asesor falla en
 * silencio dos veces por día.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encrypt } from '../_shared/crypto.ts'
import { userIdFromJwt } from '../_shared/auth.ts'
import { jsonWithCors, preflight } from '../_shared/cors.ts'

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

/** Llamada mínima para saber si la key sirve, sin gastar tokens de salida. */
async function validate(apiKey: string): Promise<string | null> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    }),
  })

  if (res.ok) return null

  if (res.status === 401) return 'La API key no es válida.'
  if (res.status === 429) return 'La key es válida pero está sin cupo disponible.'
  if (res.status === 400) {
    // Un 400 con max_tokens=1 es esperable en algunos modelos: la key funcionó
    return null
  }

  return `Anthropic devolvió ${res.status} al probar la key.`
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre

  const userId = userIdFromJwt(req)
  if (!userId) return jsonWithCors({ error: 'No autorizado' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    api_key?: string
    action?: 'save' | 'delete'
  }

  if (body.action === 'delete') {
    const { error } = await db.from('user_api_keys').delete().eq('user_id', userId)
    if (error) return jsonWithCors({ error: error.message }, { status: 500 })
    return jsonWithCors({ ok: true, configured: false })
  }

  const apiKey = body.api_key?.trim()
  if (!apiKey) return jsonWithCors({ error: 'Falta la API key' }, { status: 400 })

  if (!apiKey.startsWith('sk-ant-')) {
    // El prefijo delata de quién es la key, así que se puede decir algo mejor
    // que "formato inválido": el usuario probablemente pegó la de otro
    // proveedor sin saber que esta app no los soporta.
    const from = apiKey.startsWith('sk-proj-') || apiKey.startsWith('sk-')
      ? 'Esa parece una key de OpenAI. '
      : apiKey.startsWith('AIza')
        ? 'Esa parece una key de Google Gemini. '
        : ''

    return jsonWithCors(
      {
        error:
          `${from}Esta app funciona solo con Claude (Anthropic): las keys empiezan con ` +
          `"sk-ant-" y se crean en platform.claude.com. Tocá el ícono de información para ver ` +
          `los pasos.`,
      },
      { status: 400 },
    )
  }

  const problem = await validate(apiKey)
  if (problem) return jsonWithCors({ error: problem }, { status: 400 })

  const { error } = await db.from('user_api_keys').upsert({
    user_id: userId,
    provider: 'anthropic',
    api_key_enc: await encrypt(apiKey),
    // Solo los últimos 4, para que reconozca cuál cargó. La key entera no se
    // puede volver a leer desde la app ni con la sesión del dueño.
    key_hint: apiKey.slice(-4),
    last_error: null,
    updated_at: new Date().toISOString(),
  })

  if (error) return jsonWithCors({ error: error.message }, { status: 500 })
  return jsonWithCors({ ok: true, configured: true, hint: apiKey.slice(-4) })
})
