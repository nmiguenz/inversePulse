import { useNavigate } from 'react-router-dom'
import { AssetLogo } from '@/components/ui/AssetLogo'
import { formatPct, toneOf, toneText } from '@/lib/format'
import type { MarketQuote } from '@/lib/types'

export type Mover = MarketQuote & {
  /** Nombre para mostrar, de asset_metadata */
  display_name?: string | null
  /** Índices a los que pertenece */
  index_membership?: string[] | null
  /** Si ya lo tenés en cartera */
  held?: boolean
}

/**
 * Grilla de activos que se movieron, con logo, símbolo y porcentaje.
 *
 * Dos filas de cuatro en pantallas normales, de tres en las más angostas. Se
 * muestran hasta 8: más que eso deja de ser "los que más se movieron" y pasa a
 * ser una lista.
 */
export function MoverPanel({
  title,
  subtitle,
  movers,
  metric,
  emptyHint,
}: {
  title: string
  subtitle?: string
  movers: Mover[]
  metric: 'day' | 'week'
  emptyHint: string
}) {
  const navigate = useNavigate()

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-primary text-[14px] font-semibold">{title}</h2>
        {subtitle && <span className="text-muted text-[11px]">{subtitle}</span>}
      </div>

      <div className="card p-3">
        {movers.length === 0 ? (
          // Nunca un panel vacío sin explicación: si no hay datos hay que
          // decir por qué, no mostrar una grilla en blanco
          <p className="text-muted px-2 py-4 text-center text-[12px] leading-relaxed">
            {emptyHint}
          </p>
        ) : (
          <ul className="grid grid-cols-3 gap-1 min-[380px]:grid-cols-4">
            {movers.slice(0, 8).map((m) => {
              const pct = metric === 'day' ? m.daily_change_pct : m.week_change_pct
              return (
                <li key={m.symbol}>
                  <button
                    type="button"
                    onClick={() => navigate(`/activo/${m.symbol}`)}
                    className="active:bg-hover flex w-full flex-col items-center gap-1 rounded-xl px-1 py-2.5 transition-colors"
                  >
                    <div className="relative">
                      <AssetLogo symbol={m.symbol} />
                      {/* El punto marca que ya lo tenés: cambia por completo
                          qué significa la sugerencia */}
                      {m.held && (
                        <span
                          className="bg-accent border-base absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2"
                          aria-label="en tu cartera"
                        />
                      )}
                    </div>
                    <span className="text-primary max-w-full truncate text-[10px] font-semibold">
                      {m.symbol}
                    </span>
                    <span className={`tnum text-[11px] font-medium ${toneText[toneOf(pct ?? 0)]}`}>
                      {pct == null ? '—' : formatPct(pct, 1)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
