import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { uniqueChannelName } from '@/lib/realtime'
import { AssetLogo } from '@/components/ui/AssetLogo'
import { formatARS } from '@/lib/format'
import { topAction } from '@/lib/recommendations'
import { usePortfolio } from '@/hooks/usePortfolio'
import type { Recommendation } from '@/lib/types'

const ACTION_LABEL: Record<string, string> = {
  buy: 'Comprar',
  add: 'Ampliar',
  trim: 'Reducir',
  sell: 'Vender',
  rebalance: 'Rebalancear',
}

/**
 * Lo que conviene hacer, arriba de todo.
 *
 * Muestra SOLO convicción alta. Si destacara siempre algo, dejaría de destacar
 * — y una app que sugiere operar todos los días empuja a operar de más, que es
 * la forma más común de perder plata.
 */
export function NextAction() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const { positions } = usePortfolio()
  const [rec, setRec] = useState<Recommendation | null>(null)
  const [loading, setLoading] = useState(true)
  // Nombre único: Oportunidades también escucha `recommendations`, y supabase-js
  // reusa el canal por nombre — la segunda suscripción al mismo topic falla
  const channelName = useRef(uniqueChannelName('next-action'))

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !session) {
      setLoading(false)
      return
    }

    // Se traen todas las activas sin cumplir y elige `topAction`, en vez de
    // pedirle a la base la más reciente de convicción alta. Dos motivos: el
    // filtro `fulfilled_at` es lo que hace que desaparezca cuando ya la
    // ejecutaste, y el orden de importancia tiene que ser el mismo que usa
    // Oportunidades — antes acá mandaba la fecha y allá un orden alfabético
    // roto, así que podían destacar cosas distintas.
    const { data } = await supabase
      .from('recommendations')
      .select('*')
      .eq('is_active', true)
      .eq('confidence', 'high')
      // Solo las generales: las de meta se muestran dentro de su meta, y acá
      // aparecerían sin decir a cuál pertenecen
      .is('goal_id', null)
      // `fulfilled_at` se filtra en `topAction` y no acá: hasta que corra la
      // 0021 la columna no existe, y pedirla en la consulta la haría fallar
      // entera
      .limit(20)

    // Se le pasa lo que hay en cartera para que descarte rotaciones desde
    // activos que no tenés: destacarlas arriba de todo sería lo peor, porque
    // es lo primero que se lee
    setRec(topAction((data ?? []) as Recommendation[], new Set(positions.map((p) => p.symbol))))
    setLoading(false)
  }, [session, positions])

  useEffect(() => {
    void load()
  }, [load])

  // Sin esto la sugerencia cumplida seguiría en pantalla hasta que recargues:
  // `fetch-transactions` la cierra del lado del servidor y acá no llegaba nada.
  useEffect(() => {
    if (!isSupabaseConfigured || !session) return
    const channel = supabase
      .channel(channelName.current)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'recommendations' },
        () => void load(),
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [session, load])

  if (loading) return <div className="card h-[104px] animate-pulse" />

  if (!rec) {
    return (
      <div className="card px-5 py-4">
        <p className="text-secondary text-[13px]">
          <span className="mr-1.5" aria-hidden>
            ✓
          </span>
          Nada urgente hoy
        </p>
        <p className="text-muted mt-1 text-[12px] leading-relaxed">
          El asesor no encontró ninguna acción con convicción alta. No hacer nada también es una
          decisión.
        </p>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => navigate('/oportunidades')}
      className="card w-full p-5 text-left"
      style={{ borderLeft: '3px solid var(--color-accent)' }}
    >
      <p className="text-accent text-[12px] font-medium">Conviene hacer</p>

      <div className="mt-2.5 flex items-center gap-3">
        <AssetLogo symbol={rec.symbol} />
        <div className="min-w-0 flex-1">
          <p className="text-primary text-[15px] font-semibold">
            {ACTION_LABEL[rec.action] ?? rec.action} {rec.symbol}
            {rec.counterpart_symbol && (
              <span className="text-muted font-normal"> desde {rec.counterpart_symbol}</span>
            )}
          </p>
          {rec.suggested_amount != null && (
            <p className="tnum text-secondary mt-0.5 text-[13px]">
              {formatARS(rec.suggested_amount)}
              {rec.suggested_quantity ? ` · ${rec.suggested_quantity} CEDEARs` : ''}
            </p>
          )}
        </div>
      </div>

      <p className="text-secondary mt-3 line-clamp-2 text-[13px] leading-relaxed">{rec.title}</p>

      {rec.realizes_loss && (
        <p className="text-loss mt-2 text-[12px]">Esta venta cristaliza una pérdida</p>
      )}

      <p className="text-accent mt-2.5 text-[12px] font-medium">Ver el análisis completo →</p>
    </button>
  )
}
