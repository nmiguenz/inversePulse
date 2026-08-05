import { useState } from 'react'
import type { Recommendation } from '@/lib/types'
import { formatARS, formatRelativeTime } from '@/lib/format'
import { AssetLogo } from '@/components/ui/AssetLogo'

const ACTION: Record<string, { label: string; className: string; icon: string }> = {
  buy: { label: 'Comprar', className: 'bg-gain-soft border-gain-line text-gain', icon: '↗' },
  add: { label: 'Ampliar', className: 'bg-gain-soft border-gain-line text-gain', icon: '＋' },
  trim: { label: 'Reducir', className: 'bg-warning-soft border-warning-line text-warning', icon: '↘' },
  sell: { label: 'Vender', className: 'bg-loss-soft border-loss-line text-loss', icon: '↓' },
  rebalance: { label: 'Rebalancear', className: 'bg-info-soft border-info-line text-info', icon: '⇄' },
  hold: { label: 'No hacer nada', className: 'border-line bg-elevated text-secondary', icon: '=' },
}

const CONFIDENCE: Record<string, string> = {
  high: 'Convicción alta',
  medium: 'Convicción media',
  low: 'Convicción baja',
}

const HORIZON: Record<string, string> = {
  short: '1-4 semanas',
  medium: '1-6 meses',
  long: '6+ meses',
}

export function RecommendationCard({ rec }: { rec: Recommendation }) {
  const [expanded, setExpanded] = useState(false)
  const action = ACTION[rec.action] ?? ACTION.hold

  return (
    <li className="card p-5">
      <header className="flex items-start gap-3">
        {rec.action !== 'hold' && <AssetLogo symbol={rec.symbol} />}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${action.className}`}>
              {action.icon} {action.label}
            </span>
            {rec.action !== 'hold' && (
              <span className="text-primary text-[14px] font-semibold">{rec.symbol}</span>
            )}
            {rec.counterpart_symbol && (
              <span className="text-muted text-[12px]">desde {rec.counterpart_symbol}</span>
            )}
          </div>

          <h3 className="font-display text-primary mt-1.5 text-[15px] leading-snug font-semibold">
            {rec.title}
          </h3>
        </div>
      </header>

      {/* Aviso explícito: esta venta convierte una pérdida en papel en una real */}
      {rec.realizes_loss && (
        <p className="bg-loss-soft text-loss mt-3 rounded-xl px-3 py-2 text-[12px] leading-relaxed">
          Esta venta cristaliza una pérdida. El asesor la sugiere igual porque considera que la
          tesis se rompió — leé el análisis antes de ejecutarla.
        </p>
      )}

      <p className={`text-secondary mt-3 text-[13px] leading-relaxed ${expanded ? '' : 'line-clamp-3'}`}>
        {rec.reasoning}
      </p>

      {rec.reasoning.length > 150 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-accent mt-1.5 text-[13px]"
        >
          {expanded ? 'Ver menos' : 'Ver análisis completo'}
        </button>
      )}

      {rec.suggested_amount != null && (
        <div className="border-subtle mt-3 border-t pt-3">
          <p className="text-secondary text-[12px]">Monto sugerido</p>
          <p className="font-display tnum text-primary mt-0.5 text-[18px] font-semibold">
            {formatARS(rec.suggested_amount)}
            {rec.suggested_quantity ? (
              <span className="text-muted ml-2 text-[13px] font-normal">
                ≈ {rec.suggested_quantity} {rec.suggested_quantity === 1 ? 'CEDEAR' : 'CEDEARs'}
              </span>
            ) : null}
          </p>
        </div>
      )}

      <footer className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
            rec.confidence === 'high'
              ? 'border-accent bg-accent-soft text-accent'
              : 'border-line bg-elevated text-secondary'
          }`}
        >
          {CONFIDENCE[rec.confidence ?? 'medium']}
        </span>
        {rec.time_horizon && (
          <span className="border-line bg-elevated text-muted rounded-full border px-2.5 py-0.5 text-[11px]">
            {HORIZON[rec.time_horizon]}
          </span>
        )}
        <span className="text-muted ml-auto text-[11px]">{formatRelativeTime(rec.created_at)}</span>
      </footer>
    </li>
  )
}
