import type { ReactNode } from 'react'

export type Severity = 'critical' | 'warning' | 'info' | 'opportunity'

const styles: Record<Severity, string> = {
  critical: 'bg-loss-soft border-loss-line text-loss',
  warning: 'bg-warning-soft border-warning-line text-warning',
  info: 'bg-info-soft border-info-line text-info',
  opportunity: 'bg-accent-soft border-accent-line text-accent',
}

export function AlertBadge({ severity, children }: { severity: Severity; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${styles[severity]}`}
    >
      {children}
    </span>
  )
}

/** Pill de temática mundial — interactiva (Fase 4 abre el detalle) */
export function TagPill({
  emoji,
  label,
  onClick,
}: {
  emoji?: string
  label: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border-line bg-elevated text-secondary active:bg-hover inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] whitespace-nowrap transition-colors"
    >
      {emoji && <span aria-hidden>{emoji}</span>}
      {label}
    </button>
  )
}
