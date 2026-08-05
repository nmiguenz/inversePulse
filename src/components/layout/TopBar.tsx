import { useNavigate } from 'react-router-dom'
import { IconBell } from '@/components/ui/Icon'

type TopBarProps = {
  title: string
  subtitle?: string
  alertCount?: number
}

export function TopBar({ title, subtitle, alertCount = 0 }: TopBarProps) {
  const navigate = useNavigate()

  return (
    <header
      className="border-subtle bg-base/85 fixed inset-x-0 top-0 z-40 border-b backdrop-blur-xl"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
        <div className="min-w-0">
          <h1 className="font-display truncate text-[15px] leading-tight font-semibold">{title}</h1>
          {subtitle && (
            <p className="text-muted truncate text-[11px]">
              {subtitle}
            </p>
          )}
        </div>

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
    </header>
  )
}
