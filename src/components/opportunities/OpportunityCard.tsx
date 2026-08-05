import { useState } from 'react'
import type { Confidence, Opportunity, TimeHorizon } from '@/lib/types'
import { formatARS, formatPct, formatRelativeTime } from '@/lib/format'
import { sectorColor } from '@/lib/sectors'

const TYPE_LABEL: Record<string, string> = {
  pullback: 'Pullback',
  momentum: 'Momentum',
  undervalued: 'Subvaluada',
  sector_rotation: 'Rotación sectorial',
  earnings_play: 'Earnings',
}

const HORIZON_LABEL: Record<TimeHorizon, string> = {
  short: '1-4 semanas',
  medium: '1-6 meses',
  long: '6+ meses',
}

const CONFIDENCE_STYLE: Record<Confidence, { label: string; className: string }> = {
  high: { label: 'Convicción alta', className: 'border-accent bg-accent-soft text-accent' },
  medium: { label: 'Convicción media', className: 'border-line bg-elevated text-secondary' },
  low: { label: 'Convicción baja', className: 'border-line bg-elevated text-muted' },
}

export function OpportunityCard({ opportunity }: { opportunity: Opportunity }) {
  const [expanded, setExpanded] = useState(false)
  const confidence = CONFIDENCE_STYLE[opportunity.confidence ?? 'medium']
  const growth = opportunity.growth_estimate_pct ?? 0

  return (
    <li
      className="border-subtle bg-surface relative overflow-hidden rounded-2xl border p-4"
      style={{ borderLeft: '3px solid var(--color-accent)' }}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-mono text-[13px] font-semibold">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: sectorColor('Tech') }}
              aria-hidden
            />
            {opportunity.symbol}
            {opportunity.already_owned && (
              <span className="text-muted ml-1 font-mono text-[10px] tracking-wide uppercase">
                en cartera
              </span>
            )}
          </p>
          <h3 className="font-display text-primary mt-1 text-[14px] leading-snug font-semibold">
            {opportunity.title}
          </h3>
        </div>

        <div className="shrink-0 text-right">
          <p className="font-display tnum text-gain text-[22px] leading-none font-bold">
            {formatPct(growth, 0)}
          </p>
          <p className="text-muted mt-0.5 font-mono text-[10px] tracking-wide uppercase">estimado</p>
        </div>
      </header>

      <p
        className={`text-secondary mt-3 text-[13px] leading-relaxed ${expanded ? '' : 'line-clamp-3'}`}
      >
        {opportunity.reasoning}
      </p>

      {opportunity.reasoning.length > 150 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-accent mt-1.5 text-[12px]"
        >
          {expanded ? 'Ver menos' : 'Ver análisis'}
        </button>
      )}

      {opportunity.current_price != null && opportunity.target_price != null && (
        <div className="border-subtle text-secondary mt-3 flex items-center gap-2 border-t pt-3 font-mono text-[11px]">
          <span className="tnum">{formatARS(opportunity.current_price)}</span>
          <span className="text-muted" aria-hidden>
            →
          </span>
          <span className="tnum text-gain">{formatARS(opportunity.target_price)}</span>
        </div>
      )}

      <footer className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] tracking-wide uppercase ${confidence.className}`}
        >
          {confidence.label}
        </span>
        <span className="border-line bg-elevated text-secondary rounded-full border px-2.5 py-0.5 font-mono text-[10px]">
          {TYPE_LABEL[opportunity.opportunity_type] ?? opportunity.opportunity_type}
        </span>
        <span className="border-line bg-elevated text-muted rounded-full border px-2.5 py-0.5 font-mono text-[10px]">
          {HORIZON_LABEL[opportunity.time_horizon ?? 'medium']}
        </span>
        <span className="text-muted ml-auto font-mono text-[10px]">
          {formatRelativeTime(opportunity.created_at)}
        </span>
      </footer>
    </li>
  )
}
