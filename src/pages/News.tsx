import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { EmptyState } from '@/components/ui/Card'
import { NewsCard } from '@/components/news/NewsCard'
import { useNews } from '@/hooks/useNews'
import { usePortfolio } from '@/hooks/usePortfolio'

export function News() {
  // El tag vive en la URL: así el link desde el Dashboard abre el feed ya filtrado
  const [params, setParams] = useSearchParams()
  const tag = params.get('tag')

  const { news, topics, loading } = useNews(tag)
  const { positions } = usePortfolio()

  const holdings = useMemo(
    () => new Set(positions.map((p) => p.symbol.toUpperCase())),
    [positions],
  )

  function selectTag(slug: string | null) {
    if (slug) setParams({ tag: slug })
    else setParams({})
  }

  const activeTopic = topics.find((t) => t.slug === tag)

  return (
    <div className="animate-fade-up space-y-4">
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        <button
          type="button"
          onClick={() => selectTag(null)}
          className={`shrink-0 rounded-full border px-3 py-1.5 text-[12px] transition-colors ${
            !tag
              ? 'border-accent bg-[rgba(139,92,246,0.12)] text-accent'
              : 'border-line bg-elevated text-secondary active:bg-hover'
          }`}
        >
          Todas
        </button>
        {topics.map((topic) => (
          <button
            key={topic.slug}
            type="button"
            onClick={() => selectTag(topic.slug)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] whitespace-nowrap transition-colors ${
              tag === topic.slug
                ? 'border-accent bg-[rgba(139,92,246,0.12)] text-accent'
                : 'border-line bg-elevated text-secondary active:bg-hover'
            }`}
          >
            {topic.emoji && <span aria-hidden>{topic.emoji}</span>}
            {topic.label}
          </button>
        ))}
      </div>

      {activeTopic?.description && (
        <p className="text-secondary text-[12px] leading-relaxed">{activeTopic.description}</p>
      )}

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-surface border-subtle h-[132px] animate-pulse rounded-2xl border" />
          ))}
        </div>
      ) : news.length === 0 ? (
        <EmptyState
          icon="📰"
          title={tag ? 'Nada en esta temática' : 'Feed vacío'}
          description={
            tag
              ? 'Todavía no hay noticias analizadas para este tema. Probá con otro filtro.'
              : 'El fetcher corre cada 30 minutos y solo guarda noticias que tocan alguna de tus temáticas. Si acabás de deployarlo, esperá la primera corrida.'
          }
        />
      ) : (
        <ul className="space-y-3">
          {news.map((item) => (
            <NewsCard key={item.id} item={item} holdings={holdings} />
          ))}
        </ul>
      )}
    </div>
  )
}
