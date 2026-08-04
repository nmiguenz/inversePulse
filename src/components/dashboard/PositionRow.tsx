import type { PositionMetrics } from '@/lib/types'
import { formatARS, formatCompactARS, formatPct, toneOf, toneText } from '@/lib/format'
import { sectorColor } from '@/lib/sectors'
import { Sparkline } from './Sparkline'

export function PositionRow({
  position,
  history,
}: {
  position: PositionMetrics
  history: number[]
}) {
  const dayTone = toneOf(position.dayPct)
  const gainTone = toneOf(position.gain)

  return (
    <li className="border-subtle active:bg-hover grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b px-4 py-3 transition-colors last:border-b-0">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 font-mono text-[13px] font-semibold">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: sectorColor(position.sector) }}
            aria-hidden
          />
          {position.symbol}
        </p>
        <p className="text-muted tnum mt-0.5 truncate font-mono text-[11px]">
          {position.quantity} · {formatARS(position.current_price)} · {position.weight.toFixed(1)}%
        </p>
      </div>

      <Sparkline data={history} tone={gainTone} />

      <div className="w-[68px] text-right">
        <p className={`tnum font-mono text-[12px] ${toneText[dayTone]}`}>
          {formatPct(position.dayPct)}
        </p>
        <p className={`tnum mt-0.5 font-mono text-[11px] ${toneText[gainTone]}`}>
          {position.gain > 0 ? '+' : position.gain < 0 ? '-' : ''}
          {formatCompactARS(Math.abs(position.gain))}
        </p>
      </div>
    </li>
  )
}
