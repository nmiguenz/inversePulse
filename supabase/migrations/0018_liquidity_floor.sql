-- ============================================================
-- El piso de liquidez pasa a ser una reserva, no un candado
--
-- La 0016 lo definió como "efectivo + todo lo que rescata en el día". Con eso,
-- el piso siempre es IGUAL a lo que tenés líquido, así que nunca sobra nada
-- para rotar y la instrucción de rotar renta fija a crecimiento —agregada en
-- la misma migración— quedaba muerta.
--
-- Se vio en la primera corrida real: el asesor calculó el piso en $2.654.704
-- sobre $2.866.624 líquidos y escribió "solo hay unos $212.000 realmente
-- libres, así que la rotación acá es chica por diseño". Tenía razón, y el
-- diseño estaba mal.
--
-- Ahora el piso es un porcentaje de la cartera: una reserva a MANTENER, no el
-- saldo actual congelado.
-- ============================================================

UPDATE users
SET settings = settings || jsonb_build_object('liquidity_floor_pct', 15)
WHERE NOT (settings ? 'liquidity_floor_pct');

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
  "review_period_days": 30
}'::jsonb;

COMMENT ON TABLE users IS
  'settings.liquidity_floor_pct: % de la cartera que debe quedar líquido (efectivo + money market). Es una reserva mínima a mantener, no el saldo actual.';
