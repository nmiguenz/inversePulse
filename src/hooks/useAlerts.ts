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
import type { Alert } from '@/lib/types'

type AlertsState = {
  alerts: Alert[]
  unreadCount: number
  loading: boolean
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  dismiss: (id: string) => Promise<void>
  reload: () => Promise<void>
}

const AlertsContext = createContext<AlertsState | null>(null)

/**
 * Provider único para las alertas.
 *
 * El AppShell (badge counter) y la pantalla de alertas necesitan los mismos
 * datos. Con un hook suelto, cada uno abría su propio canal de realtime con el
 * MISMO nombre (`alerts:<user>`) y duplicaba las queries; dos canales con el
 * mismo topic se pisan entre sí. Acá hay una sola suscripción compartida.
 */
export function AlertsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const userId = session?.user.id
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !userId) {
      setLoading(false)
      return
    }

    const { data, error } = await supabase
      .from('alerts')
      .select('*')
      .eq('user_id', userId)
      .eq('is_dismissed', false)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) console.error('[alerts] no se pudieron cargar:', error.message)
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

  const value = useMemo<AlertsState>(() => {
    const markRead = async (id: string) => {
      // Optimista: la UI no espera el round trip
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, is_read: true } : a)))
      await supabase.from('alerts').update({ is_read: true }).eq('id', id)
    }

    const markAllRead = async () => {
      if (!userId) return
      setAlerts((prev) => prev.map((a) => ({ ...a, is_read: true })))
      await supabase
        .from('alerts')
        .update({ is_read: true })
        .eq('user_id', userId)
        .eq('is_read', false)
    }

    const dismiss = async (id: string) => {
      setAlerts((prev) => prev.filter((a) => a.id !== id))
      await supabase.from('alerts').update({ is_dismissed: true }).eq('id', id)
    }

    return {
      alerts,
      unreadCount: alerts.filter((a) => !a.is_read).length,
      loading,
      markRead,
      markAllRead,
      dismiss,
      reload: load,
    }
  }, [alerts, loading, userId, load])

  return createElement(AlertsContext.Provider, { value }, children)
}

export function useAlerts(): AlertsState {
  const ctx = useContext(AlertsContext)
  if (!ctx) throw new Error('useAlerts debe usarse dentro de <AlertsProvider>')
  return ctx
}
