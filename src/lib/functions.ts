import { supabase } from '@/lib/supabase'

/**
 * Llama a una Edge Function y devuelve el mensaje de error REAL.
 *
 * `supabase.functions.invoke` trata cualquier respuesta que no sea 2xx como un
 * error genérico ("Edge Function returned a non-2xx status code") y deja `data`
 * en null, así que el cuerpo se pierde. Justo ahí está lo que hay que mostrar:
 * el freno de costo devuelve 429 con "probá de nuevo en N minutos", y sin esto
 * el usuario ve un error técnico que no le dice nada.
 */
export async function invokeFunction<T = unknown>(
  name: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, body ? { body } : undefined)

  if (error) {
    // FunctionsHttpError trae la Response cruda en `context`
    const response = (error as { context?: Response }).context
    if (response && typeof response.json === 'function') {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      if (payload?.error) throw new Error(payload.error)
    }
    throw error
  }

  if (data && typeof data === 'object' && 'error' in data && data.error) {
    throw new Error(String(data.error))
  }

  return data as T
}
