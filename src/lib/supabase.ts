import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** Permite mostrar una pantalla de setup en vez de romper si falta el .env */
export const isSupabaseConfigured = Boolean(url && anonKey)

if (!isSupabaseConfigured) {
  console.warn(
    '[supabase] Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copiá .env.example a .env.local.',
  )
}

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'anon', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
})
