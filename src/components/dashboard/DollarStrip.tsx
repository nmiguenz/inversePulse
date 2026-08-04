import type { DollarRate } from '@/lib/types'
import { formatARS, formatPct } from '@/lib/format'

const LABELS: Record<string, string> = { mep: 'MEP', ccl: 'CCL', blue: 'Blue', oficial: 'Oficial' }
const ORDER = ['mep', 'ccl', 'blue']

export function DollarStrip({ rates }: { rates: Map<string, DollarRate> }) {
  const shown = ORDER.map((t) => rates.get(t)).filter((r): r is DollarRate => Boolean(r))
  const mep = rates.get('mep')?.sell_price
  const oficial = rates.get('oficial')?.sell_price
  const brecha = mep && oficial ? ((mep - oficial) / oficial) * 100 : null

  if (!shown.length) {
    return <p className="text-muted text-[12px]">Sin cotizaciones todavía.</p>
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-3">
        {shown.map((r) => (
          <div key={r.rate_type}>
            <p className="text-muted font-mono text-[10px] tracking-wider uppercase">
              {LABELS[r.rate_type]}
            </p>
            <p className="font-display tnum text-primary mt-1 text-[17px] font-semibold">
              {r.sell_price != null ? formatARS(r.sell_price) : '—'}
            </p>
          </div>
        ))}
      </div>
      {brecha != null && (
        <p className="text-secondary border-subtle mt-3 border-t pt-3 text-[12px]">
          Brecha MEP/Oficial:{' '}
          <span className="tnum text-primary font-mono">{formatPct(brecha, 1)}</span>
        </p>
      )}
    </div>
  )
}
