import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { formatARS } from '@/lib/format'

type Settings = {
  take_profit_pct: number
  stop_loss_pct: number
  rebalance_pct: number
  sector_concentration_pct: number
  daily_extreme_pct: number
  idle_cash_threshold: number
  monitoring_start: string
  monitoring_end: string
  notify_decisions: boolean
  notify_opportunities: boolean
  notify_news: boolean
}

type SliderDef = {
  key: keyof Settings
  label: string
  hint: string
  min: number
  max: number
  step: number
  format: (v: number) => string
}

const pct = (v: number) => `${v > 0 ? '+' : ''}${v}%`

const SLIDERS: SliderDef[] = [
  { key: 'take_profit_pct', label: 'Toma de ganancia', hint: 'Avisa cuando una posición sube más de esto', min: 5, max: 100, step: 5, format: pct },
  { key: 'stop_loss_pct', label: 'Stop loss', hint: 'Avisa cuando una posición cae más de esto', min: -50, max: -5, step: 5, format: pct },
  { key: 'daily_extreme_pct', label: 'Variación extrema del día', hint: 'Movimiento diario que amerita mirar', min: 2, max: 20, step: 1, format: (v) => `±${v}%` },
  { key: 'rebalance_pct', label: 'Peso máximo por activo', hint: 'Arriba de esto sugiere rebalancear', min: 5, max: 50, step: 5, format: (v) => `${v}%` },
  { key: 'sector_concentration_pct', label: 'Peso máximo por sector', hint: 'Arriba de esto avisa por concentración', min: 20, max: 90, step: 5, format: (v) => `${v}%` },
  { key: 'idle_cash_threshold', label: 'Cash sin invertir', hint: 'Avisa si tenés más de esto sin rendir', min: 10000, max: 500000, step: 10000, format: formatARS },
]

/**
 * Por categoría y no por severidad.
 *
 * La severidad mezclaba cosas distintas: una noticia negativa y un rebalanceo
 * eran ambos "warning". Lo que importa es si requiere que decidas algo.
 */
const TOGGLES = [
  {
    key: 'notify_decisions' as const,
    label: 'Decisiones',
    hint: 'Stop loss, toma de ganancia, rebalanceo, concentración, earnings',
  },
  {
    key: 'notify_opportunities' as const,
    label: 'Oportunidades',
    hint: 'Recomendaciones del asesor con convicción alta',
  },
  {
    key: 'notify_news' as const,
    label: 'Noticias',
    hint: 'Noticias negativas sobre tus activos. Aparecen en Alertas igual.',
  },
]

/**
 * Edición de los umbrales que usa el motor de alertas.
 *
 * Se guardan en `users.settings`, que es de donde los lee `evaluate-alerts` en
 * cada corrida: no hace falta redeployar nada para que un cambio tome efecto.
 */
export function ThresholdSettings() {
  const { session } = useAuth()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!session) return
    const { data } = await supabase.from('users').select('settings').eq('id', session.user.id).maybeSingle()
    if (data?.settings) setSettings(data.settings as Settings)
  }, [session])

  useEffect(() => {
    void load()
  }, [load])

  async function save(next: Settings) {
    if (!session) return
    setSettings(next)
    setSaving(true)
    setError('')

    const { error: updateError } = await supabase
      .from('users')
      .update({ settings: next })
      .eq('id', session.user.id)

    if (updateError) setError(updateError.message)
    else {
      setSaved(true)
      setTimeout(() => setSaved(false), 1800)
    }
    setSaving(false)
  }

  if (!settings) {
    return <div className="bg-elevated h-24 animate-pulse rounded-xl" />
  }

  return (
    <div className="space-y-5">
      {SLIDERS.map((slider) => {
        const value = Number(settings[slider.key])
        return (
          <div key={slider.key}>
            <div className="flex items-baseline justify-between">
              <label htmlFor={slider.key} className="text-[13px] font-medium">
                {slider.label}
              </label>
              <span className="tnum text-accent font-mono text-[13px]">{slider.format(value)}</span>
            </div>
            <p className="text-muted mt-0.5 text-[11px]">{slider.hint}</p>
            <input
              id={slider.key}
              type="range"
              min={slider.min}
              max={slider.max}
              step={slider.step}
              value={value}
              onChange={(e) => setSettings({ ...settings, [slider.key]: Number(e.target.value) })}
              // Se guarda al soltar, no en cada pixel del arrastre
              onPointerUp={() => void save(settings)}
              onKeyUp={() => void save(settings)}
              className="accent-accent mt-2 w-full"
            />
          </div>
        )
      })}

      <div className="border-subtle border-t pt-4">
        <p className="text-secondary mb-3 text-[12px] font-medium">
          Qué te notifica
        </p>
        {TOGGLES.map((toggle) => (
          <label
            key={toggle.key}
            className="border-subtle flex items-center justify-between gap-4 border-b py-3 last:border-b-0"
          >
            <span className="min-w-0">
              <span className="block text-[13px]">{toggle.label}</span>
              <span className="text-muted block text-[11px]">{toggle.hint}</span>
            </span>
            <input
              type="checkbox"
              checked={toggle.key === 'notify_news' ? settings[toggle.key] === true : settings[toggle.key] !== false}
              onChange={(e) => void save({ ...settings, [toggle.key]: e.target.checked })}
              className="accent-accent h-5 w-5 shrink-0"
            />
          </label>
        ))}
      </div>

      <div className="border-subtle border-t pt-4">
        <p className="text-secondary mb-2 text-[12px] font-medium">
          Horario de monitoreo
        </p>
        <div className="flex items-center gap-2">
          <input
            type="time"
            value={settings.monitoring_start}
            onChange={(e) => void save({ ...settings, monitoring_start: e.target.value })}
            className="border-line bg-elevated text-primary flex-1 rounded-xl border px-3 py-2.5 font-mono text-[13px] outline-none"
          />
          <span className="text-muted text-[12px]">a</span>
          <input
            type="time"
            value={settings.monitoring_end}
            onChange={(e) => void save({ ...settings, monitoring_end: e.target.value })}
            className="border-line bg-elevated text-primary flex-1 rounded-xl border px-3 py-2.5 font-mono text-[13px] outline-none"
          />
        </div>
        <p className="text-muted mt-2 text-[11px] leading-relaxed">
          Fuera de este horario las alertas se siguen registrando, pero no te llega la notificación.
        </p>
      </div>

      <p className="text-muted h-4 text-center text-[11px]">
        {error ? <span className="text-loss">{error}</span> : saving ? 'Guardando…' : saved ? 'Guardado' : ''}
      </p>
    </div>
  )
}
