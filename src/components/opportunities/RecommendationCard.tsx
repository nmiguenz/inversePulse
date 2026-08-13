import { useState } from 'react'
import type { Recommendation } from '@/lib/types'
import { formatARS, formatRelativeTime } from '@/lib/format'
import { AssetLogo } from '@/components/ui/AssetLogo'
import { resolveRecommendation } from '@/lib/recommendationActions'

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

export function RecommendationCard({
  rec,
  onResolved,
}: {
  rec: Recommendation
  /** Sin esto la tarjeta es de solo lectura: así se usa en el historial. */
  onResolved?: (id: string, how: 'fulfilled' | 'dismissed') => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState<'fulfilled' | 'dismissed' | null>(null)
  const [error, setError] = useState('')
  const action = ACTION[rec.action] ?? ACTION.hold

  async function resolve(how: 'fulfilled' | 'dismissed') {
    setBusy(how)
    setError('')
    try {
      await resolveRecommendation(rec.id, how)
      onResolved?.(rec.id, how)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar')
      setBusy(null)
    }
  }

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

      {/* Una rotación se muestra con las dos patas separadas. "Rebalancear GLD
          desde AMD" con un monto suelto no dice qué hacer: hay que leer de
          dónde sale y hacia dónde va, cada uno con su monto. */}
      {rec.counterpart_symbol && rec.suggested_amount != null ? (
        <div className="border-subtle mt-3 border-t pt-3">
          <div className="flex items-stretch gap-2">
            <Leg
              label="Vendé de"
              symbol={rec.counterpart_symbol}
              amount={rec.suggested_amount}
              tone="text-loss"
            />
            <span className="text-muted self-center text-[16px]" aria-hidden>
              →
            </span>
            <Leg
              label="Y comprá"
              symbol={rec.symbol}
              amount={rec.suggested_amount}
              quantity={rec.suggested_quantity}
              tone="text-gain"
            />
          </div>
          <p className="text-muted mt-2 text-[11px] leading-relaxed">
            El monto es el mismo en las dos puntas: la plata sale de un activo y entra al otro,
            sin sumar ni retirar capital.
          </p>
        </div>
      ) : (
        rec.suggested_amount != null && (
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
        )
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

      {/* Cerrarla a mano.
          Si la ejecutás en IOL desaparece sola cuando entra la operación, pero
          eso solo funciona en el caso feliz: mismo símbolo y al menos el 80%
          del monto. Una compra parcial, una decisión de no hacerlo o un "no
          hacer nada" se quedaban acá hasta la próxima corrida del asesor. */}
      {onResolved && (
        <>
          <div className="border-subtle mt-3 flex gap-2 border-t pt-3">
            <button
              type="button"
              onClick={() => void resolve('fulfilled')}
              disabled={busy !== null}
              className="border-gain-line text-gain active:bg-hover flex-1 rounded-xl border py-2 text-[12px] font-medium disabled:opacity-50"
            >
              {busy === 'fulfilled' ? 'Guardando…' : 'Ya lo hice'}
            </button>
            <button
              type="button"
              onClick={() => void resolve('dismissed')}
              disabled={busy !== null}
              className="border-line text-muted active:bg-hover rounded-xl border px-4 py-2 text-[12px] disabled:opacity-50"
            >
              {busy === 'dismissed' ? 'Guardando…' : 'No me interesa'}
            </button>
          </div>

          <p className="text-muted mt-2 text-[11px] leading-relaxed">
            Si la ejecutás en IOL desaparece sola en cuanto se sincroniza la operación.
          </p>

          {error && <p className="text-loss mt-2 text-[12px]">{error}</p>}
        </>
      )}
    </li>
  )
}

/** Una punta de la rotación: de dónde sale o hacia dónde va. */
function Leg({
  label,
  symbol,
  amount,
  quantity,
  tone,
}: {
  label: string
  symbol: string
  amount: number
  quantity?: number | null
  tone: string
}) {
  return (
    <div className="bg-elevated min-w-0 flex-1 rounded-xl px-3 py-2.5">
      <p className={`text-[11px] font-medium ${tone}`}>{label}</p>
      <p className="text-primary mt-0.5 flex items-center gap-1.5 text-[14px] font-semibold">
        <AssetLogo symbol={symbol} size="sm" />
        <span className="truncate">{symbol}</span>
      </p>
      <p className="tnum text-secondary mt-1 text-[12px]">{formatARS(amount)}</p>
      {quantity ? (
        <p className="text-muted tnum text-[11px]">
          ≈ {quantity} {quantity === 1 ? 'CEDEAR' : 'CEDEARs'}
        </p>
      ) : null}
    </div>
  )
}
