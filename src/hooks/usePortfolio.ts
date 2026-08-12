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

type Snapshot = { snapshot_date: string; total_value: number }

type PortfolioData = {
  positions: Position[]
  balance: AccountBalance | null
  rates: DollarRate[]
  history: PricePoint[]
  snapshots: Snapshot[]
  iolStatus: IolStatus | null
}

const EMPTY: PortfolioData = {
  positions: [],
  balance: null,
  rates: [],
  history: [],
  snapshots: [],
  iolStatus: null,
}

type PortfolioState = {
  positions: ReturnType<typeof withMetrics>
  balance: AccountBalance | null
  latestRates: Map<string, DollarRate>
  historyBySymbol: Map<string, number[]>
  snapshots: Snapshot[]
  iolStatus: IolStatus | null
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

    const [positions, balance, rates, history, snapshots, iolStatus] = await Promise.all([
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

  const positions = useMemo(() => withMetrics(data.positions), [data.positions])

  /** Última cotización por tipo de dólar */
  const latestRates = useMemo(() => {
    const map = new Map<string, DollarRate>()
    for (const r of data.rates) if (!map.has(r.rate_type)) map.set(r.rate_type, r)
    return map
  }, [data.rates])

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

  const value = useMemo<PortfolioState>(
    () => ({
      positions,
      balance: data.balance,
      latestRates,
      historyBySymbol,
      snapshots: data.snapshots,
      iolStatus: data.iolStatus,
      loading,
      error,
      reload: load,
    }),
    [positions, data.balance, latestRates, historyBySymbol, data.snapshots, data.iolStatus, loading, error, load],
  )

  return createElement(PortfolioContext.Provider, { value }, children)
}

export function usePortfolio(): PortfolioState {
  const ctx = useContext(PortfolioContext)
  if (!ctx) throw new Error('usePortfolio debe usarse dentro de <PortfolioProvider>')
  return ctx
}
