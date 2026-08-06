import { NavLink } from 'react-router-dom'
import type { ComponentType, SVGProps } from 'react'
import {
  IconBell,
  IconDashboard,
  IconNews,
  IconRocket,
  IconSettings,
} from '@/components/ui/Icon'

type Item = {
  to: string
  label: string
  Icon: ComponentType<SVGProps<SVGSVGElement>>
}

/**
 * En escritorio hay lugar para las siete secciones. La barra de abajo solo
 * muestra cinco porque en un celular no entran más, y Metas e Historial
 * quedaban escondidas detrás de un botón del Dashboard.
 */
const items: Item[] = [
  { to: '/', label: 'Dashboard', Icon: IconDashboard },
  { to: '/alertas', label: 'Alertas', Icon: IconBell },
  { to: '/oportunidades', label: 'Oportunidades', Icon: IconRocket },
  { to: '/noticias', label: 'Noticias', Icon: IconNews },
  { to: '/metas', label: 'Metas', Icon: IconRocket },
  { to: '/historial', label: 'Historial', Icon: IconNews },
  { to: '/config', label: 'Configuración', Icon: IconSettings },
]

/**
 * Navegación lateral, solo en escritorio (`hidden lg:flex`).
 *
 * Reemplaza a la barra de abajo, que en una pantalla grande desperdicia todo
 * el ancho y obliga a bajar la vista al borde inferior para cambiar de
 * sección. Por debajo de `lg` este componente no existe en el layout.
 */
export function Sidebar({ alertCount = 0 }: { alertCount?: number }) {
  return (
    <nav className="border-subtle bg-base/95 fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r px-3 py-4 backdrop-blur-xl lg:flex">
      <div className="px-3 pb-5">
        <p className="font-display text-primary text-[15px] leading-tight font-semibold">
          Inverse Pulse
        </p>
        <p className="text-muted text-[11px]">Cartera en vivo</p>
      </div>

      <ul className="space-y-0.5">
        {items.map(({ to, label, Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                [
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-colors',
                  isActive
                    ? 'bg-accent-soft text-accent'
                    : 'text-secondary hover:bg-hover hover:text-primary',
                ].join(' ')
              }
            >
              <Icon width={18} height={18} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {to === '/alertas' && alertCount > 0 && (
                <span className="bg-loss text-base flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 font-mono text-[10px] font-semibold">
                  {alertCount > 9 ? '9+' : alertCount}
                </span>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
