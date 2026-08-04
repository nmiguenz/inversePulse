import type { ReactNode } from 'react'

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <section className={`border-subtle bg-surface rounded-2xl border p-4 ${className}`}>
      {children}
    </section>
  )
}

export function SectionTitle({ icon, children }: { icon?: string; children: ReactNode }) {
  return (
    <h2 className="text-secondary mb-3 flex items-center gap-2 font-mono text-[11px] font-medium tracking-[0.12em] uppercase">
      {icon && <span aria-hidden>{icon}</span>}
      {children}
    </h2>
  )
}

export function EmptyState({
  icon,
  title,
  description,
}: {
  icon: string
  title: string
  description: string
}) {
  return (
    <div className="border-subtle bg-surface flex flex-col items-center gap-2 rounded-2xl border px-6 py-12 text-center">
      <span className="text-3xl opacity-60" aria-hidden>
        {icon}
      </span>
      <p className="font-display text-primary text-[15px] font-semibold">{title}</p>
      <p className="text-secondary max-w-[28ch] text-[13px] leading-relaxed">{description}</p>
    </div>
  )
}
