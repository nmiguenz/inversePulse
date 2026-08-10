import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Card, EmptyState, SectionTitle } from '@/components/ui/Card'
import { AssetLogo } from '@/components/ui/AssetLogo'
import { Sparkline } from '@/components/dashboard/Sparkline'
import { NewsCard } from '@/components/news/NewsCard'
import { usePortfolio } from '@/hooks/usePortfolio'
import { useCurrency } from '@/lib/currency'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { formatARS, formatPct, formatSignedARS, toneOf, toneText } from '@/lib/format'
import { RESCUE_LABEL, sectorColor } from '@/lib/sectors'
import type { NewsItem } from '@/lib/types'

export function AssetDetail() {
  const { symbol = '' } = useParams()
  const navigate = useNavigate()
  const { session } = useAuth()
  const { positions, historyBySymbol, loading } = usePortfolio()
  const { format, currency } = useCurrency()
  const [news, setNews] = useState<NewsItem[]>([])

  const position = useMemo(
    () => positions.find((p) => p.symbol.toUpperCase() === symbol.toUpperCase()),
    [positions, symbol],
  )

  // Noticias que mencionan este activo — `related_symbols` tiene índice GIN
  const loadNews = useCallback(async () => {
    if (!isSupabaseConfigured || !session || !symbol) return
    const { data } = await supabase
      .from('news')
      .select('*')
      .contains('related_symbols', [symbol.toUpperCase()])
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(5)
    setNews((data ?? []) as NewsItem[])
  }, [session, symbol])

  useEffect(() => {
    void loadNews()
  }, [loadNews])

  if (loading) return <div className="card h-64 animate-pulse" />

  if (!position) {
    return (
      <EmptyState
        icon="🔍"
        title={`No tenés ${symbol}`}
        description="Este activo no está en tu cartera. Si lo compraste recién, puede tardar unos minutos en aparecer."
      />
    )
  }

  const dayTone = toneOf(position.dayPct)
  const gainTone = toneOf(position.gain)
  const history = historyBySymbol.get(position.symbol) ?? []

  const committed = position.committed_quantity ?? 0
  const availableToTrade = position.quantity - committed

  return (
    <div className="animate-fade-up space-y-4">
      {/* Encabezado */}
      <Card className="text-center">
        <div className="flex items-center justify-center gap-3">
          <AssetLogo symbol={position.symbol} sector={position.sector} size="lg" />
          <div className="text-left">
            <p className="text-primary text-[17px] font-semibold">{position.symbol}</p>
            <p className="text-muted text-[12px]">{position.description ?? position.sector}</p>
          </div>
        </div>

        <p className="font-display tnum text-primary mt-4 text-[32px] leading-none font-bold">
          {format(position.value)}
        </p>
        <p className={`tnum mt-2 text-[14px] font-medium ${toneText[gainTone]}`}>
          {currency === 'ARS' ? formatSignedARS(position.gain) : format(position.gain)} ·{' '}
          {formatPct(position.gainPct)}
        </p>
        <p className="text-muted mt-1 text-[12px]">desde que compraste</p>
      </Card>

      {/* Precio y variación del día */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <p className="text-secondary text-[12px]">Último precio</p>
          <p className="font-display tnum text-primary mt-1.5 text-[19px] leading-none font-bold">
            {formatARS(position.current_price)}
          </p>
          <p className={`tnum mt-1.5 text-[12px] ${toneText[dayTone]}`}>
            {formatPct(position.dayPct)} hoy
          </p>
        </Card>
        <Card>
          <p className="text-secondary text-[12px]">Precio promedio de compra</p>
          <p className="font-display tnum text-primary mt-1.5 text-[19px] leading-none font-bold">
            {formatARS(position.avg_buy_price)}
          </p>
          <p className="text-muted mt-1.5 text-[12px]">PPC</p>
        </Card>
      </div>

      {/* Evolución. Cierres diarios, no intradiario: guardamos un cierre por
          día, la curva intradiaria necesitaría otra fuente de datos. */}
      <div>
        <SectionTitle icon="📈">Últimos 30 días</SectionTitle>
        <Card>
          {history.length >= 2 ? (
            <div className="h-24">
              <Sparkline data={history} tone={gainTone} />
            </div>
          ) : (
            <p className="text-muted text-[12px] leading-relaxed">
              Todavía no hay suficiente historial. Se guarda un cierre por día, así que la curva
              se arma con el tiempo.
            </p>
          )}
        </Card>
      </div>

      {/* Tenencias */}
      <div>
        <SectionTitle icon="📦">Detalle de tus tenencias</SectionTitle>
        <Card className="p-0">
          <Row label="Cantidad" value={String(position.quantity)} />
          <Row label="Comprometido" value={String(committed)} muted={committed === 0} />
          <Row
            label="Disponible para operar"
            value={String(availableToTrade)}
            hint={committed > 0 ? 'El resto está reservado por órdenes puestas' : undefined}
          />
          <Row label="Peso en la cartera" value={`${position.weight.toFixed(1)}%`} />
          <Row
            label="Sector"
            value={position.sector}
            dot={sectorColor(position.sector)}
          />
          {position.rescue_time && (
            <Row
              label="Plazo de rescate"
              value={`${position.rescue_time} · ${RESCUE_LABEL[position.rescue_time] ?? ''}`}
            />
          )}
        </Card>
      </div>

      {/* Noticias del activo */}
      {news.length > 0 && (
        <div>
          <SectionTitle icon="📰">Noticias sobre {position.symbol}</SectionTitle>
          <ul className="space-y-3">
            {news.map((item) => (
              <NewsCard
                key={item.id}
                item={item}
                holdings={new Set(positions.map((p) => p.symbol.toUpperCase()))}
              />
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={() => navigate(-1)}
        className="border-line text-secondary active:bg-hover w-full rounded-xl border py-2.5 text-[13px]"
      >
        Volver
      </button>
    </div>
  )
}

function Row({
  label,
  value,
  hint,
  muted,
  dot,
}: {
  label: string
  value: string
  hint?: string
  muted?: boolean
  dot?: string
}) {
  return (
    <div className="border-subtle flex items-center justify-between gap-3 border-b px-5 py-3.5 last:border-b-0">
      <span>
        <span className="text-secondary block text-[13px]">{label}</span>
        {hint && <span className="text-muted mt-0.5 block text-[11px]">{hint}</span>}
      </span>
      <span className="flex items-center gap-2">
        {dot && (
          <span className="h-2 w-2 rounded-full" style={{ background: dot }} aria-hidden />
        )}
        <span className={`tnum text-[14px] font-semibold ${muted ? 'text-muted' : 'text-primary'}`}>
          {value}
        </span>
      </span>
    </div>
  )
}
