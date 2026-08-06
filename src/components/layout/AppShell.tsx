import { Outlet, useLocation } from 'react-router-dom'
import { BottomNav } from './BottomNav'
import { TopBar } from './TopBar'
import { useAlerts } from '@/hooks/useAlerts'

const titles: Record<string, { title: string; subtitle?: string }> = {
  '/': { title: 'IOL Portfolio Monitor', subtitle: 'Cartera en vivo' },
  '/alertas': { title: 'Alertas', subtitle: 'Señales de tu cartera' },
  '/oportunidades': { title: 'Oportunidades', subtitle: 'Detectadas por AI' },
  '/noticias': { title: 'Noticias', subtitle: 'Mercados y temáticas' },
  '/config': { title: 'Configuración', subtitle: 'Umbrales y notificaciones' },
  '/historial': { title: 'Historial', subtitle: 'Operaciones registradas' },
  '/metas': { title: 'Metas', subtitle: 'Tu cartera por objetivo' },
}

export function AppShell() {
  const { pathname } = useLocation()
  const meta = titles[pathname] ?? { title: 'IOL Portfolio Monitor' }

  const { unreadCount: alertCount } = useAlerts()

  return (
    <div className="bg-base min-h-dvh">
      <TopBar title={meta.title} subtitle={meta.subtitle} alertCount={alertCount} />

      <main
        className="mx-auto max-w-lg px-4"
        style={{
          paddingTop: 'calc(var(--topbar-h) + env(safe-area-inset-top) + 12px)',
          paddingBottom: 'calc(var(--bottomnav-h) + env(safe-area-inset-bottom) + 16px)',
        }}
      >
        <Outlet />
      </main>

      <BottomNav alertCount={alertCount} />
    </div>
  )
}
