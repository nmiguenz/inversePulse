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

  // Solo se muestra cuando la prima es accionable. Entre -3% y +3% el CEDEAR
  // cotiza en línea con el MEP y el dato no cambia ninguna decisión: mostrarlo
  // en todas las filas sería ruido en la columna que más se mira.
  const premium = position.fxPremiumPct
  const showPremium = premium !== undefined && Math.abs(premium) >= 3

  return (
    <li>
      <button
        type="button"
        onClick={() => navigate(`/activo/${position.symbol}`)}
        className="border-subtle active:bg-hover flex w-full items-center gap-2 border-b px-4 py-3.5 text-left transition-colors"
      >
        {/* El símbolo va debajo del logo, no al lado: en una columna angosta
            "PRMCAPB" se recortaba a "P." y no se entendía nada. Apilado tiene
            todo el ancho del bloque para él. */}
        <div className="w-12 shrink-0 text-center">
          <div className="flex justify-center">
            <AssetLogo symbol={position.symbol} sector={position.sector} />
          </div>
          <p className="text-primary mt-1 truncate text-[10px] font-semibold">{position.symbol}</p>
        </div>

        {/* Las tres columnas de números se reparten el resto en partes iguales,
            así quedan alineadas entre filas sin anchos fijos que no entren */}
        <div className="min-w-0 flex-1 text-right">
          <p className={`tnum text-[13px] whitespace-nowrap ${toneText[dayTone]}`}>
            {formatPct(position.dayPct)}
          </p>
        </div>

        <div className="min-w-0 flex-1 text-right">
          <p className={`tnum text-[13px] whitespace-nowrap ${toneText[gainTone]}`}>
            {formatPct(position.gainPct)}
          </p>
        </div>

        {/* Más ancha que las otras dos: "$ 1.616.005" ocupa bastante más que
            un porcentaje y si no, se parte en dos líneas */}
        <div className="min-w-0 flex-[1.4] text-right">
          <p className="tnum text-primary text-[13px] font-semibold whitespace-nowrap">
            {format(position.value)}
          </p>
          <p className="text-muted mt-0.5 text-[11px]">
            {position.weight.toFixed(1)}%
            {showPremium && (
              // Prima positiva = el CEDEAR está caro en pesos contra el MEP,
              // o sea comprarlo en ARS es pagar de más. Negativa = descuento.
              <span
                className={premium > 0 ? 'text-warning' : 'text-gain'}
                // Tooltip nativo: en desktop alcanza para desambiguar el "TC".
                // En mobile no hay hover, y para eso está la fila explicada del
                // detalle del activo, que es adonde se entra a mirar en serio.
                title={
                  premium > 0
                    ? `Comprarlo en pesos sale ${premium.toFixed(1)}% más caro que via dólar MEP`
                    : `Comprarlo en pesos sale ${Math.abs(premium).toFixed(1)}% más barato que via dólar MEP`
                }
              >
                {' · TC '}
                {formatPct(premium)}
              </span>
            )}
          </p>
        </div>
      </button>
    </li>
  )
}
