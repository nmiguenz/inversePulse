import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { invokeFunction } from '@/lib/functions'
import { formatRelativeTime } from '@/lib/format'
import { IconInfo } from '@/components/ui/Icon'

type KeyStatus = {
  key_hint: string | null
  last_used_at: string | null
  last_error: string | null
}

const CONSOLE_URL = 'https://platform.claude.com'
const KEYS_URL = 'https://platform.claude.com/settings/keys'
const BILLING_URL = 'https://platform.claude.com/settings/billing'

/**
 * La API key de Claude de cada usuario.
 *
 * ── Por qué una key y no "Conectar con Claude" ───────────────────────────
 *
 * Porque no existe. La API de Anthropic acepta dos formas de autenticación:
 * `x-api-key` (una key de la Consola) y un token de Workload Identity
 * Federation, que sirve para que un SERVIDOR pruebe su identidad, no para
 * autenticar a una persona. Y en 2026 Anthropic prohibió explícitamente el
 * OAuth de terceros: esos tokens quedaron restringidos a Claude.ai y Claude
 * Code.
 *
 * La confusión es de dirección: en Drive o Notion, Claude es el CLIENTE que se
 * conecta a esos servicios. Acá es al revés — esta app consume Claude. Para esa
 * dirección no hay conector, solo la key.
 *
 * Todo eso está explicado en la pantalla y no solo acá, porque es la pregunta
 * que cualquiera se va a hacer al ver un campo pidiendo una clave.
 */
export function ApiKeySettings() {
  const { session } = useAuth()
  const [status, setStatus] = useState<KeyStatus | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [showHelp, setShowHelp] = useState(false)

  const load = useCallback(async () => {
    if (!session) return
    const { data } = await supabase
      .from('api_key_status')
      .select('key_hint, last_used_at, last_error')
      .maybeSingle()
    setStatus((data ?? null) as KeyStatus | null)
    setLoading(false)
  }, [session])

  useEffect(() => {
    void load()
  }, [load])

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await invokeFunction('save-api-key', { api_key: value })
      setValue('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la key')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError('')
    try {
      await invokeFunction('save-api-key', { action: 'delete' })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar la key')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="bg-elevated h-20 animate-pulse rounded-xl" />

  return (
    <div>
      {/* ── Estado ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {status?.key_hint ? (
            <>
              <p className="text-primary text-[13px] font-medium">
                Key configurada · ····{status.key_hint}
              </p>
              <p className="text-muted mt-0.5 text-[11px]">
                {status.last_used_at
                  ? `Última vez usada ${formatRelativeTime(status.last_used_at)}`
                  : 'Todavía sin usar'}
              </p>
            </>
          ) : (
            <>
              <p className="text-primary text-[13px] font-medium">Sin API key de Claude</p>
              <p className="text-muted mt-0.5 text-[11px] leading-relaxed">
                El monitoreo, las alertas, las metas y el rendimiento andan igual. Lo que necesita
                key es el asesor, el plan de metas y el resumen de noticias.
              </p>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Mismo indicador que la conexión de IOL: de un vistazo se ve si las
              dos piezas de configuración están puestas */}
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${status?.key_hint ? 'bg-gain' : 'bg-muted'}`}
            aria-label={status?.key_hint ? 'Key configurada' : 'Sin key'}
          />
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            aria-label="Cómo conseguir la API key"
            aria-expanded={showHelp}
            className="border-line bg-elevated text-secondary active:bg-hover flex h-7 w-7 items-center justify-center rounded-full border transition-colors"
          >
            <IconInfo width={15} height={15} />
          </button>
          {status?.key_hint && (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className="border-line text-muted active:text-loss rounded-xl border px-3 py-1.5 text-[12px] disabled:opacity-50"
            >
              Quitar
            </button>
          )}
        </div>
      </div>

      {status?.last_error && (
        <p className="bg-warning-soft text-warning mt-3 rounded-xl px-3 py-2 text-[12px] leading-relaxed">
          {status.last_error}
        </p>
      )}

      {/* ── Instrucciones ───────────────────────────────────────────── */}
      {showHelp && <KeyInstructions />}

      {/* ── Carga ───────────────────────────────────────────────────── */}
      <form onSubmit={save} className="mt-3 space-y-2">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="sk-ant-..."
          autoComplete="off"
          required
          className="border-line bg-elevated text-primary w-full rounded-xl border px-3 py-2.5 font-mono text-[12px] outline-none"
        />
        {error && <p className="text-loss text-[12px] leading-relaxed">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="border-accent text-accent w-full rounded-xl border py-2.5 text-[13px] font-medium disabled:opacity-50"
        >
          {busy ? 'Verificando…' : status?.key_hint ? 'Reemplazar key' : 'Guardar key'}
        </button>
        <p className="text-muted text-[11px] leading-relaxed">
          Se prueba contra la API antes de guardarla: una key inválida no se acepta, así no te
          quedás creyendo que quedó configurada. Se guarda cifrada y no se puede volver a leer
          desde la app.
        </p>
      </form>
    </div>
  )
}

/**
 * Los cuatro pasos, con las dos advertencias que más plata y tiempo hacen
 * perder: que Claude Pro no incluye la API, y que sin crédito cargado la key
 * se crea igual pero no funciona.
 */
function KeyInstructions() {
  return (
    <div className="border-subtle mt-3 space-y-3 border-t pt-3">
      <div>
        <p className="text-primary text-[12px] font-semibold">
          Esta app funciona solo con Claude (Anthropic)
        </p>
        <p className="text-muted mt-1 text-[11px] leading-relaxed">
          No acepta keys de OpenAI, Gemini ni ningún otro proveedor: el análisis usa
          características propias de la API de Anthropic. La key empieza con{' '}
          <span className="font-mono">sk-ant-</span>.
        </p>
      </div>

      <div className="bg-warning-soft rounded-xl px-3.5 py-3">
        <p className="text-primary text-[12px] font-medium">
          Una suscripción Claude Pro o Max NO sirve acá
        </p>
        <p className="text-secondary mt-1 text-[11px] leading-relaxed">
          Son dos productos separados con dos facturaciones distintas. El acceso a la API se paga
          aparte, por uso. Tener Pro no te da crédito de API ni al revés.
        </p>
      </div>

      <div>
        <p className="text-primary text-[12px] font-semibold">Cómo conseguirla</p>
        <ol className="mt-2 space-y-2.5">
          <Step n={1}>
            Entrá a{' '}
            <ExternalLink href={CONSOLE_URL}>platform.claude.com</ExternalLink> y creá una cuenta.
            Es la consola de desarrolladores, distinta de Claude.ai.
          </Step>
          <Step n={2}>
            Cargá crédito en{' '}
            <ExternalLink href={BILLING_URL}>Billing</ExternalLink>. Este paso va{' '}
            <strong className="text-secondary">antes</strong> a propósito: sin saldo la key se
            crea igual, pero todas las llamadas fallan y parece que la key está mal.
          </Step>
          <Step n={3}>
            Andá a <ExternalLink href={KEYS_URL}>Settings → API keys</ExternalLink> y tocá{' '}
            <span className="font-mono">Create Key</span>.
          </Step>
          <Step n={4}>
            Copiala y pegala acá arriba. Se muestra{' '}
            <strong className="text-secondary">una sola vez</strong>: si cerrás la ventana sin
            copiarla, hay que crear otra.
          </Step>
        </ol>
      </div>

      <div>
        <p className="text-primary text-[12px] font-semibold">Cuánto cuesta</p>
        <p className="text-muted mt-1 text-[11px] leading-relaxed">
          Medido sobre análisis reales de esta app: cada corrida del asesor consume unos 5.800
          tokens de entrada y 1.800 de salida, que a los precios de Opus 5 dan{' '}
          <strong className="text-secondary">unos US$0,07</strong>. A dos por día hábil son{' '}
          <strong className="text-secondary">~US$3,30 al mes</strong>, y sumando el resumen de
          noticias y los planes de metas, del orden de{' '}
          <strong className="text-secondary">US$5 a 8 mensuales</strong>.
        </p>
        <p className="text-muted mt-1.5 text-[11px] leading-relaxed">
          Es una estimación medida, no un precio garantizado: lo fija Anthropic y la parte más
          variable es el feed de noticias. Podés ponerle un tope por mes desde la consola.
        </p>
      </div>

      <div>
        <p className="text-primary text-[12px] font-semibold">
          ¿Por qué no hay un botón "Conectar con Claude"?
        </p>
        <p className="text-muted mt-1 text-[11px] leading-relaxed">
          Porque no existe. En integraciones como Drive o Notion, Claude es el que se conecta a
          esos servicios; acá es al revés, esta app consume Claude, y para esa dirección Anthropic
          solo ofrece la API key. Además, en 2026 prohibió que aplicaciones de terceros usen el
          inicio de sesión de Claude, que quedó reservado a sus propios productos.
        </p>
      </div>
    </div>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="bg-elevated text-secondary tnum flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold">
        {n}
      </span>
      <span className="text-muted min-w-0 flex-1 text-[11px] leading-relaxed">{children}</span>
    </li>
  )
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent break-words underline underline-offset-2"
    >
      {children}
    </a>
  )
}
