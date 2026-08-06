import { useCallback, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import type { Goal, GoalHolding } from '@/lib/types'

export function useGoals() {
  const { session } = useAuth()
  const [goals, setGoals] = useState<Goal[]>([])
  const [holdings, setHoldings] = useState<GoalHolding[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !session) {
      setLoading(false)
      return
    }

    const [summary, items] = await Promise.all([
      // La vista ya calcula valor actual, costo y si quedó sobre-asignada
      supabase.from('goal_summary').select('*').order('created_at'),
      supabase.from('goal_holdings').select('*'),
    ])

    if (summary.error) console.error('[goals]', summary.error.message)
    setGoals((summary.data ?? []) as Goal[])
    setHoldings((items.data ?? []) as GoalHolding[])
    setLoading(false)
  }, [session])

  useEffect(() => {
    void load()
  }, [load])

  const createGoal = useCallback(
    async (input: { name: string; description?: string; target_date?: string; target_amount?: number; emoji?: string }) => {
      if (!session) return { error: 'sin sesión' }
      const { error } = await supabase
        .from('goal_portfolios')
        .insert({ ...input, user_id: session.user.id })
      if (!error) await load()
      return { error: error?.message ?? null }
    },
    [session, load],
  )

  const assign = useCallback(
    async (goalId: string, symbol: string, quantity: number) => {
      // El trigger de la base rechaza si te pasás de lo que tenés; el mensaje
      // que devuelve es el que se muestra tal cual, porque ya explica el motivo
      const { error } = await supabase
        .from('goal_holdings')
        .upsert({ goal_id: goalId, symbol, quantity }, { onConflict: 'goal_id,symbol' })
      if (!error) await load()
      return { error: error?.message ?? null }
    },
    [load],
  )

  const unassign = useCallback(
    async (id: string) => {
      await supabase.from('goal_holdings').delete().eq('id', id)
      await load()
    },
    [load],
  )

  const removeGoal = useCallback(
    async (id: string) => {
      await supabase.from('goal_portfolios').delete().eq('id', id)
      await load()
    },
    [load],
  )

  return { goals, holdings, loading, createGoal, assign, unassign, removeGoal, reload: load }
}
