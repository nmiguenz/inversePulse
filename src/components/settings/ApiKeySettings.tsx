import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { invokeFunction } from '@/lib/functions'
import { formatRelativeTime } from '@/lib/format'

type KeyStatus = {
  key_hint: string | null
  last_used_at: string | null
  last_error: string | null
}

/**
 * La API key de Anthropic de cada usuario.
 *
 * Cada uno paga su propio consumo. La key se guarda cifrada y no se puede
 * volver a leer desde la app — ni con la sesión del dueño — así que se muestran
 * solo los últimos cuatro caracteres para que reconozca cuál cargó.
 *
 * Sin key la app funciona: lo que se apaga es el asesor, el plan de metas y el
 * análisis de noticias. Eso se dice acá y en cada pantalla afectada, en vez de
 * dejar botones que fallan sin explicación.
 */
export function ApiKeySettings() {
  const { session } = useAuth()
  const [status, setStatus] = useState<KeyStatus | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

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
      {status?.key_hint ? (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-primary text-[13px] font-medium">
              Key configurada · ····{status.key_hint}
            </p>
            <p className="text-muted mt-0.5 text-[11px]">
              {status.last_used_at
                ? `Última vez usada ${formatRelativeTime(status.last_used_at)}`
                : 'Todavía sin usar'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            className="border-line text-muted active:text-loss shrink-0 rounded-xl border px-3 py-1.5 text-[12px] disabled:opacity-50"
          >
            Quitar
          </button>
        </div>
      ) : (
        <>
          <p className="text-primary text-[13px] font-medium">Sin API key</p>
          <p className="text-muted mt-0.5 text-[11px] leading-relaxed">
            El monitoreo, las alertas, las metas y el rendimiento andan igual. Lo que necesita key
            es el asesor, el plan de metas y el resumen de noticias — cada uno paga su propio
            consumo.
          </p>
        </>
      )}

      {status?.last_error && (
        <p className="bg-warning-soft text-warning mt-3 rounded-xl px-3 py-2 text-[12px] leading-relaxed">
          {status.last_error}
        </p>
      )}

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
