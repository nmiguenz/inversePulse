/**
 * Parser de feeds RSS 2.0 y Atom.
 *
 * Los feeds cambian de formato sin aviso, así que cada campo se busca en varias
 * ubicaciones posibles y nada acá tira excepciones: una fuente rota devuelve una
 * lista vacía y el resto del ciclo sigue.
 */
import { XMLParser } from 'npm:fast-xml-parser@5.10.1'

export type FeedItem = {
  title: string
  url: string
  snippet: string
  publishedAt: string | null
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
})

/** Los feeds mezclan strings, objetos con #text y arrays. Esto los aplana. */
function text(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return text(value[0])
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if ('#text' in obj) return text(obj['#text'])
    if ('@_href' in obj) return text(obj['@_href'])
  }
  return ''
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function toIso(raw: string): string | null {
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml) as Record<string, any>

  // RSS 2.0: rss > channel > item · Atom: feed > entry
  const rssItems = asArray(doc?.rss?.channel?.item)
  const atomItems = asArray(doc?.feed?.entry)
  const raw = rssItems.length ? rssItems : atomItems

  return raw
    .map((item): FeedItem => {
      const url = text(item.link) || text(item.guid) || text(item.id)
      const body =
        text(item.description) || text(item.summary) || text(item['content:encoded']) || text(item.content)

      return {
        title: stripHtml(text(item.title)),
        url: url.trim(),
        // Recortado: el modelo no necesita el artículo entero para clasificar,
        // y el snippet es lo que se paga como input tokens.
        snippet: stripHtml(body).slice(0, 400),
        publishedAt: toIso(text(item.pubDate) || text(item.published) || text(item.updated)),
      }
    })
    .filter((i) => i.title && i.url.startsWith('http'))
}

export async function fetchFeed(url: string): Promise<FeedItem[]> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'IOLPortfolioMonitor/1.0 (+rss)', Accept: 'application/rss+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return parseFeed(await res.text())
}
