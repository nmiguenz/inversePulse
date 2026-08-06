/**
 * goal-advisor — domingos, y a pedido desde la app
 *
 * Arma el plan de compra de cada meta: qué comprar, con el horizonte acotado
 * por la fecha del objetivo.
 *
 * ── Lo que esta función NO hace ──────────────────────────────────────────
 *
 * No busca la forma de cumplir una meta imposible. Si el objetivo pide 70.000%
 * anual, el plan no se vuelve más agresivo: dice que no entra y propone lo
 * sensato para el plazo. Perseguir un objetivo inalcanzable subiendo el riesgo
 * es exactamente cómo se pierde el capital, y el usuario fue explícito en que
 * no quiere descapitalizarse.
 *
 * ── Autenticación ────────────────────────────────────────────────────────
 *
 * Es la única function con dos caminos: la service role key para el cron (que
 * procesa todas las metas) y el JWT del usuario para el botón de la app (que
 * procesa una sola). Cada llamada es una request a Opus, así que el camino de
 * usuario tiene límite de una por meta por hora.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { adviseForGoal, type AdvisorContext, type GoalContext } from '../_shared/claude.ts'
import { isServiceRole, userIdFromJwt } from '../_shared/auth.ts'

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

/** Mínimo entre dos generaciones a pedido de la misma meta. */
const COOLDOWN_MINUTES = 60

/**
 * La misma matemática que `src/lib/goals.ts`, que es la canónica.
 *
 * Está duplicada porque el bundler de Supabase solo sube lo que cuelga de
 * supabase/functions y no puede importar desde src/. Si cambian las bandas,
 * hay que tocar los dos lados.
 */
const HISTORICAL_RATE = 10

function daysUntil(date: string | null): number | null {
  if (!date) return null
  const target = new Date(`${date}T12:00:00-03:00`).getTime()
  if (Number.isNaN(target)) return null
  const now = new Date()
  const todayNoon = new Date(
    `${now.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })}T12:00:00-03:00`,
  ).getTime()
  return Math.round((target - todayNoon) / 864e5)
}

function requiredReturn(current: number, target: number | null, days: number | null): number | null {
  if (!target || target <= 0) return null
  if (days === null || days <= 0) return null
  if (current <= 0) return null
  if (current >= target) return 0
  return (Math.pow(target / current, 365 / days) - 1) * 100
}

function difficultyBand(pct: number): string {
  if (pct <= 10) return 'comodo'
  if (pct <= 20) return 'exigente'
  if (pct <= 40) return 'dificil'
  if (pct <= 100) return 'improbable'
  return 'inalcanzable'
}

/** Contexto de cartera, el mismo que usa el asesor general */
async function buildAdvisorContext(userId: string): Promise<AdvisorContext | null> {
  const [{ data: positions }, { data: balance }, { data: user }, { data: universe }] =
    await Promise.all([
      db.from('positions').select('*').eq('user_id', userId),
      db.from('account_balance').select('*').eq('user_id', userId).maybeSingle(),
      db.from('users').select('settings').eq('id', userId).maybeSingle(),
      db
        .from('asset_metadata')
        .select('symbol, display_name, sector')
        .eq('suggestable', true),
    ])

  if (!universe?.length) return null

  const rows = positions ?? []
  const totalValue = rows.reduce((s, p) => s + (p.market_value || p.quantity * p.current_price), 0)

  const bySector = new Map<string, number>()
  const byType = new Map<string, number>()
  let sameDayFunds = 0

  for (const p of rows) {
    const v = p.market_value || p.quantity * p.current_price
    bySector.set(p.sector, (bySector.get(p.sector) ?? 0) + v)
    byType.set(p.asset_type, (byType.get(p.asset_type) ?? 0) + v)
    if (p.asset_type === 'FCI' && p.rescue_time === 'T+0') sameDayFunds += v
  }

  const settings = (user?.settings ?? {}) as Record<string, number>
  const availableCash = balance?.available_to_trade_ars ?? balance?.available_ars ?? 0

  return {
    positions: rows.map((p) => {
      const value = p.market_value || p.quantity * p.current_price
      return {
        symbol: p.symbol,
        sector: p.sector,
        value,
        gainPct: p.gain_pct ?? 0,
        dayPct: p.daily_change_pct ?? 0,
        weight: totalValue > 0 ? (value / totalValue) * 100 : 0,
        trend30d: '',
      }
    }),
    totalValue,
    // Lo operable, no el saldo: sugerir un monto que no se puede ejecutar hoy
    // es una recomendación inútil
    availableCash,
    news: [],
    universe: universe.map((u) => ({
      symbol: u.symbol,
      name: u.display_name ?? u.symbol,
      sector: u.sector,
      price: null,
    })),
    settings: {
      rebalance_pct: settings.rebalance_pct ?? 15,
      sector_concentration_pct: settings.sector_concentration_pct ?? 50,
      take_profit_pct: settings.take_profit_pct ?? 20,
    },
    sectorWeights: [...bySector].map(([sector, v]) => ({
      sector,
      pct: totalValue > 0 ? (v / totalValue) * 100 : 0,
    })),
    typeWeights: [...byType].map(([type, v]) => ({
      type,
      value: v,
      pct: totalValue > 0 ? (v / totalValue) * 100 : 0,
    })),
    // Efectivo más lo que rescata en el día: es lo que financia las metas con
    // fecha cercana, así que no se puede proponer tocarlo
    liquidityFloor: availableCash + sameDayFunds,
  }
}

async function planGoal(userId: string, goalId: string, ctx: AdvisorContext) {
  const { data: goal } = await db
    .from('goal_summary')
    .select('*')
    .eq('id', goalId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!goal) return { error: 'meta no encontrada' }

  const [{ data: earmarked }, { data: prices }] = await Promise.all([
    db.from('goal_holdings').select('symbol, quantity').eq('goal_id', goalId),
    db.from('positions').select('symbol, current_price').eq('user_id', userId),
  ])

  // El PRECIO unitario, no el valor de la posición. `price_at_recommendation`
  // se compara después contra `price_history` para saber si la recomendación
  // acertó: guardar ahí el valor total dejaría el registro de aciertos sin
  // sentido.
  const priceBySymbol = new Map((prices ?? []).map((p) => [p.symbol, p.current_price ?? 0]))

  const daysLeft = daysUntil(goal.target_date)
  const currentValue = Number(goal.current_value)
  const required = requiredReturn(currentValue, goal.target_amount, daysLeft)

  const growth = daysLeft && daysLeft > 0 ? Math.pow(1 + HISTORICAL_RATE / 100, daysLeft / 365) : 1

  const goalCtx: GoalContext = {
    name: goal.name,
    targetAmount: goal.target_amount,
    targetDate: goal.target_date,
    daysLeft,
    currentValue,
    cashInGoal: Number(goal.cash_ars ?? 0),
    requiredAnnualPct: required,
    band: required === null ? null : difficultyBand(required),
    achievableAmount: daysLeft && daysLeft > 0 ? currentValue * growth : null,
    earmarked: (earmarked ?? []).map((h) => ({
      symbol: h.symbol,
      quantity: h.quantity,
      value: h.quantity * (priceBySymbol.get(h.symbol) ?? 0),
    })),
  }

  const { recommendations, usage } = await adviseForGoal(ctx, goalCtx)
  if (!recommendations.length) return { recommendations: 0, usage }

  // El plan anterior deja de estar vigente: si no, se apilan sugerencias de
  // semanas distintas que pueden contradecirse
  await db
    .from('recommendations')
    .update({ is_active: false })
    .eq('goal_id', goalId)
    .eq('is_active', true)

  const { error } = await db.from('recommendations').insert(
    recommendations.map((r) => ({
      user_id: userId,
      goal_id: goalId,
      action: r.action,
      symbol: r.symbol,
      counterpart_symbol: r.counterpart_symbol,
      title: r.title,
      reasoning: r.reasoning,
      confidence: r.confidence,
      time_horizon: r.time_horizon,
      suggested_amount: r.suggested_amount_ars,
      realizes_loss: r.realizes_loss,
      price_at_recommendation: priceBySymbol.get(r.symbol) ?? null,
      analyzed_with: 'claude-opus-5',
      is_active: true,
    })),
  )
  if (error) throw error

  await db
    .from('goal_portfolios')
    .update({ plan_generated_at: new Date().toISOString() })
    .eq('id', goalId)

  return { recommendations: recommendations.length, usage }
}

Deno.serve(async (req) => {
  const fromCron = isServiceRole(req)
  const userId = fromCron ? null : userIdFromJwt(req)

  if (!fromCron && !userId) {
    return Response.json({ error: 'no autorizado' }, { status: 401 })
  }

  // ── Camino de la app: una meta puntual ─────────────────────────────────
  if (userId) {
    const body = (await req.json().catch(() => ({}))) as { goal_id?: string }
    if (!body.goal_id) return Response.json({ error: 'falta goal_id' }, { status: 400 })

    const { data: goal } = await db
      .from('goal_portfolios')
      .select('id, plan_generated_at')
      .eq('id', body.goal_id)
      .eq('user_id', userId)
      .maybeSingle()

    if (!goal) return Response.json({ error: 'meta no encontrada' }, { status: 404 })

    // Cada generación es una llamada a Opus. Sin este freno, tocar el botón
    // repetido cuesta plata sin cambiar el plan.
    if (goal.plan_generated_at) {
      const elapsed = Date.now() - new Date(goal.plan_generated_at).getTime()
      if (elapsed < COOLDOWN_MINUTES * 60_000) {
        const wait = Math.ceil((COOLDOWN_MINUTES * 60_000 - elapsed) / 60_000)
        return Response.json(
          { error: `El plan se generó hace poco. Probá de nuevo en ${wait} minutos.` },
          { status: 429 },
        )
      }
    }

    const ctx = await buildAdvisorContext(userId)
    if (!ctx) return Response.json({ error: 'universo de activos vacío' }, { status: 400 })

    try {
      const result = await planGoal(userId, body.goal_id, ctx)
      return Response.json({ ok: true, ...result })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[goal-advisor]', message)
      return Response.json({ error: message }, { status: 500 })
    }
  }

  // ── Camino del cron: todas las metas con objetivo ──────────────────────
  const { data: users } = await db.from('users').select('id')
  const results: Record<string, unknown> = {}

  for (const user of users ?? []) {
    const ctx = await buildAdvisorContext(user.id)
    if (!ctx) continue

    // Solo las metas con objetivo y fecha: sin eso no hay plan que armar, y
    // gastar en Opus para una meta abierta es tirar plata
    const { data: goals } = await db
      .from('goal_portfolios')
      .select('id, name')
      .eq('user_id', user.id)
      .not('target_amount', 'is', null)

    const perGoal: Record<string, unknown> = {}
    for (const goal of goals ?? []) {
      try {
        perGoal[goal.name] = await planGoal(user.id, goal.id, ctx)
      } catch (err) {
        perGoal[goal.name] = { error: err instanceof Error ? err.message : String(err) }
      }
    }
    results[user.id] = perGoal
  }

  return Response.json({ ok: true, results })
})
