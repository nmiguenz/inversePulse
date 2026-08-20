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
import { useAutoRefresh } from '@/hooks/useAutoRefresh'
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
 * Qué va arriba.
 *
 * `idle_cash` primero de todo: mientras haya plata parada, esa es la acción
 * pendiente más concreta que tiene el usuario — y además es la única alerta que
 * trae su propio panel de opciones. Antes se ordenaba solo por fecha, así que
 * cualquier alerta nueva la empujaba fuera de la vista.
 *
 * Después las de configuración rota (sin conexión o sin key la app no funciona
 * y todo lo demás se calculó sobre datos viejos), después las críticas, y al
 * final por fecha.
 */
const ALERT_RANK: Record<string, number> = {
  idle_cash: 0,
  connection_lost: 1,
  api_key_missing: 1,
  api_key_invalid: 1,
  cash_flow_review: 2,
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 3,
  warning: 4,
  opportunity: 5,
  info: 6,
}

function rank(alert: Alert): number {
  return ALERT_RANK[alert.alert_type] ?? SEVERITY_RANK[alert.severity] ?? 7
}

export function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort((a, b) => {
    const diff = rank(a) - rank(b)
    if (diff !== 0) return diff
    return b.created_at.localeCompare(a.created_at)
  })
}

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
    // El orden real lo pone sortAlerts: la consulta trae por fecha y después se
    // reordena por importancia

    const { data, error } = await supabase
      .from('alerts')
      .select('*')
      .eq('user_id', userId)
      .eq('is_dismissed', false)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) console.error('[alerts] no se pudieron cargar:', error.message)
    setAlerts(sortAlerts((data ?? []) as Alert[]))
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

  // Mismo motivo que en usePortfolio: `evaluate-alerts` corre encadenado al
  // sync, así que el badge se queda viejo por los mismos agujeros del websocket.
  useAutoRefresh(load, isSupabaseConfigured && Boolean(userId))

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
