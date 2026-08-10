import { useMemo, useState } from 'react'
import { EmptyState } from '@/components/ui/Card'
import { AlertCard } from '@/components/alerts/AlertCard'
import { useAlerts } from '@/hooks/useAlerts'
import type { AlertSeverity } from '@/lib/types'

const FILTERS = {
  Todas: null,
  Críticas: 'critical',
  Importantes: 'warning',
  Info: 'info',
  Oportunidades: 'opportunity',
} as const

type FilterKey = keyof typeof FILTERS

export function Alerts() {
  const { alerts, unreadCount, loading, markRead, markAllRead, dismiss } = useAlerts()
  const [active, setActive] = useState<FilterKey>('Todas')

  const filtered = useMemo(() => {
    const severity = FILTERS[active] as AlertSeverity | null
    return severity ? alerts.filter((a) => a.severity === severity) : alerts
  }, [alerts, active])

  const counts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const a of alerts) map[a.severity] = (map[a.severity] ?? 0) + 1
    return map
  }, [alerts])

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card h-[116px] animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="animate-fade-up space-y-4">
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {(Object.keys(FILTERS) as FilterKey[]).map((f) => {
          const severity = FILTERS[f]
          const count = severity ? (counts[severity] ?? 0) : alerts.length
          return (
            <button
              key={f}
              type="button"
              onClick={() => setActive(f)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-[12px] transition-colors ${
                active === f
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line bg-elevated text-secondary active:bg-hover'
              }`}
            >
              {f}
              {count > 0 && <span className="tnum ml-1.5 font-mono text-[10px] opacity-70">{count}</span>}
            </button>
          )
        })}
      </div>

      {unreadCount > 0 && (
        <button
          type="button"
          onClick={() => void markAllRead()}
          className="text-accent w-full text-center text-[12px]"
        >
          Marcar las {unreadCount} sin leer como leídas
        </button>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon="🔔"
          title={alerts.length ? 'Nada en este filtro' : 'Sin alertas'}
          description={
            alerts.length
              ? 'Probá con otro filtro.'
              : 'Miramos tu cartera cada 5 minutos mientras el mercado está abierto. Si algo se mueve lo suficiente como para que valga la pena avisarte, aparece acá.'
          }
        />
      ) : (
        <>
          <ul className="space-y-3">
            {filtered.map((alert) => (
              <AlertCard key={alert.id} alert={alert} onDismiss={dismiss} onRead={markRead} />
            ))}
          </ul>
          <p className="text-muted text-center text-[11px]">
            Deslizá a la izquierda para descartar
          </p>
        </>
      )}
    </div>
  )
}
