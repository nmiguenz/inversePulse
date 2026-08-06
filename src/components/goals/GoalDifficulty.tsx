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
 * Dificultad de la meta y las tres proyecciones.
 *
 * Se muestran los tres escenarios en vez de una sola tasa porque un número
 * único siempre miente para algún lado: conservador subestima un buen año,
 * optimista pinta de verde metas que no llegan. Y el escenario malo importa
 * más que el bueno cuando la meta tiene fecha — es el que dice cuánto podrías
 * NO tener el día que necesitás la plata.
 *
 * La app no bloquea una meta imposible: es plata del usuario. Pero cuando el
 * objetivo no entra ni en el mejor escenario, lo dice, y ofrece las tres
 * salidas reales.
 */
export function GoalDifficulty({ analysis }: { analysis: GoalAnalysis }) {
  const [open, setOpen] = useState(false)
  const { band, required, bad, mid, good, set, covered, daysLeft, outOfReach, currentValue } = analysis

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

          {/* Las tres puntas. La mala va primero a propósito: para una meta con
              fecha es la que decide si vas a tener la plata */}
          {bad && mid && good && (
            <div className="mt-3">
              <p className="text-muted mb-2 text-[11px]">
                A cuánto llegás en la fecha, según cómo venga el mercado
              </p>
              <div className="grid grid-cols-3 gap-2">
                <Scenario
                  label="Si va mal"
                  amount={bad.achievableAmount}
                  from={currentValue}
                  tone="text-loss"
                />
                <Scenario
                  label="Si va normal"
                  amount={mid.achievableAmount}
                  from={currentValue}
                  tone="text-primary"
                />
                <Scenario
                  label="Si va excelente"
                  amount={good.achievableAmount}
                  from={currentValue}
                  tone="text-gain"
                />
              </div>
            </div>
          )}

          {outOfReach && (
            <p className="text-secondary mt-3 text-[12px] leading-relaxed">
              El objetivo no entra <strong className="text-primary">ni en el mejor escenario</strong>
              . No es cuestión de tomar más riesgo: es cuestión de cambiar alguno de los tres
              números de abajo. El asesor no va a proponerte concentrar para llegar.
            </p>
          )}

          {mid && (
            <div className="mt-3 space-y-2.5">
              {mid.capitalNeededToday > 0 && (
                <Exit
                  label="Para llegar al objetivo necesitarías"
                  value={formatARS(mid.capitalNeededToday)}
                  hint="invertidos hoy, a ritmo normal"
                />
              )}
              {mid.dateReached && (
                <Exit
                  label="Con lo que tenés, el objetivo llega"
                  value={new Date(`${mid.dateReached}T12:00:00`).toLocaleDateString('es-AR', {
                    month: 'long',
                    year: 'numeric',
                  })}
                  hint={
                    mid.yearsToTarget != null && mid.yearsToTarget >= 1
                      ? `en ${mid.yearsToTarget.toFixed(1)} años`
                      : undefined
                  }
                />
              )}
            </div>
          )}

          <p className="text-muted mt-3 text-[11px] leading-relaxed">{set.source}</p>
        </div>
      )}
    </div>
  )
}

/**
 * Se muestra la variación del PERÍODO, no la tasa anual, porque es la que se
 * aplica de verdad: los escenarios extremos escalan por raíz del tiempo, así
 * que "−35% anual" no es el número que se usa para 51 días ni para 10 años.
 */
function Scenario({
  label,
  amount,
  from,
  tone,
}: {
  label: string
  amount: number
  from: number
  tone: string
}) {
  const change = from > 0 ? (amount / from - 1) * 100 : 0
  return (
    <div className="bg-elevated rounded-xl px-2.5 py-2.5 text-center">
      <p className="text-muted text-[10px] leading-tight">{label}</p>
      <p className={`tnum mt-1 text-[13px] font-semibold ${tone}`}>{formatARS(amount)}</p>
      <p className="text-muted tnum mt-0.5 text-[10px]">
        {change > 0 ? '+' : ''}
        {change.toFixed(0)}%
      </p>
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
