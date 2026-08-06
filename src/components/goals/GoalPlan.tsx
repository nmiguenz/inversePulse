import { useCallback, useEffect, useState } from 'react'
import { RecommendationCard } from '@/components/opportunities/RecommendationCard'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { formatRelativeTime } from '@/lib/format'
import { invokeFunction } from '@/lib/functions'
import type { Recommendation } from '@/lib/types'

/**
 * El plan de compra de una meta.
 *
 * Reusa la tabla `recommendations` y su tarjeta: una recomendación de meta es
 * una recomendación como cualquier otra, solo que atada a un objetivo y con el
 * horizonte acotado por la fecha. Así hereda gratis el registro de aciertos que
 * la app ya lleva.
 */
export function GoalPlan({
  goalId,
  planGeneratedAt,
  onGenerated,
}: {
  goalId: string
  planGeneratedAt: string | null
  onGenerated: () => void
}) {
  const { session } = useAuth()
  const [plan, setPlan] = useState<Recommendation[]>([])
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('recommendations')
      .select('*')
      .eq('goal_id', goalId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
    setPlan((data ?? []) as Recommendation[])
  }, [goalId])

  useEffect(() => {
    void load()
  }, [load])

  async function generate() {
    if (!session) return
    setGenerating(true)
    setError('')

    try {
      // Se llama con el JWT del usuario, no con la service role key: estas
      // funciones son las que se disparan desde la app y no solo desde el cron
      await invokeFunction('goal-advisor', { goal_id: goalId })
      await load()
      onGenerated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo generar el plan')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-primary text-[13px] font-semibold">Plan para esta meta</p>
        {planGeneratedAt && (
          <span className="text-muted shrink-0 text-[11px]">
            {formatRelativeTime(planGeneratedAt)}
          </span>
        )}
      </div>

      {plan.length > 0 ? (
        <ul className="space-y-3">
          {plan.map((rec) => (
            <RecommendationCard key={rec.id} rec={rec} />
          ))}
        </ul>
      ) : (
        <p className="text-muted text-[12px] leading-relaxed">
          Todavía no hay plan. El asesor mira el objetivo, el plazo y lo que ya tenés apartado, y
          propone qué comprar — con el horizonte acotado por la fecha de la meta.
        </p>
      )}

      {error && <p className="text-loss mt-2 text-[12px] leading-relaxed">{error}</p>}

      <button
        type="button"
        onClick={() => void generate()}
        disabled={generating}
        className="border-accent text-accent active:bg-hover mt-3 w-full rounded-xl border py-2.5 text-[13px] font-medium disabled:opacity-50"
      >
        {generating ? 'Analizando…' : plan.length ? 'Regenerar plan' : 'Generar plan'}
      </button>
    </div>
  )
}
