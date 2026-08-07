import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card, EmptyState } from '@/components/ui/Card'
import { RecommendationCard } from '@/components/opportunities/RecommendationCard'
import { MoverPanel } from '@/components/opportunities/MoverPanel'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useMarketMovers } from '@/hooks/useMarketMovers'
import { uniqueChannelName } from '@/lib/realtime'
import { formatPct } from '@/lib/format'
import { advisorHoursLabel } from '@/lib/schedule'
import { ScheduleStrip } from '@/components/opportunities/ScheduleStrip'
import { byImportance, isExecutable } from '@/lib/recommendations'
import { usePortfolio } from '@/hooks/usePortfolio'
import type { Recommendation } from '@/lib/types'

export function Opportunities() {
  const { session } = useAuth()
  const [active, setActive] = useState<Recommendation[]>([])
  const [past, setPast] = useState<Recommendation[]>([])
  const [loading, setLoading] = useState(true)
  const channelName = useRef(uniqueChannelName('recommendations-feed'))
  const movers = useMarketMovers()
  const { positions } = usePortfolio()

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !session) {
      setLoading(false)
      return
    }

    const [current, evaluated] = await Promise.all([
      supabase
        .from('recommendations')
        .select('*')
        .eq('is_active', true)
        // `.order('confidence')` ordenaba alfabéticamente sobre un TEXT: daba
        // high, low, medium — o sea media POR DEBAJO de baja. El orden real lo
        // pone `byImportance` abajo.
        //
        // Las cumplidas se filtran en el cliente y no en la consulta: si la
        // 0021 todavía no corrió, `fulfilled_at` no existe y PostgREST rechaza
        // el select ENTERO, dejando la pantalla vacía como si no hubiera
        // recomendaciones.
        //
        // Solo las generales: las de meta tienen su propio ciclo, las renueva
        // `goal-advisor` y se muestran dentro de la meta. Sin este filtro
        // aparecían en los dos lados a la vez, y encima parecían duplicados
        // contradictorios: dos rotaciones a GLD con montos distintos, una
        // general y otra de una meta.
        .is('goal_id', null)
        .limit(20),
      // Las ya evaluadas alimentan el historial de aciertos
      supabase
        .from('recommendations')
        .select('*')
        .not('evaluated_at', 'is', null)
        .order('evaluated_at', { ascending: false })
        .limit(50),
    ])

    // `isExecutable` descarta rotaciones desde activos que no tenés: el enum ya
    // lo impide para las nuevas, pero las viejas siguen en la base
    const held = new Set(positions.map((p) => p.symbol))
    setActive(
      ((current.data ?? []) as Recommendation[])
        .filter((r) => !r.fulfilled_at && isExecutable(r, held))
        .sort(byImportance),
    )
    setPast((evaluated.data ?? []) as Recommendation[])
    setLoading(false)
  }, [session, positions])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!isSupabaseConfigured || !session) return
    const channel = supabase
      .channel(channelName.current)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recommendations' }, () => void load())
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [session, load])

  /**
   * Cómo le viene yendo al asesor. Es el punto del registro: una IA que sugiere
   * mover plata sin dejar rastro de si acertó es una caja negra que opina.
   */
  const track = useMemo(() => {
    const judged = past.filter((r) => r.outcome_verdict === 'correcta' || r.outcome_verdict === 'incorrecta')
    if (!judged.length) return null
    const right = judged.filter((r) => r.outcome_verdict === 'correcta').length
    return { total: judged.length, right, pct: (right / judged.length) * 100 }
  }, [past])

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1].map((i) => (
          <div key={i} className="card h-[180px] animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="animate-fade-up space-y-4">
      {/* Arriba de todo, pegado al título de la pantalla: cuándo se renueva
          esto. En verde lo que falta correr hoy, en gris lo que ya pasó. */}
      <ScheduleStrip />

      {track && (
        <Card>
          <div className="flex items-baseline justify-between">
            <p className="text-secondary text-[13px]">Cómo viene el asesor</p>
            <p className="tnum text-primary text-[15px] font-semibold">
              {track.right} de {track.total}
            </p>
          </div>
          <div className="bg-elevated mt-2.5 h-1.5 overflow-hidden rounded-full">
            <div
              className="bg-accent h-full rounded-full"
              style={{ width: `${track.pct}%` }}
            />
          </div>
          <p className="text-muted mt-2 text-[12px] leading-relaxed">
            Recomendaciones que acertaron la dirección del precio a 30 días. Un historial corto no
            dice mucho — mirá la tendencia con el tiempo, no el primer puñado.
          </p>
        </Card>
      )}

      {active.length === 0 ? (
        <EmptyState
          icon="🧭"
          title="Sin recomendaciones vigentes"
          description={`El asesor analiza a las ${advisorHoursLabel()}, de lunes a viernes, y solo guarda acciones con fundamento. Que no haya nada acá significa que no vio motivo para mover plata — eso también es información.`}
        />
      ) : (
        <div>
          {/* Lo accionable va arriba y destacado: los paneles de abajo son
              contexto, esto es lo que el asesor sugiere hacer con tu plata */}
          <div className="mb-2 flex items-center gap-2 px-1">
            <span className="bg-accent h-1.5 w-1.5 rounded-full" aria-hidden />
            <h2 className="text-primary text-[14px] font-semibold">
              {active.length === 1 ? 'Acción sugerida' : `${active.length} acciones sugeridas`}
            </h2>
            <span className="text-muted ml-auto text-[11px]">de mayor a menor importancia</span>
          </div>
          <ul className="space-y-3">
            {active.map((rec) => (
              <RecommendationCard key={rec.id} rec={rec} />
            ))}
          </ul>
        </div>
      )}

      {/* ── Qué se mueve en el mercado ────────────────────────────────── */}
      {!movers.loading && (
        <div className="space-y-4 pt-1">
          <MoverPanel
            title="Mejores del día"
            subtitle={movers.total ? `${movers.total} activos` : undefined}
            movers={movers.bestToday}
            metric="day"
            emptyHint={
              movers.total === 0
                ? 'Todavía no se sincronizaron cotizaciones del mercado. Se actualizan al cierre de cada rueda.'
                : 'Ninguna cotización trajo variación diaria en la última sincronización.'
            }
          />

          <MoverPanel
            title="Mejores de la semana"
            subtitle={
              movers.weeklyCoverage < 0.5 && movers.total > 0 ? 'datos parciales' : undefined
            }
            movers={movers.bestWeek}
            metric="week"
            emptyHint="La variación semanal necesita el cierre de hace una semana. Se va completando a medida que la app acumula cierres diarios."
          />

          <div>
            <MoverPanel
              title="Peores de la semana"
              movers={movers.worstWeek}
              metric="week"
              emptyHint="La variación semanal necesita el cierre de hace una semana. Se va completando a medida que la app acumula cierres diarios."
            />
            {movers.worstWeek.length > 0 && (
              <p className="text-muted mt-2 px-1 text-[11px] leading-relaxed">
                Que algo haya caído no significa que sea mala compra: a veces es exactamente lo
                contrario. Esto es lo que bajó, no una recomendación de evitarlo.
              </p>
            )}
          </div>

          {movers.stale && movers.updatedAt && (
            <p className="text-muted px-1 text-[11px]">
              Cotizaciones del{' '}
              {new Date(movers.updatedAt).toLocaleDateString('es-AR', {
                day: '2-digit',
                month: '2-digit',
              })}
              : el mercado estuvo cerrado desde entonces.
            </p>
          )}
        </div>
      )}

      {past.length > 0 && (
        <details className="card px-5 py-3.5">
          <summary className="text-secondary cursor-pointer text-[13px]">
            Recomendaciones anteriores ({past.length})
          </summary>
          <ul className="mt-3 space-y-2.5">
            {past.map((rec) => (
              <li key={rec.id} className="flex items-center gap-2.5">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    rec.outcome_verdict === 'correcta'
                      ? 'bg-gain'
                      : rec.outcome_verdict === 'incorrecta'
                        ? 'bg-loss'
                        : 'bg-muted'
                  }`}
                  aria-hidden
                />
                <span className="text-primary text-[13px] font-semibold">{rec.symbol}</span>
                <span className="text-muted text-[12px]">{rec.action}</span>
                {rec.outcome_pct != null && (
                  <span className="tnum text-secondary ml-auto text-[12px]">
                    {formatPct(rec.outcome_pct, 1)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="text-muted text-center text-[11px] leading-relaxed">
        Las sugerencias que ya ejecutaste desaparecen solas.
        <br />
        Análisis generado por IA a partir de tu cartera y las noticias.
        <br />
        No es asesoramiento financiero — verificá antes de operar.
      </p>
    </div>
  )
}
