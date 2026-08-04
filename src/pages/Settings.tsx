import { useEffect, useState } from 'react'
import { Card, SectionTitle } from '@/components/ui/Card'
import { IconChevronRight } from '@/components/ui/Icon'
import { useAuth } from '@/lib/auth'
import { currentSubscription, pushSupported, subscribeToPush, unsubscribeFromPush } from '@/lib/push'

const rows = [
  { label: 'Umbrales de alerta', hint: 'Take profit, stop loss, rebalanceo' },
  { label: 'Horario de monitoreo', hint: '10:00 – 18:00' },
  { label: 'Gestión de posiciones', hint: 'Editar precio de compra' },
  { label: 'Cuenta IOL', hint: 'Conectada' },
]

type PushState = 'checking' | 'off' | 'on' | 'busy' | 'unsupported' | 'blocked'

export function Settings() {
  const { session, signOut } = useAuth()
  const [push, setPush] = useState<PushState>('checking')
  const [pushError, setPushError] = useState('')

  useEffect(() => {
    if (!pushSupported) return setPush('unsupported')
    if (Notification.permission === 'denied') return setPush('blocked')

    void currentSubscription().then((sub) => setPush(sub ? 'on' : 'off'))
  }, [])

  async function togglePush() {
    if (!session) return
    setPushError('')
    setPush('busy')

    try {
      if (push === 'on') {
        await unsubscribeFromPush(session.user.id)
        setPush('off')
      } else {
        await subscribeToPush(session.user.id)
        setPush('on')
      }
    } catch (err) {
      setPushError(err instanceof Error ? err.message : 'No se pudo activar')
      setPush(Notification.permission === 'denied' ? 'blocked' : 'off')
    }
  }

  const pushLabel: Record<PushState, string> = {
    checking: 'Verificando…',
    on: 'Activas en este dispositivo',
    off: 'Requiere tu permiso',
    busy: 'Un momento…',
    unsupported: 'No soportadas en este dispositivo',
    blocked: 'Bloqueadas en el navegador',
  }

  return (
    <div className="animate-fade-up space-y-4">
      <div>
        <SectionTitle icon="🔔">Notificaciones</SectionTitle>
        <Card>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[14px] font-medium">Push notifications</p>
              <p className="text-secondary mt-0.5 text-[12px]">{pushLabel[push]}</p>
            </div>
            <button
              type="button"
              onClick={() => void togglePush()}
              disabled={push === 'unsupported' || push === 'blocked' || push === 'busy' || push === 'checking'}
              className={`shrink-0 rounded-full px-4 py-2 text-[12px] font-medium disabled:opacity-40 ${
                push === 'on'
                  ? 'border-line text-secondary border'
                  : 'gradient-accent text-white'
              }`}
            >
              {push === 'on' ? 'Desactivar' : 'Activar'}
            </button>
          </div>
          {pushError && <p className="text-loss mt-3 text-[12px] leading-relaxed">{pushError}</p>}
          {push === 'blocked' && (
            <p className="text-muted mt-3 text-[12px] leading-relaxed">
              Las desbloqueás desde el candado en la barra de direcciones del navegador.
            </p>
          )}
        </Card>
      </div>

      <div>
        <SectionTitle icon="⚙️">Preferencias</SectionTitle>
        <Card className="p-0">
          <ul>
            {rows.map((r) => (
              <li key={r.label}>
                <button
                  type="button"
                  className="border-subtle active:bg-hover flex w-full items-center justify-between gap-3 border-b px-4 py-3.5 text-left transition-colors last:border-b-0"
                >
                  <span>
                    <span className="block text-[14px]">{r.label}</span>
                    <span className="text-muted mt-0.5 block text-[12px]">{r.hint}</span>
                  </span>
                  <IconChevronRight className="text-muted shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <p className="text-muted mt-3 text-center font-mono text-[10px] tracking-wide uppercase">
          Editables en la Fase 6
        </p>
      </div>

      <div>
        <SectionTitle icon="👤">Cuenta</SectionTitle>
        <Card>
          <p className="text-secondary text-[12px]">Sesión iniciada como</p>
          <p className="text-primary mt-0.5 font-mono text-[13px] break-all">
            {session?.user.email}
          </p>
          <button
            type="button"
            onClick={() => void signOut()}
            className="border-line text-loss active:bg-hover mt-4 w-full rounded-xl border py-2.5 text-[13px] font-medium transition-colors"
          >
            Cerrar sesión
          </button>
        </Card>
      </div>
    </div>
  )
}
