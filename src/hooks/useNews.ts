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

    let query = supabase
      .from('news')
      .select('*')
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(60)

    if (tag) query = query.contains('tags', [tag])

    const [newsRes, topicsRes] = await Promise.all([
      query,
      supabase
        .from('world_topics')
        .select('slug, label, emoji, description, sort_order')
        .eq('is_active', true)
        .order('sort_order'),
    ])

    if (newsRes.error) console.error('[news] no se pudo cargar el feed:', newsRes.error.message)

    setNews((newsRes.data ?? []) as NewsItem[])
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
