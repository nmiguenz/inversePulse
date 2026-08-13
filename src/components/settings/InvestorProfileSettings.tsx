import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { SECTOR_ORDER } from '@/lib/sectors'

type Profile = {
  risk_profile: 'agresivo' | 'moderado'
  preferred_sectors: string[]
  objective: string
}

const DEFAULTS: Profile = {
  risk_profile: 'agresivo',
  preferred_sectors: [],
  objective: '',
}

const RISK_LABEL: Record<Profile['risk_profile'], { label: string; hint: string }> = {
  agresivo: {
    label: 'Agresivo',
    hint: 'Prioriza crecimiento: pullbacks en empresas que crecen, momentum con resultados, rotar renta fija a acciones.',
  },
  moderado: {
    label: 'Moderado',
    hint: 'Prioriza estabilidad: valuaciones razonables, blue chips, diversificación sectorial.',
  },
}

/**
 * El perfil que el asesor usa para saber a quién le habla.
 *
 * No es decorativo: los prompts tienen dos versiones enteras según el perfil de
 * riesgo, y hasta ahora ninguna pantalla lo dejaba editar aunque el valor
 * existiera en la base. El objetivo y los sectores entran textuales al prompt.
 */
export function InvestorProfileSettings() {
  const { session } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [objectiveDraft, setObjectiveDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!session) return
    const { data } = await supabase
      .from('users')
      .select('settings')
      .eq('id', session.user.id)
      .maybeSingle()

    const s = (data?.settings ?? {}) as Partial<Profile>
    const next: Profile = {
      risk_profile: s.risk_profile === 'moderado' ? 'moderado' : 'agresivo',
      preferred_sectors: Array.isArray(s.preferred_sectors) ? s.preferred_sectors : [],
      objective: s.objective ?? DEFAULTS.objective,
    }
    setProfile(next)
    setObjectiveDraft(next.objective)
  }, [session])

  useEffect(() => {
    void load()
  }, [load])

  async function save(next: Profile) {
    if (!session) return
    setProfile(next)
    setSaving(true)
    setError('')

    // Se relee antes de escribir: `settings` es un JSONB entero, así que pisar
    // el objeto con lo que había en memoria borraría los umbrales.
    const { data } = await supabase
      .from('users')
      .select('settings')
      .eq('id', session.user.id)
      .maybeSingle()

    const { error: saveError } = await supabase
      .from('users')
      .update({ settings: { ...((data?.settings ?? {}) as object), ...next } })
      .eq('id', session.user.id)

    if (saveError) setError(saveError.message)
    setSaving(false)
  }

  if (!profile) return <p className="text-muted text-[12px]">Cargando…</p>

  const toggleSector = (sector: string) => {
    const has = profile.preferred_sectors.includes(sector)
    void save({
      ...profile,
      preferred_sectors: has
        ? profile.preferred_sectors.filter((s) => s !== sector)
        : [...profile.preferred_sectors, sector],
    })
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[13px] font-medium">Perfil de riesgo</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(['agresivo', 'moderado'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => void save({ ...profile, risk_profile: r })}
              className={`rounded-xl border py-2.5 text-[13px] transition-colors ${
                profile.risk_profile === r
                  ? 'border-accent bg-accent-soft text-accent font-medium'
                  : 'border-line text-secondary'
              }`}
            >
              {RISK_LABEL[r].label}
            </button>
          ))}
        </div>
        <p className="text-muted mt-2 text-[11px] leading-relaxed">
          {RISK_LABEL[profile.risk_profile].hint}
        </p>
      </div>

      <div>
        <label htmlFor="objective" className="block text-[13px] font-medium">
          Tu objetivo
        </label>
        <p className="text-muted mt-0.5 mb-2 text-[11px] leading-relaxed">
          Entra textual en el análisis. Escribilo como se lo dirías a un asesor.
        </p>
        <textarea
          id="objective"
          value={objectiveDraft}
          onChange={(e) => setObjectiveDraft(e.target.value)}
          // Se guarda al salir del campo, no en cada tecla: cada cambio es un
          // UPDATE, y guardar letra por letra son cientos de escrituras.
          onBlur={() => {
            if (objectiveDraft !== profile.objective) {
              void save({ ...profile, objective: objectiveDraft })
            }
          }}
          rows={3}
          placeholder="Ej: maximizar el crecimiento del capital y reinvertir las ganancias, sin descapitalizarme."
          className="border-line bg-elevated text-primary w-full resize-none rounded-xl border px-3 py-2.5 text-[13px] leading-relaxed outline-none"
        />
      </div>

      <div>
        <p className="text-[13px] font-medium">Sectores donde tenés convicción</p>
        <p className="text-muted mt-0.5 mb-2 text-[11px] leading-relaxed">
          El asesor prioriza estos, pero no fuerza: si hoy no hay nada bueno ahí, no inventa una
          oportunidad.
        </p>
        <div className="flex flex-wrap gap-2">
          {SECTOR_ORDER.map((sector) => {
            const on = profile.preferred_sectors.includes(sector)
            return (
              <button
                key={sector}
                type="button"
                onClick={() => toggleSector(sector)}
                className={`rounded-full border px-3 py-1.5 text-[12px] transition-colors ${
                  on
                    ? 'border-accent bg-accent-soft text-accent font-medium'
                    : 'border-line text-secondary'
                }`}
              >
                {sector}
              </button>
            )
          })}
        </div>
      </div>

      <p className="text-muted border-subtle border-t pt-3 text-[11px] leading-relaxed">
        Tu historial de decisiones no se carga acá: el asesor lo arma solo con tus últimas
        operaciones. Lo que compraste y vendiste dice más que cualquier descripción.
      </p>

      {saving && <p className="text-muted text-[11px]">Guardando…</p>}
      {error && <p className="text-loss text-[12px]">{error}</p>}
    </div>
  )
}
