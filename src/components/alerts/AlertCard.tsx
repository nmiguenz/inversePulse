import { useRef, useState, type TouchEvent } from 'react'
import type { Alert } from '@/lib/types'
import { AlertBadge } from '@/components/ui/Badge'
import { formatRelativeTime } from '@/lib/format'

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
  const startX = useRef(0)

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
      <div className="absolute inset-0 flex items-center justify-end rounded-2xl bg-[rgba(255,71,87,0.12)] pr-5">
        <span className="text-loss font-mono text-[11px] tracking-wider uppercase">Descartar</span>
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
        className={`border-subtle bg-surface relative rounded-2xl border p-4 ${
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
            <span className="border-line bg-elevated text-primary rounded-full border px-2.5 py-0.5 font-mono text-[10px]">
              {alert.action_suggested}
            </span>
          )}
          {!alert.is_read && <span className="bg-accent ml-auto h-2 w-2 rounded-full" aria-label="sin leer" />}
        </footer>
      </article>
    </li>
  )
}
