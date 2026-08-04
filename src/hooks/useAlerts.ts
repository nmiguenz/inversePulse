import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import type { Alert } from '@/lib/types'

export function useAlerts() {
  const { session } = useAuth()
  const userId = session?.user.id
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !userId) {
      setLoading(false)
      return
    }

    const { data } = await supabase
      .from('alerts')
      .select('*')
      .eq('user_id', userId)
      .eq('is_dismissed', false)
      .order('created_at', { ascending: false })
      .limit(100)

    setAlerts((data ?? []) as Alert[])
    setLoading(false)
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!isSupabaseConfigured || !userId) return

    const channel = supabase
      .channel(`alerts:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'alerts', filter: `user_id=eq.${userId}` },
        () => void load(),
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [userId, load])

  const unreadCount = useMemo(() => alerts.filter((a) => !a.is_read).length, [alerts])

  const markRead = useCallback(async (id: string) => {
    // Optimista: la UI no espera al round trip
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, is_read: true } : a)))
    await supabase.from('alerts').update({ is_read: true }).eq('id', id)
  }, [])

  const markAllRead = useCallback(async () => {
    if (!userId) return
    setAlerts((prev) => prev.map((a) => ({ ...a, is_read: true })))
    await supabase.from('alerts').update({ is_read: true }).eq('user_id', userId).eq('is_read', false)
  }, [userId])

  const dismiss = useCallback(async (id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id))
    await supabase.from('alerts').update({ is_dismissed: true }).eq('id', id)
  }, [])

  return { alerts, unreadCount, loading, markRead, markAllRead, dismiss, reload: load }
}
