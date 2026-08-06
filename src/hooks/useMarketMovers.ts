import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { usePortfolio } from '@/hooks/usePortfolio'
import type { Mover } from '@/components/opportunities/MoverPanel'
import type { MarketQuote } from '@/lib/types'

/** Cuántas horas puede tener el dato antes de avisar que está viejo */
const STALE_HOURS = 30

/**
 * Los activos que más se movieron, del universo entero y no solo de tu cartera.
 *
 * El ranking lo define el precio, no una opinión: `market_quotes` se llena con
 * las cotizaciones que devuelve IOL.
 */
export function useMarketMovers() {
  const { session } = useAuth()
  const { positions } = usePortfolio()
  const [quotes, setQuotes] = useState<MarketQuote[]>([])
  const [names, setNames] = useState<Map<string, { name: string | null; indices: string[] | null }>>(
    new Map(),
  )
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !session) {
      setLoading(false)
      return
    }

    const [{ data: rows }, { data: meta }] = await Promise.all([
      supabase.from('market_quotes').select('*'),
      supabase.from('asset_metadata').select('symbol, display_name, index_membership'),
    ])

    setQuotes((rows ?? []) as MarketQuote[])
    setNames(
      new Map(
        (meta ?? []).map((m) => [
          m.symbol,
          { name: m.display_name, indices: m.index_membership },
        ]),
      ),
    )
    setLoading(false)
  }, [session])

  useEffect(() => {
    void load()
  }, [load])

  return useMemo(() => {
    const held = new Set(positions.map((p) => p.symbol.toUpperCase()))

    const enrich = (q: MarketQuote): Mover => ({
      ...q,
      display_name: names.get(q.symbol)?.name ?? null,
      index_membership: names.get(q.symbol)?.indices ?? null,
      held: held.has(q.symbol.toUpperCase()),
    })

    const withDay = quotes.filter((q) => q.daily_change_pct != null).map(enrich)
    const withWeek = quotes.filter((q) => q.week_change_pct != null).map(enrich)

    // Cuántos tienen dato semanal: si son pocos, el panel lo dice en vez de
    // mostrar un top 8 armado con tres activos
    const weeklyCoverage = quotes.length ? withWeek.length / quotes.length : 0

    const newest = quotes.reduce<string | null>(
      (max, q) => (!max || q.updated_at > max ? q.updated_at : max),
      null,
    )
    const stale = newest ? Date.now() - new Date(newest).getTime() > STALE_HOURS * 3600_000 : false

    return {
      loading,
      total: quotes.length,
      updatedAt: newest,
      stale,
      weeklyCoverage,
      bestToday: [...withDay].sort((a, b) => b.daily_change_pct! - a.daily_change_pct!),
      bestWeek: [...withWeek].sort((a, b) => b.week_change_pct! - a.week_change_pct!),
      worstWeek: [...withWeek].sort((a, b) => a.week_change_pct! - b.week_change_pct!),
      reload: load,
    }
  }, [quotes, names, positions, loading, load])
}
