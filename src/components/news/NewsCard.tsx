import type { NewsItem, Sentiment } from '@/lib/types'
import { formatRelativeTime } from '@/lib/format'

const SENTIMENT_STYLE: Record<Sentiment, { label: string; className: string }> = {
  positive: { label: 'Positiva', className: 'bg-gain-soft border-gain-line text-gain' },
  negative: { label: 'Negativa', className: 'bg-loss-soft border-loss-line text-loss' },
  neutral: { label: 'Neutral', className: 'border-line bg-elevated text-secondary' },
}

/** El titular llegó por RSS pero todavía nadie lo analizó con IA. */
const UNANALYZED = {
  label: 'Sin analizar',
  className: 'border-line text-muted border-dashed',
}

const IMPACT_LABEL = { high: 'Impacto alto', medium: 'Impacto medio', low: 'Impacto bajo' }

const SOURCE_LABEL: Record<string, string> = {
  ambito: 'Ámbito',
  cronista: 'Cronista',
  lanacion: 'La Nación',
  reuters: 'Reuters',
  cnbc: 'CNBC',
  yahoo: 'Yahoo Finance',
}

export function NewsCard({ item, holdings }: { item: NewsItem; holdings: Set<string> }) {
  // "Sin analizar" NO es lo mismo que "Neutral", y confundirlos hacía que la
  // app mintiera: cuando el análisis dejó de generarse, el feed entero se
  // mostró como si Claude lo hubiera leído y le hubiera parecido neutro.
  const sentiment = item.sentiment ? SENTIMENT_STYLE[item.sentiment] : UNANALYZED
  const symbols = item.related_symbols ?? []

  return (
    <li className="card p-5">
      <header className="text-muted flex items-center gap-2 text-[11px]">
        <span>{SOURCE_LABEL[item.source] ?? item.source}</span>
        <span aria-hidden>·</span>
        <time>{formatRelativeTime(item.published_at ?? item.created_at)}</time>
        {item.impact_level === 'high' && (
          <>
            <span aria-hidden>·</span>
            <span className="text-warning">{IMPACT_LABEL.high}</span>
          </>
        )}
      </header>

      <h3 className="font-display text-primary mt-2 text-[14px] leading-snug font-semibold">
        {item.url ? (
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="active:opacity-70">
            {item.title}
          </a>
        ) : (
          item.title
        )}
      </h3>

      {item.summary && (
        <p className="text-secondary mt-2 text-[13px] leading-relaxed">{item.summary}</p>
      )}

      <footer className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full border px-2.5 py-0.5 text-[11px] ${sentiment.className}`}
        >
          {sentiment.label}
        </span>

        {symbols.map((symbol) => {
          // Los activos que tenés en cartera se destacan: son los que te importan
          const owned = holdings.has(symbol.toUpperCase())
          return (
            <span
              key={symbol}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                owned
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line bg-elevated text-muted'
              }`}
              title={owned ? 'En tu cartera' : undefined}
            >
              {symbol}
            </span>
          )
        })}
      </footer>
    </li>
  )
}
