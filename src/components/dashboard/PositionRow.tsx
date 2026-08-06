import { useNavigate } from 'react-router-dom'
import type { PositionMetrics } from '@/lib/types'
import { formatPct, toneOf, toneText } from '@/lib/format'
import { useCurrency } from '@/lib/currency'
import { AssetLogo } from '@/components/ui/AssetLogo'

/**
 * Fila de posición con las mismas columnas que la app de IOL:
 * símbolo, variación diaria, rendimiento desde la compra y valorizado.
 *
 * Antes mostraba cantidad y peso, que se leen menos seguido. El rendimiento
 * desde que compraste es el dato que dice si la posición te está yendo bien,
 * y no estaba a la vista en ningún lado.
 */
export function PositionRow({ position }: { position: PositionMetrics }) {
  const navigate = useNavigate()
  const { format } = useCurrency()

  const dayTone = toneOf(position.dayPct)
  const gainTone = toneOf(position.gainPct)

  return (
    <li>
      <button
        type="button"
        onClick={() => navigate(`/activo/${position.symbol}`)}
        className="border-subtle active:bg-hover flex w-full items-center gap-2 border-b px-4 py-3.5 text-left transition-colors"
      >
        <AssetLogo symbol={position.symbol} sector={position.sector} />

        {/* min-w-0 + truncate: sin esto el símbolo largo (PRMCAPB) se desborda
            sobre la columna de al lado en vez de recortarse */}
        <div className="min-w-0 flex-1">
          <p className="text-primary truncate text-[14px] font-semibold">{position.symbol}</p>
          <p className="text-muted mt-0.5 truncate text-[11px]">
            {position.description ?? position.sector}
          </p>
        </div>

        {/* Anchos fijos y shrink-0 para que las columnas de números queden
            alineadas entre filas. Las etiquetas van en el encabezado, no en
            cada fila. */}
        <div className="w-[52px] shrink-0 text-right">
          <p className={`tnum text-[12px] ${toneText[dayTone]}`}>{formatPct(position.dayPct)}</p>
        </div>

        {/* Más ancha que la diaria: el rendimiento acumulado llega a tres
            dígitos (+120,00%), la variación del día prácticamente nunca */}
        <div className="w-[58px] shrink-0 text-right">
          <p className={`tnum text-[12px] ${toneText[gainTone]}`}>{formatPct(position.gainPct)}</p>
        </div>

        <div className="w-[82px] shrink-0 text-right">
          <p className="tnum text-primary text-[13px] font-semibold">{format(position.value)}</p>
          <p className="text-muted mt-0.5 text-[11px]">{position.weight.toFixed(1)}%</p>
        </div>
      </button>
    </li>
  )
}
