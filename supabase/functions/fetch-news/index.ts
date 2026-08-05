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
/** Tope de notificaciones por corrida: el celular no puede vibrar 8 veces seguidas. */
const MAX_NEWS_ALERTS_PER_RUN = 3

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

  // En paralelo: en serie, 7 fuentes × hasta 15s de timeout consumían casi todo
  // el presupuesto de 150s de la Edge Function antes de llamar a Claude.
  const feeds = await Promise.allSettled(sources.map((source) => fetchFeed(source.url)))

  for (const [i, result] of feeds.entries()) {
    const source = sources[i]

    if (result.status === 'rejected') {
      // Una fuente rota no puede tumbar el ciclo entero
      const message =
        result.reason instanceof Error ? result.reason.message : String(result.reason)
      sourceResults[source.slug] = `error: ${message}`
      await db.from('rss_sources').update({ last_error: message }).eq('id', source.id)
      console.error(`[fetch-news] ${source.slug}:`, message)
      continue
    }

    stats.fetched += result.value.length
    sourceResults[source.slug] = `${result.value.length} items`
    for (const item of result.value) candidates.push({ ...item, source: source.slug })

    await db
      .from('rss_sources')
      .update({ last_fetched_at: new Date().toISOString(), last_error: null })
      .eq('id', source.id)
  }

  // ---------- 2. Dedupe: dentro de la corrida y contra lo ya guardado ----------
  const byUrl = new Map(candidates.map((c) => [c.url, c]))

  // Se traen las URLs conocidas y se comparan en memoria. NO se filtra con
  // .in('url', [...]): eso mete cada URL en el query string y ~100 URLs ya
  // superan los 13KB, así que la request falla y el dedupe deja de funcionar
  // en silencio — re-analizando (y re-pagando) las mismas noticias por siempre.
  // Los feeds solo traen items recientes, así que 30 días alcanzan de sobra.
  const knownSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data: knownRows, error: knownError } = await db
    .from('news')
    .select('url')
    .gte('created_at', knownSince)
    .limit(10000)

  if (knownError) {
    // Sin dedupe confiable no se analiza nada: es preferible una corrida vacía
    // a pagar de nuevo por noticias que ya están en la base.
    return Response.json(
      { ok: false, error: `dedupe falló, se aborta para no re-analizar: ${knownError.message}` },
      { status: 500 },
    )
  }

  const known = new Set((knownRows ?? []).map((r) => r.url).filter(Boolean))
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

  // Los lotes van EN PARALELO: en serie, 4 llamadas más los fetches de RSS
  // superan el timeout de 150s de las Edge Functions y se pierde la corrida
  // entera (incluido lo ya analizado, que igual se pagó).
  const batches: Array<typeof toAnalyze> = []
  for (let i = 0; i < toAnalyze.length; i += BATCH_SIZE) {
    batches.push(toAnalyze.slice(i, i + BATCH_SIZE))
  }

  const settled = await Promise.allSettled(
    batches.map((batch) =>
      analyzeNews(
        batch.map((item, idx) => ({
          index: idx,
          title: item.title,
          source: item.source,
          snippet: item.snippet,
        })),
        topics,
        holdings,
      ),
    ),
  )

  for (const [batchIndex, result] of settled.entries()) {
    const batch = batches[batchIndex]

    if (result.status === 'rejected') {
      const message =
        result.reason instanceof Error ? result.reason.message : String(result.reason)
      errors.push(message)
      console.error('[fetch-news] análisis falló:', message)
      continue
    }

    stats.analyzed += result.value.length

    for (const analysis of result.value) {
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
  //
  // UNA alerta por NOTICIA, no por símbolo. Una sola nota sobre la Fed puede
  // tocar 6 CEDEARs; con una alerta por símbolo el celular vibra 6 veces por la
  // misma noticia. El artículo ya está deduplicado por URL (se analiza una sola
  // vez en su vida), así que no hace falta un dedupe extra por símbolo — y ese
  // dedupe además suprimía noticias DISTINTAS sobre el mismo activo.
  for (const user of users ?? []) {
    // Solo los símbolos de ESTE usuario: una alerta sobre un activo que no tiene no sirve
    const userSymbols = new Set(
      (positions ?? []).filter((p) => p.user_id === user.id).map((p) => p.symbol),
    )
    if (!userSymbols.size) continue

    let sentThisRun = 0

    for (const { analysis, item } of alertPayloads) {
      // Validación contra alucinaciones: solo símbolos que el usuario realmente
      // tiene. Un ticker inventado por el modelo no puede generar una alerta.
      const hits = [...new Set(analysis.related_symbols.map((s) => s.toUpperCase()))].filter((s) =>
        userSymbols.has(s),
      )
      if (!hits.length) continue

      // Tope por corrida: un día de mucha noticia mala no puede convertirse en
      // una ráfaga de notificaciones.
      if (sentThisRun >= MAX_NEWS_ALERTS_PER_RUN) break
      sentThisRun++

      const label = hits.join(', ')
      const { data: inserted } = await db
        .from('alerts')
        .insert({
          user_id: user.id,
          alert_type: 'news_negative',
          symbol: hits[0], // la lista completa va en el mensaje
          title: `Noticia negativa — ${label}`,
          message: `${analysis.summary}\n\n${item.title}`,
          severity: 'warning',
          action_suggested: `Revisar ${label}`,
        })
        .select('id')
        .single()

      stats.alerts++

      if (user.push_subscription && inserted) {
        const ok = await sendPush(db, user.id, user.push_subscription, {
          title: `Noticia negativa — ${label}`,
          body: item.title,
          // tag por artículo: si llegan dos push de la misma noticia, el
          // segundo reemplaza al primero en vez de apilarse
          tag: `news-${inserted.id}`,
          url: '/noticias',
          alertId: inserted.id,
          severity: 'warning',
        })
        if (ok) await db.from('alerts').update({ push_sent: true }).eq('id', inserted.id)
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
