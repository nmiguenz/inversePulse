/**
 * fetch-news — cada 30 min
 *
 * 1. Baja los feeds RSS habilitados
 * 2. Descarta lo que ya está en `news` (url es UNIQUE: nada se analiza dos veces)
 * 3. PRE-FILTRO por keywords de world_topics — lo que no matchea NUNCA llega a Claude
 * 4. Analiza lo que sobrevive, en lotes, con Sonnet
 * 5. Inserta en `news`
 * 6. Noticia negativa + impacto alto + activo en cartera → alerta + push
 *
 * El pre-filtro del paso 3 es la medida de costo principal: sin él, esto haría
 * miles de llamadas por día sobre noticias que no le interesan al usuario.
 *
 * Requiere el secret ANTHROPIC_API_KEY.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isServiceRole, unauthorized } from '../_shared/auth.ts'
import { fetchFeed, type FeedItem } from '../_shared/rss.ts'
import { analyzeNews, NEWS_MODEL, type NewsAnalysis } from '../_shared/claude.ts'
import { sendPush } from '../_shared/push.ts'

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

/** Tope duro por corrida: un día raro no puede disparar la factura. */
const MAX_ANALYZE_PER_RUN = 40
/** Noticias por request a Claude. */
const BATCH_SIZE = 10

type Topic = { slug: string; label: string; keywords: string[] }

/**
 * ¿La noticia toca alguna temática que le interesa al usuario?
 * Se corre ANTES de cualquier llamada a la API — es lo que hace que esto sea barato.
 * Las keywords cortas (<= 3 chars, tipo "IA" o "Fed") se matchean con límite de
 * palabra para no dar falsos positivos dentro de otras palabras.
 */
function matchesTopics(item: FeedItem, topics: Topic[]): boolean {
  const haystack = `${item.title} ${item.snippet}`.toLowerCase()

  return topics.some((topic) =>
    topic.keywords.some((keyword) => {
      const k = keyword.trim().toLowerCase()
      if (!k) return false
      if (k.length <= 3) return new RegExp(`(^|[^\\p{L}])${k}([^\\p{L}]|$)`, 'u').test(haystack)
      return haystack.includes(k)
    }),
  )
}

Deno.serve(async (req) => {
  if (!isServiceRole(req)) return unauthorized()
  if (!Deno.env.get('ANTHROPIC_API_KEY')) {
    return Response.json({ error: 'Falta el secret ANTHROPIC_API_KEY' }, { status: 500 })
  }

  const [{ data: sources }, { data: topicRows }, { data: users }] = await Promise.all([
    db.from('rss_sources').select('*').eq('enabled', true),
    db.from('world_topics').select('slug, label, keywords').eq('is_active', true),
    db.from('users').select('id, settings, push_subscription'),
  ])

  const topics = (topicRows ?? []) as Topic[]
  if (!sources?.length || !topics.length) {
    return Response.json({ error: 'Faltan rss_sources o world_topics' }, { status: 500 })
  }

  // Símbolos que el usuario realmente tiene — alimentan el prompt y validan las alertas
  const { data: positions } = await db.from('positions').select('user_id, symbol, description')
  const holdings = [...new Set((positions ?? []).map((p) => p.symbol))]

  // ---------- 1. Bajar los feeds ----------
  const stats = {
    fetched: 0,
    alreadyKnown: 0,
    filteredOut: 0,
    relevant: 0,
    sentToClaude: 0,
    analyzed: 0,
    inserted: 0,
    alerts: 0,
  }
  const sourceResults: Record<string, string> = {}
  const candidates: Array<FeedItem & { source: string }> = []

  for (const source of sources) {
    try {
      const items = await fetchFeed(source.url)
      stats.fetched += items.length
      sourceResults[source.slug] = `${items.length} items`
      for (const item of items) candidates.push({ ...item, source: source.slug })

      await db
        .from('rss_sources')
        .update({ last_fetched_at: new Date().toISOString(), last_error: null })
        .eq('id', source.id)
    } catch (err) {
      // Una fuente rota no puede tumbar el ciclo entero
      const message = err instanceof Error ? err.message : String(err)
      sourceResults[source.slug] = `error: ${message}`
      await db.from('rss_sources').update({ last_error: message }).eq('id', source.id)
      console.error(`[fetch-news] ${source.slug}:`, message)
    }
  }

  // ---------- 2. Dedupe: dentro de la corrida y contra lo ya guardado ----------
  const byUrl = new Map(candidates.map((c) => [c.url, c]))
  const urls = [...byUrl.keys()]

  const known = new Set<string>()
  for (let i = 0; i < urls.length; i += 200) {
    const { data } = await db.from('news').select('url').in('url', urls.slice(i, i + 200))
    for (const row of data ?? []) if (row.url) known.add(row.url)
  }

  const fresh = [...byUrl.values()].filter((c) => !known.has(c.url))
  stats.alreadyKnown = byUrl.size - fresh.length

  // ---------- 3. PRE-FILTRO: acá se decide qué cuesta plata ----------
  const relevant = fresh.filter((item) => matchesTopics(item, topics))
  stats.filteredOut = fresh.length - relevant.length

  const toAnalyze = relevant.slice(0, MAX_ANALYZE_PER_RUN)
  stats.relevant = relevant.length
  stats.sentToClaude = toAnalyze.length

  // ---------- 4. Analizar en lotes ----------
  const analyzedRows: Array<Record<string, unknown>> = []
  const alertPayloads: Array<{ analysis: NewsAnalysis; item: FeedItem & { source: string } }> = []
  const errors: string[] = []

  for (let i = 0; i < toAnalyze.length; i += BATCH_SIZE) {
    const batch = toAnalyze.slice(i, i + BATCH_SIZE)
    const inputs = batch.map((item, idx) => ({
      index: idx,
      title: item.title,
      source: item.source,
      snippet: item.snippet,
    }))

    let analyses: NewsAnalysis[] = []
    try {
      analyses = await analyzeNews(inputs, topics, holdings)
      stats.analyzed += analyses.length
    } catch (err) {
      // Un lote que falla no debe desaparecer sin dejar rastro en la respuesta
      const message = err instanceof Error ? err.message : String(err)
      errors.push(message)
      console.error('[fetch-news] análisis falló:', message)
      continue
    }

    for (const analysis of analyses) {
      const item = batch[analysis.index]
      if (!item) continue

      analyzedRows.push({
        title: item.title,
        source: item.source,
        url: item.url,
        summary: analysis.summary,
        sentiment: analysis.sentiment,
        impact_level: analysis.impact_level,
        related_symbols: analysis.related_symbols,
        tags: analysis.tags,
        published_at: item.publishedAt,
        analyzed_with: NEWS_MODEL,
        analyzed_at: new Date().toISOString(),
      })

      if (analysis.sentiment === 'negative' && analysis.impact_level === 'high') {
        alertPayloads.push({ analysis, item })
      }
    }
  }

  if (analyzedRows.length) {
    const { error } = await db.from('news').upsert(analyzedRows, { onConflict: 'url' })
    if (error) {
      errors.push(`insert: ${error.message}`)
      console.error('[fetch-news] insert:', error.message)
    } else {
      stats.inserted = analyzedRows.length
    }
  }

  // ---------- 5. Alertas por noticias negativas sobre activos en cartera ----------
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  for (const user of users ?? []) {
    // Solo los símbolos de ESTE usuario: una alerta sobre un activo que no tiene no sirve
    const userSymbols = new Set(
      (positions ?? []).filter((p) => p.user_id === user.id).map((p) => p.symbol),
    )
    if (!userSymbols.size) continue

    const { data: recent } = await db
      .from('alerts')
      .select('symbol')
      .eq('user_id', user.id)
      .eq('alert_type', 'news_negative')
      .gte('created_at', since)
    const alertedToday = new Set((recent ?? []).map((a) => a.symbol))

    for (const { analysis, item } of alertPayloads) {
      // Validación contra alucinaciones: solo símbolos que el usuario realmente tiene.
      // Un ticker inventado por el modelo no puede generar una alerta.
      const hits = analysis.related_symbols.filter((s) => userSymbols.has(s.toUpperCase()))
      if (!hits.length) continue

      for (const symbol of hits) {
        if (alertedToday.has(symbol)) continue
        alertedToday.add(symbol)

        const { data: inserted } = await db
          .from('alerts')
          .insert({
            user_id: user.id,
            alert_type: 'news_negative',
            symbol,
            title: `Noticia negativa — ${symbol}`,
            message: analysis.summary,
            severity: 'warning',
            action_suggested: `Revisar posición en ${symbol}`,
          })
          .select('id')
          .single()

        stats.alerts++

        if (user.push_subscription && inserted) {
          const ok = await sendPush(db, user.id, user.push_subscription, {
            title: `Noticia negativa — ${symbol}`,
            body: item.title,
            tag: `news-${symbol}`,
            url: '/noticias',
            alertId: inserted.id,
            severity: 'warning',
          })
          if (ok) await db.from('alerts').update({ push_sent: true }).eq('id', inserted.id)
        }
      }
    }
  }

  // `sentToClaude` sobre `fetched` es la métrica de costo: si se parecen, el
  // pre-filtro no está filtrando y hay que revisar las keywords.
  return Response.json({
    ok: errors.length === 0,
    stats,
    sources: sourceResults,
    ...(errors.length ? { errors: errors.slice(0, 5) } : {}),
  })
})
