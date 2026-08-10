import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { uniqueChannelName } from '@/lib/realtime'
import type { NewsItem, WorldTopic } from '@/lib/types'

/**
 * Feed de noticias + temáticas.
 *
 * A diferencia de las alertas, esto se consume en una sola pantalla, así que un
 * hook alcanza — no hace falta un provider compartido. El filtro por tag va en
 * la query (GIN sobre `tags`), no en el cliente: el feed puede crecer y no tiene
 * sentido bajar todo para descartarlo en el browser.
 */
export function useNews(tag: string | null) {
  const { session } = useAuth()
  const [news, setNews] = useState<NewsItem[]>([])
  const [topics, setTopics] = useState<WorldTopic[]>([])
  const [loading, setLoading] = useState(true)
  const channelName = useRef(uniqueChannelName('news-feed'))

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !session) {
      setLoading(false)
      return
    }

    // El artículo sale del RSS y es común a todos; el análisis —resumen,
    // sentimiento, símbolos— lo genera cada usuario con SU key y vive aparte.
    // El embed trae solo el propio: RLS filtra `news_analysis` por user_id.
    let query = supabase
      .from('news')
      .select(
        'id, title, source, url, published_at, created_at, ' +
          'news_analysis(summary, sentiment, impact_level, related_symbols, tags)',
      )
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(60)

    // El filtro por tag vive en el análisis. Con `!inner` un usuario sin key no
    // ve nada al filtrar, que es correcto: sin análisis no hay temática.
    if (tag) {
      query = supabase
        .from('news')
        .select(
          'id, title, source, url, published_at, created_at, ' +
            'news_analysis!inner(summary, sentiment, impact_level, related_symbols, tags)',
        )
        .contains('news_analysis.tags', [tag])
        .order('published_at', { ascending: false, nullsFirst: false })
        .limit(60)
    }

    const [newsRes, topicsRes] = await Promise.all([
      query,
      supabase
        .from('world_topics')
        .select('slug, label, emoji, description, sort_order')
        .eq('is_active', true)
        .order('sort_order'),
    ])

    if (newsRes.error) console.error('[news] no se pudo cargar el feed:', newsRes.error.message)

    // Aplanar el embed: la pantalla no tiene por qué saber que el análisis vive
    // en otra tabla. Sin análisis quedan en null y se ve el titular pelado.
    type Row = Omit<NewsItem, 'summary' | 'sentiment' | 'impact_level' | 'related_symbols' | 'tags'> & {
      news_analysis: Array<Pick<NewsItem, 'summary' | 'sentiment' | 'impact_level' | 'related_symbols' | 'tags'>> | null
    }

    setNews(
      ((newsRes.data ?? []) as unknown as Row[]).map(({ news_analysis, ...item }) => ({
        ...item,
        summary: news_analysis?.[0]?.summary ?? null,
        sentiment: news_analysis?.[0]?.sentiment ?? null,
        impact_level: news_analysis?.[0]?.impact_level ?? null,
        related_symbols: news_analysis?.[0]?.related_symbols ?? null,
        tags: news_analysis?.[0]?.tags ?? null,
      })),
    )
    setTopics((topicsRes.data ?? []) as WorldTopic[])
    setLoading(false)
  }, [session, tag])

  useEffect(() => {
    void load()
  }, [load])

  // El CRON inserta cada 30 min; realtime evita tener que recargar a mano
  useEffect(() => {
    if (!isSupabaseConfigured || !session) return

    const channel = supabase
      .channel(channelName.current)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'news' }, () => void load())
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [session, load])

  return { news, topics, loading, reload: load }
}
