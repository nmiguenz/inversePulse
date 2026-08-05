import type { PositionMetrics } from '@/lib/types'
import { formatCompactARS, formatPct, toneOf, toneText } from '@/lib/format'
import { AssetLogo } from '@/components/ui/AssetLogo'
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
    <li className="border-subtle active:bg-hover flex items-center gap-3 border-b px-5 py-3.5 transition-colors last:border-b-0">
      <AssetLogo symbol={position.symbol} sector={position.sector} />

      <div className="min-w-0 flex-1">
        <p className="text-primary text-[14px] font-semibold">{position.symbol}</p>
        <p className="text-muted tnum mt-0.5 truncate text-[12px]">
          {position.quantity} · {position.weight.toFixed(1)}%
        </p>
      </div>

      <Sparkline data={history} tone={gainTone} />

      <div className="w-[76px] text-right">
        <p className="tnum text-primary text-[13px] font-semibold">
          {formatCompactARS(position.value)}
        </p>
        <p className={`tnum mt-0.5 text-[12px] ${toneText[dayTone]}`}>
          {formatPct(position.dayPct)}
        </p>
      </div>
    </li>
  )
}
