-- ============================================================
-- Sugerencias que se cierran al cumplirse, y avisos silenciables
--
-- Una recomendación quedaba activa hasta que pasaran 30 días o hasta que el
-- asesor generara otra del mismo símbolo. Nada miraba si el usuario YA la había
-- ejecutado, así que "Comprá SPY $150 mil" seguía en el Dashboard después de
-- comprar SPY. Ahora que `transactions` trae las operaciones reales de IOL, se
-- puede cruzar.
-- ============================================================

ALTER TABLE recommendations
  ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fulfilled_amount NUMERIC;

COMMENT ON COLUMN recommendations.fulfilled_at IS
  'Cuándo se detectó que se ejecutó, cruzando contra transactions. Distinto de evaluated_at: cumplida y acertada no son lo mismo — hacerle caso al asesor no garantiza que tuviera razón, y esa distinción es la que mantiene honesto al registro de aciertos.';

COMMENT ON COLUMN recommendations.fulfilled_amount IS
  'Cuánto se operó de verdad. Se compara contra suggested_amount para decidir si alcanza el umbral.';

-- Para el cruce: solo interesan las activas sin cumplir
CREATE INDEX IF NOT EXISTS idx_recommendations_unfulfilled
  ON recommendations(user_id, symbol) WHERE is_active AND fulfilled_at IS NULL;

-- ============================================
-- Alertas silenciadas
-- ============================================
--
-- `muted_alerts` es un objeto { tipo_de_alerta: fecha_hasta }. El silencio
-- VENCE a propósito: silenciar para siempre "tu cuenta está desconectada"
-- hace que la app deje de sincronizar sin que nada te lo diga nunca más.
UPDATE users
SET settings = settings || jsonb_build_object('muted_alerts', '{}'::jsonb)
WHERE NOT (settings ? 'muted_alerts');

ALTER TABLE users ALTER COLUMN settings SET DEFAULT '{
  "take_profit_pct": 0,
  "stop_loss_pct": -15,
  "rebalance_pct": 15,
  "sector_concentration_pct": 50,
  "daily_extreme_pct": 5,
  "idle_cash_threshold": 50000,
  "trailing_stop_pct": 12,
  "trailing_min_gain_pct": 15,
  "rebuy_watch_pct": 10,
  "liquidity_floor_pct": 15,
  "risk_profile": "agresivo",
  "monitoring_start": "10:00",
  "monitoring_end": "18:00",
  "notify_decisions": true,
  "notify_opportunities": true,
  "notify_news": false,
  "review_period_days": 30,
  "muted_alerts": {}
}'::jsonb;
