import type { ReactNode } from 'react'

export type Severity = 'critical' | 'warning' | 'info' | 'opportunity'

const styles: Record<Severity, string> = {
  critical: 'bg-[rgba(255,71,87,0.12)] border-[rgba(255,71,87,0.3)] text-loss',
  warning: 'bg-[rgba(255,176,32,0.12)] border-[rgba(255,176,32,0.3)] text-warning',
  info: 'bg-[rgba(77,166,255,0.12)] border-[rgba(77,166,255,0.3)] text-info',
  opportunity: 'bg-[rgba(139,92,246,0.12)] border-[rgba(139,92,246,0.3)] text-accent',
}

export function AlertBadge({ severity, children }: { severity: Severity; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-medium tracking-wide uppercase ${styles[severity]}`}
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
