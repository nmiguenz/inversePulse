import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import type { AccountBalance, DollarRate, IolStatus, Position, PricePoint } from '@/lib/types'
import { withMetrics } from '@/lib/portfolio'
import { useAutoRefresh } from '@/hooks/useAutoRefresh'

type Snapshot = { snapshot_date: string; total_value: number }
type ImpliedFxQuote = { symbol: string; implied_fx: number | null }

type PortfolioData = {
  positions: Position[]
  balance: AccountBalance | null
  rates: DollarRate[]
  history: PricePoint[]
  snapshots: Snapshot[]
  iolStatus: IolStatus | null
  quotes: ImpliedFxQuote[]
}

const EMPTY: PortfolioData = {
  positions: [],
  balance: null,
  rates: [],
  history: [],
  snapshots: [],
  iolStatus: null,
  quotes: [],
}

type PortfolioState = {
  positions: ReturnType<typeof withMetrics>
  balance: AccountBalance | null
  latestRates: Map<string, DollarRate>
  historyBySymbol: Map<string, number[]>
  snapshots: Snapshot[]
  iolStatus: IolStatus | null
  /** Cuándo se escribieron estos números. Ver `lastSyncAt` más abajo. */
  lastSyncAt: string | null
  loading: boolean
  error: string | null
  reload: () => Promise<void>
}

const PortfolioContext = createContext<PortfolioState | null>(null)

/** Últimos 30 días de cierres, para los sparklines */
function since(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

/**
 * Provider único de la cartera.
 *
 * Tiene que ser un provider y no un hook suelto: lo consumen el Dashboard,
 * Config, la pantalla de noticias y el gestor de earnings. Con un hook, cada
 * pantalla abría su propio canal de realtime con el MISMO topic
 * (`portfolio:<user>`), y supabase-js reusa el canal por nombre — la segunda
 * suscripción falla con "cannot add postgres_changes callbacks after
 * subscribe()". Es el mismo problema que ya había aparecido en useAlerts.
 */
export function PortfolioProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const userId = session?.user.id
  const [data, setData] = useState<PortfolioData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !userId) {
      setLoading(false)
      return
    }

    const [positions, balance, rates, history, snapshots, iolStatus, quotes] = await Promise.all([
      supabase.from('positions').select('*').eq('user_id', userId),
      supabase.from('account_balance').select('*').eq('user_id', userId).maybeSingle(),
      // Una fila por tipo: se ordena por fecha y se deduplica abajo
      supabase.from('dollar_rates').select('*').gte('recorded_at', since(2)).order('recorded_at', { ascending: false }),
      supabase.from('price_history').select('symbol, close_price, recorded_at').gte('recorded_at', since(30)).order('recorded_at'),
      supabase
        .from('portfolio_snapshots')
        .select('snapshot_date, total_value, daily_pnl')
        .eq('user_id', userId)
        .gte('snapshot_date', since(90))
        .order('snapshot_date'),
      supabase.from('iol_status').select('*').maybeSingle(),
      // Dólar implícito por CEDEAR. Tabla global (no lleva user_id): el
      // implícito de NVDA es el mismo para todos.
      supabase.from('market_quotes').select('symbol, implied_fx'),
    ])

    const firstError = [positions, balance, rates, history].find((r) => r.error)?.error
    setError(firstError?.message ?? null)

    setData({
      positions: (positions.data ?? []) as Position[],
      balance: (balance.data ?? null) as AccountBalance | null,
      rates: (rates.data ?? []) as DollarRate[],
      history: (history.data ?? []) as PricePoint[],
      snapshots: (snapshots.data ?? []) as Snapshot[],
      iolStatus: (iolStatus.data ?? null) as IolStatus | null,
      quotes: (quotes.data ?? []) as ImpliedFxQuote[],
    })
    setLoading(false)
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  // Realtime: el CRON escribe cada 5 min y el dashboard se actualiza solo
  useEffect(() => {
    if (!isSupabaseConfigured || !userId) return

    const channel = supabase
      .channel(`portfolio:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'positions', filter: `user_id=eq.${userId}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'account_balance', filter: `user_id=eq.${userId}` }, () => void load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dollar_rates' }, () => void load())
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [userId, load])

  // Red de seguridad: si el websocket se durmió (PWA en segundo plano) o algún
  // evento se perdió, el dashboard igual se pone al día solo.
  useAutoRefresh(load, isSupabaseConfigured && Boolean(userId))

  /** Última cotización por tipo de dólar */
  const latestRates = useMemo(() => {
    const map = new Map<string, DollarRate>()
    for (const r of data.rates) if (!map.has(r.rate_type)) map.set(r.rate_type, r)
    return map
  }, [data.rates])

  // Va después de latestRates porque necesita el MEP para la prima: sin MEP de
  // mercado el implícito es un número suelto que no dice si está caro o barato.
  const positions = useMemo(() => {
    const bySymbol = new Map<string, number>()
    for (const q of data.quotes) if (q.implied_fx) bySymbol.set(q.symbol, q.implied_fx)
    const mep = latestRates.get('mep')?.sell_price ?? 0
    return withMetrics(data.positions, { bySymbol, mep })
  }, [data.positions, data.quotes, latestRates])

  /** Serie de cierres por símbolo, ordenada por fecha */
  const historyBySymbol = useMemo(() => {
    const map = new Map<string, number[]>()
    for (const p of data.history) {
      const list = map.get(p.symbol) ?? []
      list.push(p.close_price)
      map.set(p.symbol, list)
    }
    return map
  }, [data.history])

  /**
   * Cuándo se actualizaron los números que estás viendo.
   *
   * Sale de `positions.updated_at` y NO de `iol_status.last_sync_at`, aunque ese
   * campo parezca el indicado. Dos razones, y la segunda es un bug real:
   *
   * - `last_sync_at` se escribe al FINAL de `syncUser`, ~1,3s después del upsert
   *   de posiciones. El evento de realtime llega con el upsert, así que la
   *   relectura que dispara lee la marca de la corrida ANTERIOR: el sello
   *   quedaba siempre un ciclo atrás. Con el cron corriendo puntual cada 5
   *   minutos, a las 14:47 la app decía "Actualizado 14:40" y parecía roto.
   * - `iol_status` es una vista: no emite eventos, así que ese valor viejo no se
   *   corregía hasta la próxima escritura de otra tabla.
   *
   * `updated_at` viaja en el mismo payload que los precios, o sea que el sello y
   * los números que describe son siempre de la misma corrida. Y si un sync falla
   * no avanza — que es lo correcto: el dato sigue siendo el de antes. El error
   * en sí se sigue mostrando aparte, desde `last_sync_error`.
   */
  const lastSyncAt = useMemo(() => {
    let latest: string | null = null
    let latestMs = -Infinity
    for (const p of data.positions) {
      // Por timestamp y no por orden alfabético: el offset de la fecha que
      // devuelve PostgREST hoy es siempre +00:00, pero comparar strings deja el
      // resultado atado a ese detalle.
      const ms = Date.parse(p.updated_at)
      if (Number.isFinite(ms) && ms > latestMs) {
        latestMs = ms
        latest = p.updated_at
      }
    }
    // Sin posiciones (cuenta recién conectada, cartera vacía) no hay de dónde
    // sacarlo y la marca del sync es lo único que hay.
    return latest ?? data.iolStatus?.last_sync_at ?? null
  }, [data.positions, data.iolStatus])

  const value = useMemo<PortfolioState>(
    () => ({
      positions,
      balance: data.balance,
      latestRates,
      historyBySymbol,
      snapshots: data.snapshots,
      iolStatus: data.iolStatus,
      lastSyncAt,
      loading,
      error,
      reload: load,
    }),
    [positions, data.balance, latestRates, historyBySymbol, data.snapshots, data.iolStatus, lastSyncAt, loading, error, load],
  )

  return createElement(PortfolioContext.Provider, { value }, children)
}

export function usePortfolio(): PortfolioState {
  const ctx = useContext(PortfolioContext)
  if (!ctx) throw new Error('usePortfolio debe usarse dentro de <PortfolioProvider>')
  return ctx
}
