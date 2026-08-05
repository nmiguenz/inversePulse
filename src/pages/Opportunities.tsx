import { useCallback, useEffect, useRef, useState } from 'react'
import { EmptyState } from '@/components/ui/Card'
import { OpportunityCard } from '@/components/opportunities/OpportunityCard'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { uniqueChannelName } from '@/lib/realtime'
import type { Opportunity } from '@/lib/types'

export function Opportunities() {
  const { session } = useAuth()
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [loading, setLoading] = useState(true)
  const channelName = useRef(uniqueChannelName('opportunities-feed'))

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !session) {
      setLoading(false)
      return
    }

    // Solo las vigentes: una tesis de hace dos semanas ya no es accionable
    const { data, error } = await supabase
      .from('opportunities')
      .select('*')
      .eq('is_active', true)
      .order('confidence')
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) console.error('[opportunities]', error.message)
    setOpportunities((data ?? []) as Opportunity[])
    setLoading(false)
  }, [session])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!isSupabaseConfigured || !session) return

    const channel = supabase
      .channel(channelName.current)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'opportunities' }, () => void load())
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [session, load])

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1].map((i) => (
          <div key={i} className="card h-[180px] animate-pulse" />
        ))}
      </div>
    )
  }

  if (!opportunities.length) {
    return (
      <div className="animate-fade-up">
        <EmptyState
          icon="🚀"
          title="Sin oportunidades vigentes"
          description="El análisis corre dos veces por día y solo guarda ideas con convicción real. Que no haya nada acá significa que hoy no vio nada que justifique mover plata."
        />
      </div>
    )
  }

  return (
    <div className="animate-fade-up space-y-4">
      <ul className="space-y-3">
        {opportunities.map((opportunity) => (
          <OpportunityCard key={opportunity.id} opportunity={opportunity} />
        ))}
      </ul>

      <p className="text-muted text-center text-[11px] leading-relaxed">
        Análisis generado por IA a partir de tu cartera y las noticias recientes.
        <br />
        No es asesoramiento financiero — verificá antes de operar.
      </p>
    </div>
  )
}
