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
  /** Valuación en ARS según IOL. Los bonos cotizan por 100 nominales, así que
   *  quantity * current_price NO sirve como valor de mercado. */
  market_value: number | null
  gain_amount: number | null
  gain_pct: number | null
  updated_at: string
}

export type AccountBalance = {
  available_ars: number
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
