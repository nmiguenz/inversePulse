import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconBell, IconCashIn, IconCashOut } from '@/components/ui/Icon'
import { CashFlowModal } from '@/components/cashflow/CashFlowModal'
import { usePortfolio } from '@/hooks/usePortfolio'
import type { CashFlowKind } from '@/lib/cashflow'

type TopBarProps = {
  title: string
  subtitle?: string
  alertCount?: number
}

export function TopBar({ title, subtitle, alertCount = 0 }: TopBarProps) {
  const navigate = useNavigate()
  const { reload } = usePortfolio()
  const [refreshing, setRefreshing] = useState(false)
  const [cashFlow, setCashFlow] = useState<CashFlowKind | null>(null)

  async function refresh() {
    setRefreshing(true)
    try {
      await reload()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <header
      className="border-subtle bg-base/85 fixed inset-x-0 top-0 z-40 border-b backdrop-blur-xl lg:left-56"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4 lg:max-w-6xl lg:px-8">
        <div className="min-w-0">
          <h1 className="font-display truncate text-[15px] leading-tight font-semibold">{title}</h1>
          {subtitle && (
            <p className="text-muted truncate text-[11px]">
              {subtitle}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
        {/* Solo en escritorio: en el celular ya está el pull-to-refresh, y en
            una PC no hay forma de traer datos nuevos porque ese gesto escucha
            `touchstart`, que un mouse nunca dispara. */}
        <button
          type="button"
          aria-label="Actualizar datos"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="border-subtle bg-surface hover:bg-hover hidden h-9 items-center gap-2 rounded-full border px-3 text-[12px] transition-colors disabled:opacity-60 lg:flex"
        >
          <span
            className={`text-secondary text-[13px] leading-none ${refreshing ? 'animate-spin' : ''}`}
            aria-hidden
          >
            ↻
          </span>
          <span className="text-secondary">{refreshing ? 'Actualizando…' : 'Actualizar'}</span>
        </button>

        {/* Aportes y retiros, a mano.
            IOL no publica los movimientos de dinero por API, así que esto no
            es un atajo: es la ÚNICA forma de que entren. Van en el header
            porque se cargan en el momento en que pasan —justo después de
            transferir— y no cuando uno se acuerda de abrir el Historial. */}
        <button
          type="button"
          aria-label="Registrar un aporte"
          title="Registrar un aporte"
          onClick={() => setCashFlow('deposit')}
          className="border-subtle bg-surface active:bg-hover flex h-9 w-9 items-center justify-center rounded-full border transition-colors"
        >
          <IconCashIn width={18} height={18} className="text-gain" />
        </button>

        <button
          type="button"
          aria-label="Registrar un retiro"
          title="Registrar un retiro"
          onClick={() => setCashFlow('withdrawal')}
          className="border-subtle bg-surface active:bg-hover flex h-9 w-9 items-center justify-center rounded-full border transition-colors"
        >
          <IconCashOut width={18} height={18} className="text-loss" />
        </button>

        <button
          type="button"
          aria-label={`Alertas${alertCount ? `, ${alertCount} sin leer` : ''}`}
          onClick={() => navigate('/alertas')}
          className="border-subtle bg-surface active:bg-hover relative flex h-9 w-9 items-center justify-center rounded-full border transition-colors"
        >
          <IconBell width={18} height={18} className="text-secondary" />
          {alertCount > 0 && (
            <span className="bg-loss text-base absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[10px] font-semibold">
              {alertCount > 9 ? '9+' : alertCount}
            </span>
          )}
        </button>
        </div>
      </div>

      {/* Al guardar se recarga la cartera: el aporte cambia el efectivo y el
          resultado del día, y verlos actualizarse confirma que se registró. */}
      <CashFlowModal
        open={cashFlow !== null}
        initialKind={cashFlow ?? 'deposit'}
        onClose={() => setCashFlow(null)}
        onSaved={() => void reload()}
      />
    </header>
  )
}
