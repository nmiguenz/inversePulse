import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decrypt } from './crypto.ts'

/**
 * La API key de Anthropic de un usuario.
 *
 * Devuelve null si no cargó ninguna: NO es un error. La app funciona sin IA —
 * el monitoreo, las alertas por umbral, las metas, el rendimiento y los paneles
 * de mercado no la necesitan — así que quien no puso key simplemente se saltea
 * en las funciones de IA, y la pantalla le explica qué le falta.
 *
 * Ya no existe una key global de respaldo: el consumo de cada uno lo paga cada
 * uno.
 */
export async function getUserApiKey(
  db: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data } = await db
    .from('user_api_keys')
    .select('api_key_enc')
    .eq('user_id', userId)
    .eq('provider', 'anthropic')
    .maybeSingle()

  if (!data?.api_key_enc) return null

  try {
    return await decrypt(data.api_key_enc)
  } catch (err) {
    // Si no descifra, la clave de cifrado cambió o el dato está corrupto. Se
    // deja registrado para que el usuario vea el motivo en Config en vez de
    // que la IA "no ande" sin explicación.
    const message = 'No se pudo descifrar tu API key. Volvé a cargarla.'
    console.error(`[apiKey] ${userId}: ${err instanceof Error ? err.message : String(err)}`)
    await db.from('user_api_keys').update({ last_error: message }).eq('user_id', userId)
    return null
  }
}

/** Marca que se usó, para poder mostrar "última vez usada" en Config. */
export async function markApiKeyUsed(db: SupabaseClient, userId: string) {
  await db
    .from('user_api_keys')
    .update({ last_used_at: new Date().toISOString(), last_error: null })
    .eq('user_id', userId)
}
