import { useState } from 'react'
import type { Confidence, Opportunity, TimeHorizon } from '@/lib/types'
import { formatARS, formatPct, formatRelativeTime } from '@/lib/format'
import { AssetLogo } from '@/components/ui/AssetLogo'

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
      className="card relative overflow-hidden p-5"
      style={{ borderLeft: '3px solid var(--color-accent)' }}
    >
      <header className="flex items-start gap-3">
        <AssetLogo symbol={opportunity.symbol} />

        <div className="min-w-0 flex-1">
          <p className="text-primary flex items-center gap-2 text-[14px] font-semibold">
            {opportunity.symbol}
            {opportunity.already_owned && (
              <span className="text-muted text-[11px] font-normal">en cartera</span>
            )}
          </p>
          <h3 className="font-display text-primary mt-0.5 text-[15px] leading-snug font-semibold">
            {opportunity.title}
          </h3>
        </div>

        <div className="shrink-0 text-right">
          <p className="font-display tnum text-gain text-[24px] leading-none font-bold">
            {formatPct(growth, 0)}
          </p>
          <p className="text-muted mt-1 text-[11px]">estimado</p>
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
          className={`rounded-full border px-2.5 py-0.5 text-[11px] ${confidence.className}`}
        >
          {confidence.label}
        </span>
        <span className="border-line bg-elevated text-secondary rounded-full border px-2.5 py-0.5 text-[11px]">
          {TYPE_LABEL[opportunity.opportunity_type] ?? opportunity.opportunity_type}
        </span>
        <span className="border-line bg-elevated text-muted rounded-full border px-2.5 py-0.5 text-[11px]">
          {HORIZON_LABEL[opportunity.time_horizon ?? 'medium']}
        </span>
        <span className="text-muted ml-auto font-mono text-[10px]">
          {formatRelativeTime(opportunity.created_at)}
        </span>
      </footer>
    </li>
  )
}
