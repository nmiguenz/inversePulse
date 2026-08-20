/**
 * portfolio-advisor — 2 veces por día en horario de mercado
 *
 * Produce ACCIONES sobre la cartera (comprar, reducir, vender, rebalancear) y
 * las guarda con el precio del momento, para poder medir después si acertaron.
 *
 * Corre SIEMPRE que le toca: las dos corridas diarias se muestran en la app
 * como promesa, así que no hay cortes silenciosos por "pocas noticias".
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isServiceRole, userIdFromJwt } from '../_shared/auth.ts'
import { advise, OPPORTUNITY_MODEL, type Recommendation } from '../_shared/claude.ts'
import { getUserApiKey, markApiKeyUsed } from '../_shared/apiKey.ts'
import { canUseAI } from '../_shared/market.ts'
import { buildInvestorProfile, toAdvisorSettings, type UserSettings } from '../_shared/profile.ts'
import { sendPush } from '../_shared/push.ts'
import { corsHeaders, jsonWithCors, preflight } from '../_shared/cors.ts'

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

/**
 * Mínimo entre dos análisis pedidos a mano.
 *
 * Cada uno es una request a Opus. Sin freno, tocar el botón repetido cuesta
 * plata y devuelve casi lo mismo: la cartera no cambia en cinco minutos.
 */
const ON_DEMAND_COOLDOWN_MINUTES = 45
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

/** Días de mercado en un año, para anualizar la volatilidad diaria. */
const TRADING_DAYS = 252
/** Menos que esto no alcanza para un desvío que signifique algo. */
const MIN_VOL_SAMPLES = 10

/**
 * Volatilidad realizada anualizada, en %.
 *
 * Reemplaza a la implied volatility de opciones: en BCBA los CEDEARs no tienen
 * opciones listadas (`get_options_chain` devuelve 404 para NVDA, AAPL y MSFT),
 * así que la IV no existe para esta cartera. La volatilidad realizada se saca
 * de `price_history`, que ya se está leyendo para la tendencia de 30 días.
 *
 * Devuelve null si la serie es corta o si hay precios no positivos — un cero
 * en la serie haría explotar el logaritmo.
 */
function realizedVol(prices: number[]): number | null {
  if (prices.length < MIN_VOL_SAMPLES) return null

  const returns: number[] = []
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] <= 0 || prices[i - 1] <= 0) return null
    returns.push(Math.log(prices[i] / prices[i - 1]))
  }
  if (returns.length < 2) return null

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length
  // Muestral (n-1): son una muestra de los retornos, no la población entera.
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1)
  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS) * 100
}

Deno.serve(async (req) => {
  // El preflight va PRIMERO: llega sin Authorization, así que cualquier chequeo
  // antes de esto lo rechaza y el browser nunca ve los headers de CORS
  const pre = preflight(req)
  if (pre) return pre

  // Dos caminos: el cron con la service role key, y el botón de la app con el
  // JWT del usuario. El segundo existe para que "¿en qué lo pongo?" pueda
  // pedir un análisis en el momento en vez de mostrar que no hay ninguno.
  const fromCron = isServiceRole(req)
  const callerId = fromCron ? null : userIdFromJwt(req)
  if (!fromCron && !callerId) return jsonWithCors({ error: 'No autorizado' }, { status: 401 })

  // Chequeo barato ANTES de gastar: si la tabla destino no existe, la llamada a
  // Opus se paga igual y el resultado se tira. Ya pasó una vez.
  const { error: schemaError } = await db.from('recommendations').select('id').limit(1)
  if (schemaError) {
    return jsonWithCors(
      { error: `No se puede escribir en recommendations: ${schemaError.message}. ¿Corriste 0009_advisor.sql?` },
      { status: 500 },
    )
  }

  // Un pedido a mano analiza solo al que pregunta; el cron, a todos
  const usersQuery = db.from('users').select('id, settings, push_subscription')
  const { data: users } = await (callerId ? usersQuery.eq('id', callerId) : usersQuery)

  const results: Record<string, unknown> = {}

  for (const user of users ?? []) {
    // ---------- Freno de costo del camino a pedido ----------
    if (callerId) {
      const { data: recent } = await db
        .from('recommendations')
        .select('created_at')
        .eq('user_id', user.id)
        .is('goal_id', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (recent?.created_at) {
        const elapsed = Date.now() - new Date(recent.created_at).getTime()
        if (elapsed < ON_DEMAND_COOLDOWN_MINUTES * 60_000) {
          const wait = Math.ceil((ON_DEMAND_COOLDOWN_MINUTES * 60_000 - elapsed) / 60_000)
          return jsonWithCors(
            { error: `El asesor analizó hace poco. Probá de nuevo en ${wait} minutos.` },
            { status: 429 },
          )
        }
      }
    }

    // ---------- Fuera del mercado no se gasta ----------
    // Analizar con la rueda cerrada paga tokens por una recomendación que no se
    // puede ejecutar hasta el otro día, cuando los precios ya cambiaron.
    const gate = canUseAI(user.settings as { allow_ai_after_hours?: boolean })
    if (!gate.allowed) {
      if (callerId) return jsonWithCors({ error: gate.reason }, { status: 400 })
      results[user.id] = { skipped: 'mercado cerrado' }
      continue
    }

    // ---------- Sin key propia no hay asesor ----------
    // No es un error: la app anda igual, solo sin las funciones de IA.
    const apiKey = await getUserApiKey(db, user.id)
    if (!apiKey) {
      const detail = { skipped: 'sin API key de Anthropic configurada' }
      if (callerId) return jsonWithCors({ error: 'Cargá tu API key de Anthropic en Configuración para usar el asesor.' }, { status: 400 })
      results[user.id] = detail
      continue
    }

    // Las dos corridas diarias son una PROMESA que la app muestra en pantalla
    // (los horarios en verde de Oportunidades). Acá había un corte por "pocas
    // noticias nuevas" que la rompía en silencio: la corrida de las 12:00 se
    // salteaba y el usuario se quedaba mirando un horario en verde que nunca
    // corrió. Los precios y la cartera cambian aunque no haya titulares, y son
    // 2 corridas por día pagadas por el propio usuario — el corte ahorraba
    // centavos a cambio de incumplir lo prometido.

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
        // El análisis vive en news_analysis, por usuario, desde la 0023. Leer
        // las columnas globales de `news` acá era leer columnas muertas: el
        // contexto de noticias llegaba vacío al modelo.
        db
          .from('news_analysis')
          .select('summary, sentiment, related_symbols, news(title)')
          .eq('user_id', user.id)
          .in('impact_level', ['high', 'medium'])
          .order('created_at', { ascending: false })
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

    const settings = (user.settings ?? {}) as UserSettings
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

    // Lo líquido de hoy, y el piso que hay que MANTENER. No son lo mismo:
    // igualarlos —como hacía la 0016— dejaba cero margen para rotar y la
    // instrucción de rotar a crecimiento nunca podía ejecutarse.
    const liquidNow = availableCash + sameDayFunds
    const liquidityFloor = totalValue * ((settings.liquidity_floor_pct ?? 15) / 100)

    const heldSymbols = positions.map((p) => p.symbol)

    // ---------- Antigüedad, movimiento esperado y prima cambiaria ----------
    // Los tres alimentan reglas del prompt que sin el dato no pueden evaluarse:
    // los 14 días de una posición nueva, el riesgo de recomendar contra un
    // earnings, y si el CEDEAR está caro en pesos.
    const [{ data: buys }, { data: earnings }, { data: quotes }, { data: mepRate }] = await Promise.all([
      // `kind`, NO `side`: en fetch-transactions los dividendos también se
      // guardan con side='buy', y como acá interesa la operación MÁS VIEJA,
      // un dividendo viejo se haría pasar por la compra original.
      db
        .from('transactions')
        .select('symbol, executed_at')
        .eq('user_id', user.id)
        .eq('kind', 'buy')
        .in('symbol', heldSymbols)
        .order('executed_at', { ascending: true }),
      db
        .from('earnings_calendar')
        .select('symbol, report_date')
        .in('symbol', heldSymbols)
        .eq('is_reported', false)
        .gte('report_date', new Date().toISOString().slice(0, 10))
        .order('report_date', { ascending: true }),
      // Cartera Y universo sugerible: la prima sirve sobre todo para decidir
      // una COMPRA, y lo que se compra sale del universo, no de lo que ya tenés.
      db
        .from('market_quotes')
        .select('symbol, implied_fx')
        .in('symbol', [...new Set([...heldSymbols, ...universe.map((u) => u.symbol)])]),
      db
        .from('dollar_rates')
        .select('sell_price')
        .eq('rate_type', 'mep')
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    // Ambas listas vienen ordenadas ascendente, así que la primera aparición de
    // cada símbolo ya es la que interesa: la compra más vieja y el earnings más
    // próximo.
    const positionAges: Record<string, number> = {}
    for (const t of buys ?? []) {
      if (t.symbol && !(t.symbol in positionAges)) {
        positionAges[t.symbol] = Math.floor((Date.now() - new Date(t.executed_at).getTime()) / 864e5)
      }
    }

    const earningsInDays = new Map<string, number>()
    for (const e of earnings ?? []) {
      if (!earningsInDays.has(e.symbol)) {
        earningsInDays.set(e.symbol, Math.ceil((new Date(e.report_date).getTime() - Date.now()) / 864e5))
      }
    }

    const expectedMove: Record<string, { vol30d: number; earningsInDays?: number }> = {}
    for (const p of positions) {
      const vol = realizedVol(seriesBySymbol.get(p.symbol) ?? [])
      if (vol === null) continue
      const days = earningsInDays.get(p.symbol)
      expectedMove[p.symbol] = { vol30d: vol, ...(days !== undefined ? { earningsInDays: days } : {}) }
    }

    const mep = mepRate?.sell_price ?? 0
    const dollarPremium: Record<string, { implicit: number; mep: number; premiumPct: number }> = {}
    if (mep > 0) {
      for (const q of quotes ?? []) {
        if (!q.implied_fx || q.implied_fx <= 0) continue
        dollarPremium[q.symbol] = {
          implicit: q.implied_fx,
          mep,
          premiumPct: (q.implied_fx / mep - 1) * 100,
        }
      }
    }

    let analysis
    try {
      analysis = await advise(apiKey, {
        positions: positions.map((p) => ({
          symbol: p.symbol,
          sector: p.sector,
          // El tipo importa para la rotación: el prompt distingue entre rotar
          // desde un FCI y rotar desde un CEDEAR, y sin esto no puede.
          assetType: p.asset_type,
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
          title: (n.news as unknown as { title: string } | null)?.title ?? '',
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
        settings: toAdvisorSettings(settings),
        // Sin el perfil, todas las ramas `isAggressive` del prompt dan false y
        // se arma la variante MODERADA: por eso el asesor recomendaba comprar
        // defensivos a alguien cuyo objetivo es maximizar crecimiento.
        profile: await buildInvestorProfile(db, user.id, settings),
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
        liquidNow,
        positionAges,
        expectedMove,
        dollarPremium,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      results[user.id] = { error: message }
      console.error('[advisor]', message)
      continue
    }

    await markApiKeyUsed(db, user.id)
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

    /**
     * El análisis nuevo REEMPLAZA al anterior completo, no solo a los símbolos
     * que se repiten.
     *
     * Antes se desactivaban únicamente las del mismo símbolo, y quedaban
     * conviviendo sugerencias de corridas distintas. Se vio en datos reales:
     * dos rotaciones de GLD activas al mismo tiempo, una por $500.000 y otra
     * por $138.000, cada una de una corrida diferente. Contradictorias, y sin
     * forma de saber cuál valía.
     *
     * El asesor mira la cartera entera en cada corrida: si no repitió algo que
     * había sugerido antes, es porque ya no lo sugiere. Dejarlo vivo sería
     * inventar una recomendación que el modelo no hizo.
     *
     * `goal_id is null` acota a las generales: los planes de metas tienen su
     * propio ciclo y los renueva `goal-advisor`.
     */
    const { error: staleError } = await db
      .from('recommendations')
      .update({ is_active: false })
      .eq('user_id', user.id)
      .is('goal_id', null)
      .eq('is_active', true)

    // Si esto falla, las viejas quedan mezcladas con las nuevas: se registra en
    // vez de seguir como si nada, que es lo que venía pasando
    if (staleError) console.error('[advisor] no se pudieron cerrar las anteriores:', staleError.message)

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

  return jsonWithCors({ ok: true, results })
})
