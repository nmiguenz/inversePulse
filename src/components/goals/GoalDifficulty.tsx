import { useState } from 'react'
import { formatARS } from '@/lib/format'
import { BAND_HINT, BAND_LABEL, type DifficultyBand, type GoalAnalysis } from '@/lib/goals'

const BAND_STYLE: Record<DifficultyBand, string> = {
  comodo: 'bg-gain-soft text-gain',
  exigente: 'bg-info-soft text-info',
  dificil: 'bg-warning-soft text-warning',
  improbable: 'bg-warning-soft text-warning',
  inalcanzable: 'bg-loss-soft text-loss',
}

/** El requerido anual se vuelve ilegible arriba de cuatro dígitos */
function formatRequired(pct: number): string {
  if (pct >= 10000) return `${Math.round(pct / 1000)}.000% anual`
  if (pct >= 1000) return `${Math.round(pct)}% anual`
  return `${pct.toFixed(1)}% anual`
}

export function DifficultyBadge({ band }: { band: DifficultyBand }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${BAND_STYLE[band]}`}>
      {BAND_LABEL[band]}
    </span>
  )
}

/**
 * Dificultad de la meta y, cuando no cierra, las tres salidas reales.
 *
 * La app no bloquea una meta imposible: es plata del usuario. Pero decir "vas
 * 40%" sin decir que el objetivo pide 70.000% anual sería dejarlo caminar hacia
 * una apuesta. Y un semáforo en rojo a secas tampoco sirve — por eso van los
 * tres números que convierten el "no llegás" en algo que se puede decidir:
 * cuánta plata haría falta, para cuándo llegás, o qué monto sí es alcanzable.
 */
export function GoalDifficulty({ analysis }: { analysis: GoalAnalysis }) {
  const [open, setOpen] = useState(false)
  const { band, required, projections: p, rate, covered, daysLeft } = analysis

  if (covered) {
    return (
      <div className="bg-gain-soft mt-3 rounded-xl px-3.5 py-3">
        <p className="text-gain text-[13px] font-medium">Objetivo cubierto</p>
        <p className="text-secondary mt-1 text-[12px] leading-relaxed">
          {daysLeft != null && daysLeft > 0
            ? `Ya tenés lo que necesitás y faltan ${daysLeft} días. De acá en más el riesgo es perderlo, no no llegar.`
            : 'Ya tenés lo que necesitás. La meta sigue sumando: no se cierra.'}
        </p>
      </div>
    )
  }

  // Sin objetivo o sin fecha no hay dificultad que calcular, y no es un error:
  // una meta de "juntar lo que se pueda" es perfectamente válida
  if (band === null || required === null) return null

  const hard = band === 'improbable' || band === 'inalcanzable'

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <DifficultyBadge band={band} />
        <span className="text-muted min-w-0 flex-1 truncate text-[11px]">
          pide {formatRequired(required)}
        </span>
        <span className="text-muted shrink-0 text-[11px]">{open ? 'Ocultar' : 'Ver'}</span>
      </button>

      {open && (
        <div className="border-subtle mt-3 border-t pt-3">
          <p className="text-secondary text-[12px] leading-relaxed">{BAND_HINT[band]}</p>

          {hard && (
            <p className="text-secondary mt-2 text-[12px] leading-relaxed">
              Una meta así no se alcanza tomando más riesgo: se alcanza cambiando alguno de los
              tres números de abajo. El asesor no va a proponerte concentrar para llegar.
            </p>
          )}

          {p && (
            <div className="mt-3 space-y-2.5">
              <Exit
                label="Con lo que tenés, llegás a"
                value={formatARS(p.achievableAmount)}
                hint="en la fecha que pusiste"
              />
              {p.capitalNeededToday > 0 && (
                <Exit
                  label="Para llegar al objetivo necesitarías"
                  value={formatARS(p.capitalNeededToday)}
                  hint="invertidos hoy"
                />
              )}
              {p.dateReached && (
                <Exit
                  label="Con lo que tenés, el objetivo llega"
                  value={new Date(`${p.dateReached}T12:00:00`).toLocaleDateString('es-AR', {
                    month: 'long',
                    year: 'numeric',
                  })}
                  hint={
                    p.yearsToTarget != null && p.yearsToTarget >= 1
                      ? `en ${p.yearsToTarget.toFixed(1)} años`
                      : undefined
                  }
                />
              )}
            </div>
          )}

          <p className="text-muted mt-3 text-[11px] leading-relaxed">{rate.explanation}</p>
        </div>
      )}
    </div>
  )
}

function Exit({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-secondary min-w-0 flex-1 text-[12px] leading-snug">{label}</span>
      <span className="shrink-0 text-right">
        <span className="tnum text-primary block text-[13px] font-semibold">{value}</span>
        {hint && <span className="text-muted block text-[11px]">{hint}</span>}
      </span>
    </div>
  )
}
