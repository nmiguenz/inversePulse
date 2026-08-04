/**
 * analyze-opportunities — 2 veces por día en horario de mercado
 *
 * El spec pedía "cada 1 hora", pero las oportunidades que genera tienen
 * horizonte de semanas a meses (short = 1-4 semanas, medium = 1-6 meses).
 * Correr un modelo Opus 24 veces por día para revisar tesis de inversión a
 * meses cuesta ~US$65/mes y no aporta nada que no aporten 2 corridas.
 *
 * Además hay un corte antes de gastar: si no entraron noticias relevantes
 * nuevas desde el último análisis, no hay input nuevo y la corrida se saltea.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isServiceRole, unauthorized } from '../_shared/auth.ts'
import { analyzeOpportunities, OPPORTUNITY_MODEL } from '../_shared/claude.ts'
import { sendPush } from '../_shared/push.ts'

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

/** Cuántas noticias nuevas justifican volver a pagar un análisis. */
const MIN_NEW_NEWS = 3
/** Noticias que se le pasan al modelo como contexto. */
const NEWS_CONTEXT = 12

Deno.serve(async (req) => {
  if (!isServiceRole(req)) return unauthorized()
  if (!Deno.env.get('ANTHROPIC_API_KEY')) {
    return Response.json({ error: 'Falta el secret ANTHROPIC_API_KEY' }, { status: 500 })
  }

  const url = new URL(req.url)
  const force = url.searchParams.get('force') === 'true'

  const { data: users } = await db.from('users').select('id, settings, push_subscription')
  if (!users?.length) return Response.json({ error: 'sin usuarios' }, { status: 500 })

  const results: Record<string, unknown> = {}

  for (const user of users) {
    // ---------- Corte antes de gastar ----------
    const { data: lastRun } = await db
      .from('opportunities')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const since = lastRun?.created_at ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const { count: newNews } = await db
      .from('news')
      .select('id', { count: 'exact', head: true })
      .gt('created_at', since)

    if (!force && (newNews ?? 0) < MIN_NEW_NEWS) {
      results[user.id] = { skipped: `solo ${newNews ?? 0} noticias nuevas desde el último análisis` }
      continue
    }

    // ---------- Contexto ----------
    const [{ data: positions }, { data: balance }, { data: news }, { data: universe }] =
      await Promise.all([
        db
          .from('positions')
          .select('symbol, sector, quantity, current_price, market_value, gain_pct')
          .eq('user_id', user.id),
        db.from('account_balance').select('available_ars').eq('user_id', user.id).maybeSingle(),
        db
          .from('news')
          .select('title, summary, sentiment, related_symbols')
          .in('impact_level', ['high', 'medium'])
          .order('published_at', { ascending: false, nullsFirst: false })
          .limit(NEWS_CONTEXT),
        db
          .from('asset_metadata')
          .select('symbol, display_name, sector')
          .eq('suggestable', true),
      ])

    if (!positions?.length || !universe?.length) {
      results[user.id] = { error: 'faltan posiciones o universo de activos' }
      continue
    }

    const valueOf = (p: { market_value: number | null; quantity: number; current_price: number }) =>
      p.market_value || p.quantity * p.current_price
    const totalValue = positions.reduce((sum, p) => sum + valueOf(p), 0)
    const owned = new Set(positions.map((p) => p.symbol))

    let analysis
    try {
      analysis = await analyzeOpportunities({
        positions: positions.map((p) => ({
          symbol: p.symbol,
          sector: p.sector,
          value: valueOf(p),
          gainPct: p.gain_pct ?? 0,
          weight: totalValue > 0 ? (valueOf(p) / totalValue) * 100 : 0,
        })),
        totalValue,
        availableCash: balance?.available_ars ?? 0,
        news: (news ?? []).map((n) => ({
          title: n.title,
          summary: n.summary ?? '',
          sentiment: n.sentiment ?? 'neutral',
          symbols: n.related_symbols ?? [],
        })),
        universe: (universe ?? []).map((u) => ({
          symbol: u.symbol,
          name: u.display_name ?? u.symbol,
          sector: u.sector,
        })),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      results[user.id] = { error: message }
      console.error('[analyze-opportunities]', message)
      continue
    }

    const { opportunities, usage } = analysis

    if (!opportunities.length) {
      results[user.id] = { opportunities: 0, usage, note: 'el modelo no encontró nada con convicción' }
      continue
    }

    // ---------- Guardar ----------
    // Se desactivan las anteriores del mismo símbolo: la tesis vieja quedó vieja.
    const symbols = opportunities.map((o) => o.symbol)
    await db.from('opportunities').update({ is_active: false }).in('symbol', symbols).eq('is_active', true)

    // El precio actual sale de la base cuando el activo está en cartera; para el
    // resto queda null y el frontend muestra solo el estimado de crecimiento.
    const priceBySymbol = new Map(positions.map((p) => [p.symbol, p.current_price]))

    const { data: inserted, error } = await db
      .from('opportunities')
      .insert(
        opportunities.map((o) => {
          const current = priceBySymbol.get(o.symbol) ?? null
          return {
            symbol: o.symbol,
            opportunity_type: o.opportunity_type,
            title: o.title,
            reasoning: o.reasoning,
            growth_estimate_pct: o.growth_estimate_pct,
            confidence: o.confidence,
            time_horizon: o.time_horizon,
            current_price: current,
            target_price: current ? current * (1 + o.growth_estimate_pct / 100) : null,
            already_owned: owned.has(o.symbol),
            analyzed_with: OPPORTUNITY_MODEL,
            is_active: true,
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          }
        }),
      )
      .select('id, symbol, confidence, title, growth_estimate_pct')

    if (error) {
      results[user.id] = { error: error.message, usage }
      continue
    }

    // ---------- Alerta solo para alta convicción ----------
    let pushed = 0
    for (const opp of inserted ?? []) {
      if (opp.confidence !== 'high') continue

      const { data: alert } = await db
        .from('alerts')
        .insert({
          user_id: user.id,
          alert_type: 'opportunity_buy',
          symbol: opp.symbol,
          title: `Oportunidad — ${opp.symbol}`,
          message: opp.title,
          severity: 'opportunity',
          action_suggested: `Ver análisis de ${opp.symbol}`,
        })
        .select('id')
        .single()

      if (user.push_subscription && alert) {
        const ok = await sendPush(db, user.id, user.push_subscription, {
          title: `Oportunidad — ${opp.symbol}`,
          body: `${opp.title} · estimado ${opp.growth_estimate_pct > 0 ? '+' : ''}${opp.growth_estimate_pct}%`,
          tag: `opp-${opp.id}`,
          url: '/oportunidades',
          alertId: alert.id,
          severity: 'opportunity',
        })
        if (ok) {
          pushed++
          await db.from('alerts').update({ push_sent: true }).eq('id', alert.id)
        }
      }
    }

    results[user.id] = {
      opportunities: inserted?.length ?? 0,
      symbols: inserted?.map((o) => `${o.symbol} (${o.confidence})`),
      pushed,
      usage,
    }
  }

  return Response.json({ ok: true, results })
})
