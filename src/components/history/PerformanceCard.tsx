import { Card } from '@/components/ui/Card'
import { formatARS, formatPct, toneOf, toneText } from '@/lib/format'
import type { PerformanceReview, PerformanceVerdict } from '@/lib/types'

const VERDICT: Record<PerformanceVerdict, { icon: string; label: string; tone: string }> = {
  ok: { icon: '✅', label: 'Está funcionando', tone: 'text-gain' },
  mixed: { icon: '⚠️', label: 'Resultado mixto', tone: 'text-warning' },
  bad: { icon: '❌', label: 'No está funcionando', tone: 'text-loss' },
  insufficient_data: { icon: '🔍', label: 'Faltan datos', tone: 'text-muted' },
}

function days(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000)
}

/**
 * El veredicto del período.
 *
 * Muestra el número igual cuando el período es corto — es la plata del usuario
 * y la pidió — pero al lado dice cuánto se le puede creer. Un mes son ~20
 * ruedas: la diferencia entre un ✅ y un ❌ puede ser un solo día fuerte de una
 * posición.
 */
export function PerformanceCard({ review }: { review: PerformanceReview }) {
  const v = VERDICT[review.verdict] ?? VERDICT.insufficient_data
  const periodDays = days(review.period_start, review.period_end)
  const short = periodDays < 60

  return (
    <Card>
      <div className="flex items-start gap-3">
        <span className="text-[22px] leading-none" aria-hidden>
          {v.icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-[15px] font-semibold ${v.tone}`}>{v.label}</p>
          <p className="text-muted mt-0.5 text-[11px]">
            {periodDays} días · desde el{' '}
            {new Date(`${review.period_start}T12:00:00`).toLocaleDateString('es-AR', {
              day: '2-digit',
              month: 'short',
            })}
          </p>
        </div>
      </div>

      {review.verdict_reason && (
        <p className="text-secondary mt-3 text-[13px] leading-relaxed">{review.verdict_reason}</p>
      )}

      {/* Las tres cifras que sostienen el veredicto */}
      <div className="border-subtle mt-4 grid grid-cols-3 gap-2 border-t pt-3.5">
        <Metric label="En pesos" value={review.return_pct} />
        <Metric label="En dólares" value={review.return_usd_pct} />
        <Metric label="Sin tocar nada" value={review.hold_return_pct} muted />
      </div>

      {/* Lo que hace creíble al número de arriba: qué se descontó */}
      <div className="border-subtle mt-3 space-y-1.5 border-t pt-3">
        <Row label="Valor al inicio" value={formatARS(review.start_value)} />
        <Row label="Valor hoy" value={formatARS(review.end_value)} />
        {review.deposits > 0 && (
          <Row label="Aportes del período" value={`+ ${formatARS(review.deposits)}`} />
        )}
        {review.withdrawals > 0 && (
          <Row label="Retiros del período" value={`− ${formatARS(review.withdrawals)}`} />
        )}
        {review.dividends > 0 && (
          <Row label="Dividendos cobrados" value={formatARS(review.dividends)} />
        )}
        {review.return_amount != null && (
          <Row
            label="Ganancia neta"
            value={formatARS(review.return_amount)}
            tone={toneText[toneOf(review.return_amount)]}
          />
        )}
      </div>

      <p className="text-muted mt-3 text-[11px] leading-relaxed">
        Los aportes y retiros se descuentan antes de calcular el rendimiento. Sin eso, meter plata
        en la cuenta se vería igual que haberla ganado.
      </p>

      {short && review.verdict !== 'insufficient_data' && (
        <p className="text-muted border-subtle mt-3 border-t pt-3 text-[11px] leading-relaxed">
          <strong className="text-secondary">Cuánto creerle:</strong> {periodDays} días son unas{' '}
          {Math.round(periodDays * 0.7)} ruedas. En una ventana así el resultado lo puede definir un
          solo día fuerte de una posición, para bien o para mal. El dato que sirve es la tendencia a
          3 y 6 meses, que se va armando con cada revisión.
        </p>
      )}

      {review.data_gaps && review.data_gaps.length > 0 && (
        <div className="bg-warning-soft mt-3 rounded-xl px-3.5 py-3">
          <p className="text-primary text-[12px] font-medium">Con estas salvedades</p>
          <ul className="text-secondary mt-1.5 space-y-1 text-[11px] leading-relaxed">
            {review.data_gaps.map((gap, i) => (
              <li key={i}>· {gap}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

function Metric({
  label,
  value,
  muted,
}: {
  label: string
  value: number | null
  muted?: boolean
}) {
  return (
    <div>
      <p className="text-muted text-[11px]">{label}</p>
      <p
        className={`tnum mt-1 text-[16px] font-semibold ${
          value == null ? 'text-muted' : muted ? 'text-secondary' : toneText[toneOf(value)]
        }`}
      >
        {value == null ? '—' : formatPct(value, 1)}
      </p>
    </div>
  )
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-secondary text-[12px]">{label}</span>
      <span className={`tnum text-[12px] font-medium ${tone ?? 'text-primary'}`}>{value}</span>
    </div>
  )
}
