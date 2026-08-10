import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, EmptyState, SectionTitle } from '@/components/ui/Card'
import { MetricCard } from '@/components/ui/MetricCard'
import { TagPill } from '@/components/ui/Badge'
import { SectorDonut } from '@/components/dashboard/SectorDonut'
import { PortfolioChart } from '@/components/dashboard/PortfolioChart'
import { PositionRow } from '@/components/dashboard/PositionRow'
import { DollarStrip } from '@/components/dashboard/DollarStrip'
import { NextAction } from '@/components/dashboard/NextAction'
import { CashCard } from '@/components/dashboard/CashCard'
import { TypeFilter } from '@/components/dashboard/TypeFilter'
import { useCurrency } from '@/lib/currency'
import { usePrivacy } from '@/lib/privacy'
import { usePortfolio } from '@/hooks/usePortfolio'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import { PullIndicator } from '@/components/ui/PullIndicator'
import { AssetLogo } from '@/components/ui/AssetLogo'
import { IconChevronRight, IconEye, IconEyeOff } from '@/components/ui/Icon'
import { dayChange, sectorBreakdown, sellRanking, totalGain, totalValue, typeBreakdown, worstPosition } from '@/lib/portfolio'
import { formatARS, formatCompactARS, formatPct, formatSignedARS, toneOf, toneText } from '@/lib/format'
import { RESCUE_LABEL } from '@/lib/sectors'
import { isMarketOpenNow, marketWindowLabel } from '@/lib/schedule'
import { invokeFunction } from '@/lib/functions'

/** Cuántas mostrar antes del "ver más" en el ranking de venta */
const TOP_SELL = 5

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
  const { positions, balance, latestRates, snapshots, iolStatus, loading, error, reload } =
    usePortfolio()

  // El pulldown pide un sync REAL a IOL, no una relectura de la base: si solo
  // releyera, el gesto devolvería los mismos números hasta la próxima corrida
  // del cron y parecería roto. Si el sync falla (sin conexión, IOL caído), la
  // relectura igual corre y trae lo último guardado.
  const syncAndReload = useCallback(async () => {
    try {
      await invokeFunction('fetch-portfolio')
    } catch {
      // El error de sync ya queda en iol_status; el gesto no tiene que fallar
    }
    await reload()
  }, [reload])

  const { pull, refreshing, ready } = usePullToRefresh(syncAndReload)
  const [showAllSell, setShowAllSell] = useState(false)
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const { format, currency, setCurrency, canSwitch, mep } = useCurrency()
  const { hidden, toggle: togglePrivacy } = usePrivacy()

  // El total y la variación del día siempre son de la cartera COMPLETA: filtrar
  // no puede hacerte perder de vista cuánto tenés. Lo que se filtra es el donut
  // y la lista, igual que en IOL.
  const derived = useMemo(
    () => ({
      total: totalValue(positions),
      day: dayChange(positions),
      types: typeBreakdown(positions),
      sellOrder: sellRanking(positions),
      worst: worstPosition(positions),
    }),
    [positions],
  )

  const filtered = useMemo(
    () => (typeFilter ? positions.filter((p) => p.asset_type === typeFilter) : positions),
    [positions, typeFilter],
  )

  const filteredView = useMemo(
    () => ({
      total: totalValue(filtered),
      gain: totalGain(filtered),
      sectors: sectorBreakdown(filtered),
    }),
    [filtered],
  )

  const advisable = derived.sellOrder.filter((p) => p.advisable)
  const notAdvisable = derived.sellOrder.filter((p) => !p.advisable)

  if (loading) return <DashboardSkeleton />

  if (!positions.length) {
    return (
      <div className="animate-fade-up space-y-4">
        {/* El texto que había acá hablaba de secrets y de correr una Edge
            Function: instrucciones para quien programó la app, no para quien la
            usa. Y no llevaba a ningún lado — había que ir a buscar Configuración
            a mano. */}
        <EmptyState
          icon="🔌"
          title={
            iolStatus?.last_sync_error
              ? 'Hay que reconectar tu cuenta'
              : iolStatus?.is_connected
                ? 'Estamos trayendo tus datos'
                : 'Conectá tu cuenta de IOL'
          }
          description={
            iolStatus?.last_sync_error
              ? 'IOL dejó de aceptar la sesión, así que no podemos traer tus datos. Se arregla volviendo a poner tu usuario y contraseña.'
              : iolStatus?.is_connected
                ? 'Tu cuenta ya está conectada. La primera sincronización puede tardar unos minutos; después se actualiza sola.'
                : 'Con tu usuario y contraseña de IOL traemos tu cartera, tus precios y tus movimientos. Se guardan cifrados y solo los usa esta app.'
          }
          action={
            iolStatus?.is_connected && !iolStatus?.last_sync_error
              ? undefined
              : { label: 'Conectar mi cuenta', to: '/config' }
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
  const accumulatedGain = balance?.total_gain_loss ?? positions.reduce((s, p) => s + p.gain, 0)

  return (
    /**
     * Una sola columna en celular, dos en escritorio.
     *
     * Los envoltorios de columna usan `contents` por debajo de `lg`, así que
     * desaparecen del layout y sus hijos quedan como hermanos directos: en el
     * celular el orden es exactamente el del DOM y no cambia nada respecto de
     * antes. En `lg` los envoltorios vuelven a ser cajas y forman las columnas.
     *
     * La alternativa —dos árboles distintos, uno oculto por breakpoint—
     * montaría cada componente dos veces y duplicaría las consultas.
     */
    <div className="animate-fade-up flex flex-col gap-4 lg:grid lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start lg:gap-6">
      <div className="lg:col-span-2">
        <PullIndicator pull={pull} refreshing={refreshing} ready={ready} />
      </div>

      {error && (
        <p className="border-line bg-surface text-warning rounded-xl border px-4 py-2.5 text-[12px] lg:col-span-2">
          {error}
        </p>
      )}

      {/* ── Columna izquierda: el resumen y lo accionable ──────────────
          NO va sticky. Lo probé y estaba mal: esta columna es más alta que la
          pantalla, y un elemento sticky más alto que el viewport se traba —
          nunca llegás a ver su parte de abajo por más que scrollees. Que
          scrollee normal es peor para "no perder de vista el total" y mucho
          mejor para poder leerla entera. */}
      <div className="contents lg:block lg:space-y-4">

      {/* Total de cartera — el número grande manda, todo lo demás lo acompaña */}
      <Card className="py-7 text-center">
        <div className="flex items-center justify-center gap-2">
          <p className="text-secondary text-[13px]">Total en tu cartera</p>
          {/* Oculta TODOS los montos de la app, no solo este.
              Con ícono SVG y no emoji: el emoji quedaba invisible —
              se pinta con su propio color, ignora `text-muted`, y a 15px
              en una tarjeta clara no se distinguía del fondo. */}
          <button
            type="button"
            onClick={togglePrivacy}
            aria-label={hidden ? 'Mostrar montos' : 'Ocultar montos'}
            aria-pressed={hidden}
            className="border-line bg-elevated text-secondary active:bg-hover flex h-6 w-6 items-center justify-center rounded-full border transition-colors"
          >
            {hidden ? (
              <IconEyeOff width={13} height={13} />
            ) : (
              <IconEye width={13} height={13} />
            )}
          </button>
          {canSwitch && (
            <button
              type="button"
              onClick={() => setCurrency(currency === 'ARS' ? 'USD' : 'ARS')}
              className="border-line bg-elevated text-secondary rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
            >
              {currency === 'ARS' ? 'ARS' : 'MEP'}
            </button>
          )}
        </div>
        <p className="font-display tnum text-primary mt-2 text-[38px] leading-none font-bold">
          {format(derived.total)}
        </p>
        <p className={`tnum mt-2.5 text-[14px] font-medium ${toneText[dayTone]}`}>
          {format(derived.day.amount)} · {formatPct(derived.day.pct)} hoy
        </p>

        {/* IOL convierte cada CEDEAR con su MEP implícito, nosotros con el MEP
            de mercado. Los números difieren ~1%, así que se aclara de dónde
            sale en vez de dejar que parezca un error. */}
        {currency === 'USD' && mep && (
          <p className="text-muted mt-2 text-[11px]">
            al MEP de mercado ({formatARS(mep)}) · IOL usa el implícito de cada activo
          </p>
        )}
      </Card>

      {/* Lo que conviene hacer, antes que cualquier métrica */}
      <NextAction />

      {/* Métricas rápidas */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          label="Ganancia"
          value={formatSignedARS(accumulatedGain)}
          subLabel="total acumulada"
          tone={accumulatedGain}
        />
        <MetricCard
          label="Peor posición"
          value={derived.worst ? formatSignedARS(derived.worst.gain) : '—'}
          subLabel={derived.worst?.symbol ?? 'ninguna en rojo'}
          tone={derived.worst ? derived.worst.gain : 'neutral'}
        />
      </div>
      <CashCard balance={balance} />

      {/* Metas: apartar parte de lo que ya tenés para un objetivo */}
      <button
        type="button"
        onClick={() => navigate('/metas')}
        className="card flex w-full items-center gap-3 px-5 py-4 text-left"
      >
        <span className="text-[20px]" aria-hidden>
          🎯
        </span>
        <span className="flex-1">
          <span className="text-primary block text-[14px] font-semibold">Metas de ahorro</span>
          <span className="text-muted block text-[12px]">
            Apartá parte de tu cartera para un objetivo
          </span>
        </span>
        <IconChevronRight className="text-muted shrink-0" />
      </button>

      </div>

      {/* ── Columna derecha: los datos ─────────────────────────────── */}
      <div className="contents lg:block lg:space-y-4">

      {/* Evolución de la cartera */}
      <div>
        <SectionTitle icon="📉">Evolución</SectionTitle>
        <Card>
          <PortfolioChart snapshots={snapshots} />
        </Card>
      </div>

      {/* Composición. El filtro afecta al donut y a la lista, nunca al total
          de arriba: filtrar no puede hacerte perder de vista lo que tenés. */}
      <div>
        <SectionTitle icon="🧩">Composición</SectionTitle>

        <TypeFilter
          types={derived.types}
          active={typeFilter}
          onChange={setTypeFilter}
          total={derived.total}
        />

        <Card className="mt-3">
          <div className="mb-3 text-center">
            <p className="text-secondary text-[12px]">
              {typeFilter
                ? (derived.types.find((t) => t.type === typeFilter)?.label ?? typeFilter)
                : 'Total tenencias'}
            </p>
            <p className="font-display tnum text-primary mt-1 text-[22px] leading-none font-bold">
              {format(filteredView.total)}
            </p>
            <p className={`tnum mt-1.5 text-[12px] ${toneText[toneOf(filteredView.gain.amount)]}`}>
              {format(filteredView.gain.amount)} · {formatPct(filteredView.gain.pct)}
            </p>
          </div>
          <SectorDonut slices={filteredView.sectors} />
        </Card>
      </div>

      {/* Posiciones — mismas columnas que la app de IOL. Respeta el filtro. */}
      <div>
        <SectionTitle icon="📈">
          {typeFilter
            ? (derived.types.find((t) => t.type === typeFilter)?.label ?? 'Posiciones')
            : 'Posiciones'}
        </SectionTitle>
        <Card className="p-0">
          {/* Mismos anchos y proporciones que PositionRow, para que cada
              título caiga sobre su columna */}
          <div className="text-muted border-subtle flex items-center gap-2 border-b px-4 py-2.5 text-[11px]">
            <span className="w-12 shrink-0 text-center">Activo</span>
            <span className="min-w-0 flex-1 text-right">Día</span>
            <span className="min-w-0 flex-1 text-right">Rend.</span>
            <span className="min-w-0 flex-[1.4] text-right">Valorizado</span>
          </div>
          <ul>
            {filtered.map((p) => (
              <PositionRow key={p.id} position={p} />
            ))}
          </ul>
        </Card>
      </div>

      {/* Qué conviene vender */}
      <div>
        <SectionTitle icon="💰">Si necesitás efectivo</SectionTitle>
        <Card className="p-0">
          <ul>
            {advisable.slice(0, showAllSell ? undefined : TOP_SELL).map((p, i) => (
              <li key={p.id} className="border-subtle border-b px-5 py-3.5 last:border-b-0">
                <div className="flex items-center gap-3">
                  <span className="text-muted w-3 text-[12px]">{i + 1}</span>
                  <AssetLogo symbol={p.symbol} sector={p.sector} size="sm" />
                  <span className="text-primary flex-1 text-[14px] font-semibold">{p.symbol}</span>
                  <span className="tnum text-primary text-[13px] font-semibold">
                    {formatCompactARS(p.value)}
                  </span>
                  <span
                    className={`w-16 text-right text-[11px] ${
                      p.rescue_time === 'T+0' ? 'text-gain' : 'text-warning'
                    }`}
                  >
                    {RESCUE_LABEL[p.rescue_time ?? ''] ?? '—'}
                  </span>
                </div>
                <p className="text-muted mt-1.5 pl-[52px] text-[12px]">{p.reason}</p>
              </li>
            ))}
          </ul>

          {advisable.length > TOP_SELL && (
            <button
              type="button"
              onClick={() => setShowAllSell((v) => !v)}
              className="text-accent border-subtle w-full border-t py-3 text-[13px] font-medium"
            >
              {showAllSell
                ? 'Ver menos'
                : `Ver las ${advisable.length - TOP_SELL} restantes`}
            </button>
          )}
        </Card>

        {/* Lo que NO conviene vender se muestra igual, pero separado y con el
            motivo: esconderlo llevaría a venderlo por descarte */}
        {notAdvisable.length > 0 && (
          <details className="card mt-3 px-5 py-3.5">
            <summary className="text-secondary cursor-pointer text-[13px]">
              No conviene vender ({notAdvisable.length})
            </summary>
            <ul className="mt-3 space-y-2.5">
              {notAdvisable.map((p) => (
                <li key={p.id} className="flex items-center gap-2.5">
                  <AssetLogo symbol={p.symbol} sector={p.sector} size="sm" />
                  <span className="text-primary text-[13px] font-semibold">{p.symbol}</span>
                  <span className="text-loss text-[12px]">{p.reason}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
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

      </div>

      {/* Cuándo se actualiza, siempre visible. Sin esto, un "último sync
          17:03" a la noche parece un error, cuando en realidad el mercado
          cerró y no hay nada nuevo que traer. */}
      <p className="text-muted pt-1 text-center text-[11px] lg:col-span-2">
        {iolStatus?.last_sync_at && (
          <>
            Actualizado{' '}
            {new Date(iolStatus.last_sync_at).toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit',
            })}
            {' · '}
          </>
        )}
        {isMarketOpenNow()
          ? `se actualiza cada 5 minutos hasta las ${marketWindowLabel().split(' a ')[1]}`
          : `se actualiza cada 5 minutos de ${marketWindowLabel()}, lunes a viernes`}
      </p>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="card h-[104px] animate-pulse" />
      <div className="grid grid-cols-2 gap-3">
        <div className="card h-[92px] animate-pulse" />
        <div className="card h-[92px] animate-pulse" />
      </div>
      <div className="card h-[240px] animate-pulse" />
    </div>
  )
}
