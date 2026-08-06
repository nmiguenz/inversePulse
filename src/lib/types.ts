export type Position = {
  id: string
  user_id: string
  symbol: string
  description: string | null
  quantity: number
  avg_buy_price: number
  current_price: number
  previous_close: number
  sector: string
  asset_type: string
  currency: string
  rescue_time: string | null
  /** Unidades reservadas por órdenes puestas */
  committed_quantity: number | null
  /** variacionDiaria de IOL, tal cual */
  daily_change_pct: number | null
  /** Valuación en ARS según IOL. Los bonos cotizan por 100 nominales, así que
   *  quantity * current_price NO sirve como valor de mercado. */
  market_value: number | null
  gain_amount: number | null
  gain_pct: number | null
  updated_at: string
}

/** Una fila por plazo de liquidación, tal como la manda IOL */
export type SettlementRow = {
  liquidacion: string
  saldo: number
  comprometido: number
  disponible: number
  disponibleOperar: number
}

export type AccountBalance = {
  available_ars: number
  /** disponibleOperar: lo que se puede usar para una orden. Puede ser menor. */
  available_to_trade_ars: number | null
  settlement_breakdown: SettlementRow[] | null
  committed_ars: number
  available_usd: number
  total_portfolio_value: number
  total_gain_loss: number
  updated_at: string
}

export type DollarRate = {
  rate_type: 'mep' | 'ccl' | 'blue' | 'oficial' | 'cripto'
  buy_price: number | null
  sell_price: number | null
  spread: number | null
  recorded_at: string
}

export type PricePoint = {
  symbol: string
  close_price: number
  recorded_at: string
}

export type Goal = {
  id: string
  name: string
  description: string | null
  emoji: string | null
  target_date: string | null
  target_amount: number | null
  /** Tenencias apartadas + efectivo apartado */
  current_value: number
  cost_basis: number
  /** Solo lo invertido, sin el efectivo quieto */
  invested_value: number
  invested_cost: number
  /** Efectivo apartado para la meta */
  cash_ars: number
  /** Primera vez que superó el objetivo. La meta no se cierra: sigue sumando. */
  reached_at: string | null
  /** Con cuántos días de anticipación avisar que conviene pasar a algo seguro */
  derisk_days: number
  plan_generated_at: string | null
  holdings_count: number
  /** Vendiste y quedaste por debajo de lo que tenías apartado */
  over_allocated: boolean | null
  created_at: string
}

export type GoalHolding = {
  id: string
  goal_id: string
  symbol: string
  quantity: number
}

export type RecommendationAction = 'buy' | 'add' | 'trim' | 'sell' | 'rebalance' | 'hold'

export type Recommendation = {
  id: string
  action: RecommendationAction
  symbol: string
  counterpart_symbol: string | null
  title: string
  reasoning: string
  confidence: 'high' | 'medium' | 'low'
  time_horizon: 'short' | 'medium' | 'long' | null
  suggested_amount: number | null
  suggested_quantity: number | null
  realizes_loss: boolean
  price_at_recommendation: number | null
  outcome_pct: number | null
  outcome_verdict: string | null
  evaluated_at: string | null
  is_active: boolean
  created_at: string
}

export type Confidence = 'high' | 'medium' | 'low'
export type TimeHorizon = 'short' | 'medium' | 'long'

export type Opportunity = {
  id: string
  symbol: string
  opportunity_type: string
  title: string
  reasoning: string
  growth_estimate_pct: number | null
  confidence: Confidence | null
  time_horizon: TimeHorizon | null
  current_price: number | null
  target_price: number | null
  already_owned: boolean | null
  is_active: boolean
  expires_at: string | null
  created_at: string
}

export type Sentiment = 'positive' | 'negative' | 'neutral'
export type ImpactLevel = 'high' | 'medium' | 'low'

export type NewsItem = {
  id: string
  title: string
  source: string
  url: string | null
  summary: string | null
  sentiment: Sentiment | null
  impact_level: ImpactLevel | null
  related_symbols: string[] | null
  tags: string[] | null
  published_at: string | null
  created_at: string
}

export type WorldTopic = {
  slug: string
  label: string
  emoji: string | null
  description: string | null
  sort_order: number
}

export type AlertSeverity = 'critical' | 'warning' | 'info' | 'opportunity'

export type Alert = {
  id: string
  user_id: string
  alert_type: string
  symbol: string | null
  title: string
  message: string
  severity: AlertSeverity
  action_suggested: string | null
  is_read: boolean
  is_dismissed: boolean
  push_sent: boolean
  created_at: string
}

export type IolStatus = {
  is_connected: boolean
  last_sync_at: string | null
  last_sync_error: string | null
}

// ---------- Derivados (se calculan en el cliente) ----------

export type PositionMetrics = Position & {
  /** cantidad × precio actual */
  value: number
  /** variación del día en % */
  dayPct: number
  /** P/L en pesos contra el precio promedio de compra */
  gain: number
  /** P/L en % */
  gainPct: number
  /** peso sobre el total de la cartera, en % */
  weight: number
}

export type SectorSlice = {
  sector: string
  value: number
  pct: number
}

// ---------- Mercado y rendimiento ----------

/** Cotización de un activo del universo, lo tengas o no */
export type MarketQuote = {
  symbol: string
  price: number
  previous_close: number | null
  daily_change_pct: number | null
  /** NULL mientras no haya cierre de hace una semana: son "faltan datos", no 0% */
  week_change_pct: number | null
  volume: number | null
  quoted_at: string | null
  updated_at: string
}

export type PerformanceVerdict = 'ok' | 'mixed' | 'bad' | 'insufficient_data'

/**
 * Revisión de un período cerrado.
 *
 * `net_flows` es lo que hace que el resto tenga sentido: sin descontar aportes
 * y retiros, `end_value − start_value` mezcla plata que pusiste con plata que
 * ganaste.
 */
export type PerformanceReview = {
  id: string
  period_start: string
  period_end: string
  start_value: number
  end_value: number
  net_flows: number
  deposits: number
  withdrawals: number
  dividends: number
  return_pct: number | null
  return_amount: number | null
  return_usd_pct: number | null
  mep_start: number | null
  mep_end: number | null
  /** Cuánto valdría la cartera si no hubieras tocado nada */
  hold_value: number | null
  hold_return_pct: number | null
  verdict: PerformanceVerdict
  verdict_reason: string | null
  /** Qué datos faltaron. NULL = el cálculo fue completo. */
  data_gaps: string[] | null
  created_at: string
}

export type Transaction = {
  id: string
  kind: string | null
  side: string
  symbol: string | null
  quantity: number
  price: number
  total: number
  currency: string | null
  description: string | null
  notes: string | null
  executed_at: string
}
