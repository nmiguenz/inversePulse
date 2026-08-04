import { useState, type FormEvent } from 'react'
import { useAuth } from '@/lib/auth'
import { isSupabaseConfigured } from '@/lib/supabase'

/**
 * Un TypeError de fetch ("Failed to fetch") significa que ni siquiera se llegó
 * al host: casi siempre VITE_SUPABASE_URL apunta a otro lado (error clásico:
 * pegar la URL del panel en vez de la del proyecto) o el proyecto está pausado.
 * El mensaje crudo del browser no dice nada de eso.
 */
function describeError(err: unknown): string {
  if (err instanceof TypeError) {
    const host = import.meta.env.VITE_SUPABASE_URL ?? '(vacía)'
    return `No se pudo contactar a Supabase en ${host}. Revisá que VITE_SUPABASE_URL sea el Project URL de Settings → API (termina en .supabase.co), y que el proyecto no esté pausado.`
  }
  return err instanceof Error ? err.message : 'No se pudo enviar el link'
}

export function Login() {
  const { signInWithEmail } = useAuth()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState('')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setStatus('sending')
    setError('')
    try {
      await signInWithEmail(email.trim())
      setStatus('sent')
    } catch (err) {
      setError(describeError(err))
      setStatus('error')
    }
  }

  return (
    <div className="bg-base flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="animate-fade-up w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/icons/icon-192x192.png" alt="" className="mx-auto h-16 w-16 rounded-2xl" />
          <h1 className="font-display text-primary mt-4 text-[22px] font-bold">
            IOL Portfolio Monitor
          </h1>
          <p className="text-secondary mt-1.5 text-[13px]">
            Entrá con tu email. Te mandamos un link mágico, sin contraseña.
          </p>
        </div>

        {!isSupabaseConfigured ? (
          <div className="border-line bg-surface rounded-2xl border p-4">
            <p className="text-warning font-mono text-[11px] tracking-wider uppercase">
              Falta configurar Supabase
            </p>
            <p className="text-secondary mt-2 text-[13px] leading-relaxed">
              Creá un archivo <code className="text-primary font-mono">.env.local</code> con
              <code className="text-primary font-mono"> VITE_SUPABASE_URL</code> y
              <code className="text-primary font-mono"> VITE_SUPABASE_ANON_KEY</code>, y reiniciá{' '}
              <code className="text-primary font-mono">npm run dev</code>.
            </p>
          </div>
        ) : status === 'sent' ? (
          <div className="border-line bg-surface rounded-2xl border p-5 text-center">
            <p className="text-3xl" aria-hidden>
              📬
            </p>
            <p className="font-display text-primary mt-3 text-[15px] font-semibold">
              Revisá tu casilla
            </p>
            <p className="text-secondary mt-1.5 text-[13px] leading-relaxed">
              Mandamos un link a <span className="text-primary font-mono">{email}</span>. Abrilo
              desde este mismo dispositivo.
            </p>
            <button
              type="button"
              onClick={() => setStatus('idle')}
              className="text-accent mt-4 text-[13px]"
            >
              Usar otro email
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <input
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border-line bg-surface text-primary placeholder:text-muted focus:border-accent w-full rounded-xl border px-4 py-3.5 text-[15px] outline-none transition-colors"
            />
            <button
              type="submit"
              disabled={status === 'sending'}
              className="gradient-accent w-full rounded-xl py-3.5 text-[14px] font-semibold text-white disabled:opacity-50"
            >
              {status === 'sending' ? 'Enviando…' : 'Enviar link de acceso'}
            </button>
            {error && (
              <p className="text-loss text-center text-[12px] leading-relaxed">{error}</p>
            )}
          </form>
        )}
      </div>
    </div>
  )
}
