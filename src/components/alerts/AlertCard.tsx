import { useRef, useState, type TouchEvent } from 'react'
import type { Alert } from '@/lib/types'
import { AlertBadge } from '@/components/ui/Badge'
import { IdleCashOptions } from '@/components/alerts/IdleCashOptions'
import { formatRelativeTime } from '@/lib/format'
import { supabase } from '@/lib/supabase'

const SEVERITY_LABEL: Record<Alert['severity'], string> = {
  critical: 'Crítica',
  warning: 'Importante',
  info: 'Info',
  opportunity: 'Oportunidad',
}

const SEVERITY_ICON: Record<Alert['severity'], string> = {
  critical: '🔴',
  warning: '🟡',
  info: '🔵',
  opportunity: '🟣',
}

const DISMISS_THRESHOLD = 96

/**
 * Las que se pueden silenciar.
 *
 * Solo los avisos de configuración: son informativos y repetitivos mientras el
 * problema esté. Las de mercado no entran — que se pueda apagar un stop loss de
 * un toque sería un botón para perder plata.
 */
const MUTABLE = new Set(['connection_lost', 'api_key_missing', 'api_key_invalid'])

/** Cuánto dura el silencio. Vence solo, a propósito. */
const MUTE_DAYS = 7

export function AlertCard({
  alert,
  onDismiss,
  onRead,
}: {
  alert: Alert
  onDismiss: (id: string) => void
  onRead: (id: string) => void
}) {
  const [offset, setOffset] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const [showOptions, setShowOptions] = useState(false)
  const [muting, setMuting] = useState(false)
  const startX = useRef(0)

  /**
   * Silencia este tipo de aviso por 7 días.
   *
   * Se guarda en `users.settings.muted_alerts` como { tipo: fecha_hasta }, que
   * es lo que lee `evaluate-alerts` antes de crear el aviso. Con fecha de
   * vencimiento y no un booleano: si el problema sigue, vuelve a avisar.
   */
  async function mute() {
    setMuting(true)
    try {
      const { data: session } = await supabase.auth.getUser()
      const uid = session.user?.id
      if (!uid) return

      const { data } = await supabase.from('users').select('settings').eq('id', uid).maybeSingle()
      const settings = (data?.settings ?? {}) as Record<string, unknown>
      const muted = (settings.muted_alerts ?? {}) as Record<string, string>

      const until = new Date(Date.now() + MUTE_DAYS * 86_400_000).toISOString()
      await supabase
        .from('users')
        .update({ settings: { ...settings, muted_alerts: { ...muted, [alert.alert_type]: until } } })
        .eq('id', uid)

      onDismiss(alert.id)
    } finally {
      setMuting(false)
    }
  }

  function onTouchStart(e: TouchEvent) {
    startX.current = e.touches[0].clientX
  }

  function onTouchMove(e: TouchEvent) {
    // Solo hacia la izquierda; el gesto a la derecha lo maneja el scroll de la página
    const delta = Math.min(0, e.touches[0].clientX - startX.current)
    setOffset(delta)
  }

  function onTouchEnd() {
    if (offset < -DISMISS_THRESHOLD) {
      setLeaving(true)
      setOffset(-window.innerWidth)
      // Espera a que termine la transición antes de sacarlo de la lista
      setTimeout(() => onDismiss(alert.id), 180)
    } else {
      setOffset(0)
    }
  }

  return (
    <li className="relative overflow-hidden rounded-2xl">
      {/* Fondo que se revela al deslizar */}
      <div className="absolute inset-0 flex items-center justify-end rounded-2xl bg-loss-soft pr-5">
        <span className="text-loss text-[12px] font-medium">Descartar</span>
      </div>

      <article
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={() => !alert.is_read && onRead(alert.id)}
        style={{
          transform: `translateX(${offset}px)`,
          transition: offset === 0 || leaving ? 'transform 0.18s ease-out' : 'none',
        }}
        className={`card relative p-5 ${
          alert.is_read ? '' : 'border-l-accent border-l-[3px]'
        }`}
      >
        <header className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span aria-hidden>{SEVERITY_ICON[alert.severity]}</span>
            <h3 className="font-display truncate text-[14px] font-semibold">{alert.title}</h3>
          </div>
          <time className="text-muted shrink-0 font-mono text-[10px] whitespace-nowrap">
            {formatRelativeTime(alert.created_at)}
          </time>
        </header>

        <p className="text-secondary mt-2 text-[13px] leading-relaxed">{alert.message}</p>

        <footer className="mt-3 flex items-center gap-2">
          <AlertBadge severity={alert.severity}>{SEVERITY_LABEL[alert.severity]}</AlertBadge>
          {alert.action_suggested && (
            <span className="border-line bg-elevated text-primary rounded-full border px-2.5 py-0.5 text-[11px]">
              {alert.action_suggested}
            </span>
          )}
          {!alert.is_read && <span className="bg-accent ml-auto h-2 w-2 rounded-full" aria-label="sin leer" />}
        </footer>

        {/* Solo los avisos de configuración se pueden silenciar. Un stop loss
            no: silenciar "cruzaste tu piso de pérdida" es exactamente lo que no
            hay que poder hacer de un toque. */}
        {MUTABLE.has(alert.alert_type) && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              void mute()
            }}
            disabled={muting}
            className="border-line text-muted active:bg-hover mt-3 w-full rounded-xl border py-2 text-[12px] disabled:opacity-50"
          >
            {muting ? 'Silenciando…' : 'No mostrar por 7 días'}
          </button>
        )}

        {alert.alert_type === 'idle_cash' && (
          <>
            <button
              type="button"
              onClick={(e) => {
                // Sin esto, el click también marca la alerta como leída y
                // dispara el handler del artículo
                e.stopPropagation()
                setShowOptions((v) => !v)
              }}
              className="border-accent text-accent active:bg-hover mt-3 w-full rounded-xl border py-2 text-[12px] font-medium"
            >
              {showOptions ? 'Ocultar opciones' : '¿En qué lo pongo?'}
            </button>
            {showOptions && <IdleCashOptions />}
          </>
        )}
      </article>
    </li>
  )
}
