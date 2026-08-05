import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, EmptyState, SectionTitle } from '@/components/ui/Card'
import { MetricCard } from '@/components/ui/MetricCard'
import { TagPill } from '@/components/ui/Badge'
import { SectorDonut } from '@/components/dashboard/SectorDonut'
import { PortfolioChart } from '@/components/dashboard/PortfolioChart'
import { PositionRow } from '@/components/dashboard/PositionRow'
import { DollarStrip } from '@/components/dashboard/DollarStrip'
import { usePortfolio } from '@/hooks/usePortfolio'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import { PullIndicator } from '@/components/ui/PullIndicator'
import { dayChange, sectorBreakdown, sellRanking, totalValue, worstPosition } from '@/lib/portfolio'
import { formatARS, formatCompactARS, formatPct, formatSignedARS, toneOf, toneText } from '@/lib/format'
import { RESCUE_LABEL } from '@/lib/sectors'

/** Los slugs coinciden con world_topics.slug — el tap abre el feed ya filtrado */
const topics = [
  { emoji: '🤖', label: 'IA y Semis', slug: 'ia-semiconductores' },
  { emoji: '🏦', label: 'Fed y Tasas', slug: 'fed-tasas' },
  { emoji: '🛢️', label: 'Petróleo', slug: 'petroleo-geopolitica' },
  { emoji: '💵', label: 'Dólar AR', slug: 'dolar-argentina' },
  { emoji: '📊', label: 'Earnings', slug: 'earnings-season' },
  { emoji: '🇨🇳', label: 'China', slug: 'china-trade' },
]

export function Dashboard() {
  const navigate = useNavigate()
  const { positions, balance, latestRates, historyBySymbol, snapshots, iolStatus, loading, error, reload } =
    usePortfolio()

  const { pull, refreshing, ready } = usePullToRefresh(reload)

  const derived = useMemo(
    () => ({
      total: totalValue(positions),
      day: dayChange(positions),
      sectors: sectorBreakdown(positions),
      sellOrder: sellRanking(positions),
      worst: worstPosition(positions),
    }),
    [positions],
  )

  if (loading) return <DashboardSkeleton />

  if (!positions.length) {
    return (
      <div className="animate-fade-up space-y-4">
        <EmptyState
          icon="🔌"
          title={iolStatus?.is_connected ? 'Todavía no sincronizó' : 'Conectá tu cuenta de IOL'}
          description={
            iolStatus?.last_sync_error
              ? `Último error: ${iolStatus.last_sync_error}`
              : 'Cargá los secrets IOL_USERNAME / IOL_PASSWORD en Supabase y corré la Edge Function fetch-portfolio. El dashboard se llena solo.'
          }
        />
        {latestRates.size > 0 && (
          <div>
            <SectionTitle icon="💱">Dólar</SectionTitle>
            <Card>
              <DollarStrip rates={latestRates} />
            </Card>
          </div>
        )}
      </div>
    )
  }

  const dayTone = toneOf(derived.day.amount)
  const totalGain = balance?.total_gain_loss ?? positions.reduce((s, p) => s + p.gain, 0)

  return (
    <div className="animate-fade-up space-y-4">
      <PullIndicator pull={pull} refreshing={refreshing} ready={ready} />

      {error && (
        <p className="border-line bg-surface text-warning rounded-xl border px-4 py-2.5 text-[12px]">
          {error}
        </p>
      )}

      {/* Total de cartera */}
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-muted font-mono text-[11px] tracking-[0.1em] uppercase">
              Total cartera
            </p>
            <p className="font-display tnum text-primary mt-1.5 text-[32px] leading-none font-bold">
              {formatARS(derived.total)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-muted font-mono text-[11px] tracking-[0.1em] uppercase">Hoy</p>
            <p className={`font-display tnum mt-1.5 text-[19px] leading-none font-bold ${toneText[dayTone]}`}>
              {formatSignedARS(derived.day.amount)}
            </p>
            <p className={`tnum mt-1 font-mono text-[12px] ${toneText[dayTone]}`}>
              {formatPct(derived.day.pct)}
            </p>
          </div>
        </div>
      </Card>

      {/* Métricas rápidas */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          label="Ganancia"
          value={formatSignedARS(totalGain)}
          subLabel="total acumulada"
          tone={totalGain}
        />
        <MetricCard
          label="Peor posición"
          value={derived.worst ? formatSignedARS(derived.worst.gain) : '—'}
          subLabel={derived.worst?.symbol ?? 'ninguna en rojo'}
          tone={derived.worst ? derived.worst.gain : 'neutral'}
        />
      </div>
      <MetricCard
        label="Cash disponible"
        value={formatARS(balance?.available_ars ?? 0, true)}
        subLabel={balance?.committed_ars ? `${formatARS(balance.committed_ars)} comprometido` : 'sin rendir'}
      />

      {/* Evolución de la cartera */}
      <div>
        <SectionTitle icon="📉">Evolución</SectionTitle>
        <Card>
          <PortfolioChart snapshots={snapshots} />
        </Card>
      </div>

      {/* Composición por sector */}
      <div>
        <SectionTitle icon="🧩">Composición por sector</SectionTitle>
        <Card>
          <SectorDonut slices={derived.sectors} />
        </Card>
      </div>

      {/* Qué conviene vender */}
      <div>
        <SectionTitle icon="💰">Si necesitás efectivo</SectionTitle>
        <Card className="p-0">
          <ul>
            {derived.sellOrder.filter((p) => p.advisable).map((p, i) => (
              <li
                key={p.id}
                className="border-subtle border-b px-4 py-3 last:border-b-0"
              >
                <div className="flex items-center gap-3">
                  <span className="text-muted w-3 font-mono text-[12px]">{i + 1}</span>
                  <span className="flex-1 font-mono text-[13px] font-semibold">{p.symbol}</span>
                  <span className="tnum text-secondary font-mono text-[12px]">
                    {formatCompactARS(p.value)}
                  </span>
                  <span
                    className={`w-20 text-right font-mono text-[11px] ${
                      p.rescue_time === 'T+0' ? 'text-gain' : 'text-warning'
                    }`}
                  >
                    {p.rescue_time} · {RESCUE_LABEL[p.rescue_time ?? ''] ?? '—'}
                  </span>
                </div>
                <p className="text-muted mt-1 pl-6 text-[11px]">{p.reason}</p>
              </li>
            ))}
          </ul>
        </Card>

        {/* Lo que NO conviene vender se muestra igual, pero separado y con el
            motivo: esconderlo llevaría a venderlo por descarte */}
        {derived.sellOrder.some((p) => !p.advisable) && (
          <details className="border-subtle bg-surface mt-3 rounded-2xl border px-4 py-3">
            <summary className="text-secondary cursor-pointer text-[12px]">
              No conviene vender ({derived.sellOrder.filter((p) => !p.advisable).length})
            </summary>
            <ul className="mt-2 space-y-2">
              {derived.sellOrder
                .filter((p) => !p.advisable)
                .map((p) => (
                  <li key={p.id} className="flex items-baseline gap-2">
                    <span className="text-muted font-mono text-[12px]">{p.symbol}</span>
                    <span className="text-loss text-[11px]">{p.reason}</span>
                  </li>
                ))}
            </ul>
          </details>
        )}
      </div>

      {/* Posiciones */}
      <div>
        <SectionTitle icon="📈">Posiciones</SectionTitle>
        <Card className="p-0">
          <div className="text-muted border-subtle grid grid-cols-[1fr_auto_auto] gap-3 border-b px-4 py-2.5 font-mono text-[10px] tracking-wider uppercase">
            <span>Activo</span>
            <span className="w-16 text-center">30 días</span>
            <span className="w-[68px] text-right">Día · P/L</span>
          </div>
          <ul>
            {positions.map((p) => (
              <PositionRow
                key={p.id}
                position={p}
                history={historyBySymbol.get(p.symbol) ?? []}
              />
            ))}
          </ul>
        </Card>
      </div>

      {/* Temáticas mundiales */}
      <div>
        <SectionTitle icon="🌍">Temáticas mundiales</SectionTitle>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {topics.map((t) => (
            <TagPill
              key={t.slug}
              emoji={t.emoji}
              label={t.label}
              onClick={() => navigate(`/noticias?tag=${t.slug}`)}
            />
          ))}
        </div>
      </div>

      {/* Dólar */}
      <div>
        <SectionTitle icon="💱">Dólar</SectionTitle>
        <Card>
          <DollarStrip rates={latestRates} />
        </Card>
      </div>

      {iolStatus?.last_sync_at && (
        <p className="text-muted pt-1 text-center font-mono text-[10px] tracking-wide uppercase">
          Último sync{' '}
          {new Date(iolStatus.last_sync_at).toLocaleTimeString('es-AR', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      )}
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="bg-surface border-subtle h-[104px] animate-pulse rounded-2xl border" />
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-surface border-subtle h-[92px] animate-pulse rounded-2xl border" />
        <div className="bg-surface border-subtle h-[92px] animate-pulse rounded-2xl border" />
      </div>
      <div className="bg-surface border-subtle h-[240px] animate-pulse rounded-2xl border" />
    </div>
  )
}
