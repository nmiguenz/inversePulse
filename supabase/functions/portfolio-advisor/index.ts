/**
 * portfolio-advisor — 2 veces por día en horario de mercado
 *
 * Produce ACCIONES sobre la cartera (comprar, reducir, vender, rebalancear) y
 * las guarda con el precio del momento, para poder medir después si acertaron.
 *
 * Se saltea solo si no hay input nuevo: sin noticias nuevas desde el último
 * análisis, volver a preguntar cuesta plata y devuelve lo mismo.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isServiceRole, unauthorized } from '../_shared/auth.ts'
import { advise, OPPORTUNITY_MODEL, type Recommendation } from '../_shared/claude.ts'
import { sendPush } from '../_shared/push.ts'

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

const MIN_NEW_NEWS = 3
const NEWS_CONTEXT = 12
/** Solo alta convicción notifica, y con tope: no queremos empujar a sobre-operar. */
const MAX_PUSH_PER_RUN = 2

/** Tendencia de 30 días en una palabra, para no gastar tokens en la serie entera */
function trend(prices: number[]): string {
  if (prices.length < 2) return 'sin histórico'
  const change = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100
  const label = change > 8 ? 'subiendo fuerte' : change > 2 ? 'subiendo' : change < -8 ? 'cayendo fuerte' : change < -2 ? 'cayendo' : 'lateral'
  return `${label} (${change > 0 ? '+' : ''}${change.toFixed(1)}%)`
}

Deno.serve(async (req) => {
  if (!isServiceRole(req)) return unauthorized()
  if (!Deno.env.get('ANTHROPIC_API_KEY')) {
    return Response.json({ error: 'Falta el secret ANTHROPIC_API_KEY' }, { status: 500 })
  }

  // Chequeo barato ANTES de gastar: si la tabla destino no existe, la llamada a
  // Opus se paga igual y el resultado se tira. Ya pasó una vez.
  const { error: schemaError } = await db.from('recommendations').select('id').limit(1)
  if (schemaError) {
    return Response.json(
      { error: `No se puede escribir en recommendations: ${schemaError.message}. ¿Corriste 0009_advisor.sql?` },
      { status: 500 },
    )
  }

  const force = new URL(req.url).searchParams.get('force') === 'true'
  const { data: users } = await db.from('users').select('id, settings, push_subscription')
  const results: Record<string, unknown> = {}

  for (const user of users ?? []) {
    // ---------- Corte antes de gastar ----------
    const { data: last } = await db
      .from('recommendations')
      .select('created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const since = last?.created_at ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { count: newNews } = await db
      .from('news')
      .select('id', { count: 'exact', head: true })
      .gt('created_at', since)

    if (!force && (newNews ?? 0) < MIN_NEW_NEWS) {
      results[user.id] = { skipped: `${newNews ?? 0} noticias nuevas, no alcanza` }
      continue
    }

    // ---------- Contexto ----------
    const [{ data: positions }, { data: balance }, { data: news }, { data: universe }, { data: history }] =
      await Promise.all([
        db
          .from('positions')
          .select(
            'symbol, sector, asset_type, rescue_time, quantity, current_price, previous_close, market_value, gain_pct',
          )
          .eq('user_id', user.id),
        db.from('account_balance').select('available_ars, available_to_trade_ars').eq('user_id', user.id).maybeSingle(),
        db
          .from('news')
          .select('title, summary, sentiment, related_symbols')
          .in('impact_level', ['high', 'medium'])
          .order('published_at', { ascending: false, nullsFirst: false })
          .limit(NEWS_CONTEXT),
        db.from('asset_metadata').select('symbol, display_name, sector').eq('suggestable', true),
        db
          .from('price_history')
          .select('symbol, close_price, recorded_at')
          .gte('recorded_at', new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10))
          .order('recorded_at'),
      ])

    if (!positions?.length || !universe?.length) {
      results[user.id] = { error: 'faltan posiciones o universo' }
      continue
    }

    const settings = (user.settings ?? {}) as Record<string, number>
    const valueOf = (p: { market_value: number | null; quantity: number; current_price: number }) =>
      p.market_value || p.quantity * p.current_price
    const totalValue = positions.reduce((s, p) => s + valueOf(p), 0)
    // disponibleOperar es lo que se puede ejecutar de verdad; available_ars
    // puede incluir plata que todavía no liquidó
    const availableCash = balance?.available_to_trade_ars ?? balance?.available_ars ?? 0

    const seriesBySymbol = new Map<string, number[]>()
    for (const row of history ?? []) {
      const list = seriesBySymbol.get(row.symbol) ?? []
      list.push(row.close_price)
      seriesBySymbol.set(row.symbol, list)
    }

    const priceBySymbol = new Map(positions.map((p) => [p.symbol, p.current_price]))
    const sectorTotals = new Map<string, number>()
    for (const p of positions) sectorTotals.set(p.sector, (sectorTotals.get(p.sector) ?? 0) + valueOf(p))

    // Composición por tipo: es lo que le permite ver que hay una porción
    // grande en fondos comunes mientras el objetivo es que la cartera crezca
    const typeTotals = new Map<string, number>()
    for (const p of positions) {
      typeTotals.set(p.asset_type, (typeTotals.get(p.asset_type) ?? 0) + valueOf(p))
    }

    // El piso de liquidez: efectivo más lo que rescata en el día. Es lo que
    // hace que "si necesitás efectivo" funcione y lo que financia las metas
    // con fecha cercana, así que el asesor no puede proponer tocarlo.
    // Solo money market de verdad. El plazo de rescate NO alcanza: PCOMAGB
    // rescata T+0 y es un fondo de commodities, con +15,85% acumulado — eso
    // no es caja, es un activo de riesgo que además se puede vender rápido.
    //
    // Va en su propia consulta porque `universe` filtra por `suggestable`, y
    // los FCI están en false: leerlo de ahí daría un conjunto vacío.
    const { data: cashFunds } = await db
      .from('asset_metadata')
      .select('symbol')
      .eq('is_cash_equivalent', true)

    const cashEquivalents = new Set((cashFunds ?? []).map((u) => u.symbol))
    const sameDayFunds = positions
      .filter((p) => cashEquivalents.has(p.symbol))
      .reduce((sum, p) => sum + valueOf(p), 0)
    const liquidityFloor = availableCash + sameDayFunds

    let analysis
    try {
      analysis = await advise({
        positions: positions.map((p) => ({
          symbol: p.symbol,
          sector: p.sector,
          value: valueOf(p),
          gainPct: p.gain_pct ?? 0,
          dayPct:
            p.previous_close > 0 ? ((p.current_price - p.previous_close) / p.previous_close) * 100 : 0,
          weight: totalValue > 0 ? (valueOf(p) / totalValue) * 100 : 0,
          trend30d: trend(seriesBySymbol.get(p.symbol) ?? []),
        })),
        totalValue,
        availableCash,
        news: (news ?? []).map((n) => ({
          title: n.title,
          summary: n.summary ?? '',
          sentiment: n.sentiment ?? 'neutral',
          symbols: n.related_symbols ?? [],
        })),
        universe: universe.map((u) => ({
          symbol: u.symbol,
          name: u.display_name ?? u.symbol,
          sector: u.sector,
          price: priceBySymbol.get(u.symbol) ?? null,
        })),
        settings: {
          rebalance_pct: settings.rebalance_pct ?? 15,
          sector_concentration_pct: settings.sector_concentration_pct ?? 50,
          take_profit_pct: settings.take_profit_pct ?? 20,
        },
        sectorWeights: [...sectorTotals.entries()].map(([sector, v]) => ({
          sector,
          pct: totalValue > 0 ? (v / totalValue) * 100 : 0,
        })),
        typeWeights: [...typeTotals.entries()].map(([type, v]) => ({
          type,
          value: v,
          pct: totalValue > 0 ? (v / totalValue) * 100 : 0,
        })),
        liquidityFloor,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      results[user.id] = { error: message }
      console.error('[advisor]', message)
      continue
    }

    const { recommendations, usage } = analysis
    if (!recommendations.length) {
      results[user.id] = { recommendations: 0, usage }
      continue
    }

    // El monto sugerido no puede superar el efectivo real, diga lo que diga el
    // modelo: es la única validación que protege plata de verdad.
    const clean = recommendations.map((r: Recommendation) => {
      const isBuy = r.action === 'buy' || r.action === 'add'
      const amount =
        isBuy && r.suggested_amount_ars
          ? Math.min(r.suggested_amount_ars, availableCash)
          : r.suggested_amount_ars
      const price = priceBySymbol.get(r.symbol) ?? null
      return { ...r, amount, price }
    })

    // Las anteriores del mismo activo quedan viejas
    await db
      .from('recommendations')
      .update({ is_active: false })
      .eq('user_id', user.id)
      .in('symbol', clean.map((r) => r.symbol))
      .eq('is_active', true)

    const { data: inserted, error } = await db
      .from('recommendations')
      .insert(
        clean.map((r) => ({
          user_id: user.id,
          action: r.action,
          symbol: r.symbol,
          counterpart_symbol: r.counterpart_symbol,
          title: r.title,
          reasoning: r.reasoning,
          confidence: r.confidence,
          time_horizon: r.time_horizon,
          suggested_amount: r.amount,
          suggested_quantity: r.amount && r.price ? Math.floor(r.amount / r.price) : null,
          realizes_loss: r.realizes_loss,
          price_at_recommendation: r.price,
          analyzed_with: OPPORTUNITY_MODEL,
          is_active: true,
          expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
        })),
      )
      .select('id, action, symbol, confidence, title')

    if (error) {
      results[user.id] = { error: error.message, usage }
      continue
    }

    // ---------- Notificación: solo alta convicción ----------
    let pushed = 0
    for (const rec of inserted ?? []) {
      if (rec.confidence !== 'high' || rec.action === 'hold') continue
      if (pushed >= MAX_PUSH_PER_RUN) break

      const { data: alert } = await db
        .from('alerts')
        .insert({
          user_id: user.id,
          alert_type: rec.action === 'buy' || rec.action === 'add' ? 'opportunity_buy' : 'advisor_sell',
          symbol: rec.symbol,
          title: rec.title,
          message: `El asesor sugiere ${rec.action === 'buy' ? 'comprar' : rec.action === 'add' ? 'ampliar' : rec.action === 'trim' ? 'reducir' : rec.action === 'sell' ? 'vender' : 'rebalancear'} ${rec.symbol}.`,
          severity: 'opportunity',
          action_suggested: `Ver análisis de ${rec.symbol}`,
        })
        .select('id')
        .single()

      const notifies = (user.settings as Record<string, unknown>)?.notify_opportunities !== false
      if (user.push_subscription && alert && notifies) {
        const ok = await sendPush(db, user.id, user.push_subscription, {
          title: rec.title,
          body: `Convicción alta · ${rec.symbol}`,
          tag: `rec-${rec.id}`,
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
      recommendations: inserted?.length ?? 0,
      detail: inserted?.map((r) => `${r.action} ${r.symbol} (${r.confidence})`),
      pushed,
      usage,
    }
  }

  return Response.json({ ok: true, results })
})
