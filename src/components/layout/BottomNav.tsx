import { NavLink } from 'react-router-dom'
import type { ComponentType, SVGProps } from 'react'
import { IconBell, IconDashboard, IconNews, IconRocket, IconSettings } from '@/components/ui/Icon'

type Tab = {
  to: string
  label: string
  Icon: ComponentType<SVGProps<SVGSVGElement>>
  /** Contador de items pendientes (alertas sin leer, etc.) */
  badge?: number
}

const tabs: Tab[] = [
  { to: '/', label: 'Dashboard', Icon: IconDashboard },
  { to: '/alertas', label: 'Alertas', Icon: IconBell },
  { to: '/oportunidades', label: 'Oportunidades', Icon: IconRocket },
  { to: '/noticias', label: 'Noticias', Icon: IconNews },
  { to: '/config', label: 'Config', Icon: IconSettings },
]

export function BottomNav({ alertCount = 0 }: { alertCount?: number }) {
  return (
    <nav
      className="border-line bg-base/85 fixed inset-x-0 bottom-0 z-50 border-t backdrop-blur-xl"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex max-w-lg items-stretch">
        {tabs.map(({ to, label, Icon }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                [
                  'relative flex h-[60px] flex-col items-center justify-center gap-1 transition-colors',
                  'active:bg-hover',
                  isActive ? 'text-accent' : 'text-muted',
                ].join(' ')
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="gradient-accent absolute top-0 h-0.5 w-8 rounded-full" />
                  )}
                  <span className="relative">
                    <Icon width={21} height={21} />
                    {to === '/alertas' && alertCount > 0 && (
                      <span className="bg-loss text-base absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[10px] font-semibold">
                        {alertCount > 9 ? '9+' : alertCount}
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] leading-none font-medium tracking-tight">
                    {label}
                  </span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
