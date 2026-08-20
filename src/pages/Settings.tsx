import { useEffect, useState } from 'react'
import { Card, SectionTitle } from '@/components/ui/Card'
import { useAuth } from '@/lib/auth'
import { currentSubscription, pushSupported, subscribeToPush, unsubscribeFromPush } from '@/lib/push'
import { EarningsManager } from '@/components/settings/EarningsManager'
import { BrokerConnection } from '@/components/settings/BrokerConnection'
import { ApiKeySettings } from '@/components/settings/ApiKeySettings'
import { InvestorProfileSettings } from '@/components/settings/InvestorProfileSettings'
import { ThresholdSettings } from '@/components/settings/ThresholdSettings'
import { usePortfolio } from '@/hooks/usePortfolio'
import { loadTheme, saveTheme, type ThemeChoice } from '@/lib/theme'

const THEME_OPTIONS: Array<{ value: ThemeChoice; label: string }> = [
  { value: 'system', label: 'Automático' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
]

type PushState = 'checking' | 'off' | 'on' | 'busy' | 'unsupported' | 'blocked'

export function Settings() {
  const { session, signOut } = useAuth()
  const { iolStatus } = usePortfolio()
  const [iolOpen, setIolOpen] = useState(false)
  const [push, setPush] = useState<PushState>('checking')
  const [pushError, setPushError] = useState('')
  const [theme, setTheme] = useState<ThemeChoice>(() => loadTheme())

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
      {/* Con la cuenta conectada y sincronizando, esta card repetía la fila de
          "Más" que está al final. Queda solo cuando hay algo que hacer: conectar
          por primera vez, o un error de sync, que es justo cuando hace falta
          tener el botón de reconectar a la vista. */}
      {(!iolStatus?.is_connected || iolStatus?.last_sync_error) && (
        <div>
          <SectionTitle icon="🔗">Tu cuenta de IOL</SectionTitle>
          <Card>
            <BrokerConnection />
          </Card>
        </div>
      )}

      {/* Va antes de la API key y de los umbrales a propósito: es lo que
          decide QUÉ te recomienda el asesor, no cuánto gasta ni cuándo avisa. */}
      <div>
        <SectionTitle icon="🎯">Tu perfil de inversor</SectionTitle>
        <Card>
          <InvestorProfileSettings />
        </Card>
      </div>

      <div>
        <SectionTitle icon="🤖">Tu API key de Claude</SectionTitle>
        <Card>
          <ApiKeySettings />
        </Card>
      </div>

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
        <SectionTitle icon="🎨">Apariencia</SectionTitle>
        <Card>
          <div className="flex gap-2">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setTheme(option.value)
                  saveTheme(option.value)
                }}
                className={`flex-1 rounded-xl border py-2.5 text-[13px] transition-colors ${
                  theme === option.value
                    ? 'border-accent bg-accent-soft text-accent font-medium'
                    : 'border-line bg-elevated text-secondary active:bg-hover'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="text-muted mt-2.5 text-[12px] leading-relaxed">
            "Automático" sigue la configuración de tu teléfono.
          </p>
        </Card>
      </div>

      <div>
        <SectionTitle icon="📊">Calendario de earnings</SectionTitle>
        <Card>
          <EarningsManager />
        </Card>
      </div>

      <div>
        <SectionTitle icon="🎚️">Umbrales de alerta</SectionTitle>
        <Card>
          <ThresholdSettings />
        </Card>
      </div>

      <div>
        <SectionTitle icon="⚙️">Más</SectionTitle>
        {/* El acceso a Historial estaba acá y se fue al Dashboard, al lado de
            Metas: no es un ajuste, es una vista de datos, y enterrada en
            Configuración no la encontraba nadie desde el celular. */}
        <Card className="p-0">
          {/* Conectada: la fila se despliega y trae reconectar/desconectar.
              Sin conectar: es solo un estado, porque el formulario ya está en
              la card de arriba y ofrecerlo dos veces es la duplicación que se
              vino a sacar, nada más que en el otro estado. */}
          {iolStatus?.is_connected ? (
            <button
              type="button"
              onClick={() => setIolOpen((v) => !v)}
              aria-expanded={iolOpen}
              className="active:bg-hover flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors"
            >
              <IolSummary iolStatus={iolStatus} />
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-muted text-[11px]">{iolOpen ? 'Ocultar' : 'Gestionar'}</span>
                <span className="bg-gain h-2 w-2 rounded-full" aria-hidden />
              </span>
            </button>
          ) : (
            <div className="flex w-full items-center justify-between gap-3 px-4 py-3.5">
              <IolSummary iolStatus={iolStatus} />
              <span className="bg-muted h-2 w-2 shrink-0 rounded-full" aria-hidden />
            </div>
          )}
          {iolOpen && iolStatus?.is_connected && (
            <div className="border-subtle border-t px-4 py-4">
              <BrokerConnection />
            </div>
          )}
        </Card>
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

/** Nombre y estado de la conexión, compartido por las dos variantes de la fila. */
function IolSummary({ iolStatus }: { iolStatus: { is_connected?: boolean; last_sync_at?: string | null } | null }) {
  return (
    <span className="min-w-0">
      <span className="block text-[14px]">Cuenta IOL</span>
      <span className="text-muted mt-0.5 block text-[12px]">
        {iolStatus?.is_connected ? 'Conectada' : 'Sin conectar'}
        {iolStatus?.last_sync_at &&
          ` · último sync ${new Date(iolStatus.last_sync_at).toLocaleTimeString('es-AR', {
            hour: '2-digit',
            minute: '2-digit',
          })}`}
      </span>
    </span>
  )
}
