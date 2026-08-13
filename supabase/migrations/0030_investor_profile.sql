-- ============================================================
-- El perfil del inversor, para que el asesor sepa a quién le habla
--
-- Los prompts ya tenían dos variantes, agresiva y moderada, pero el perfil
-- era opcional y nadie lo pasaba: `isAggressive` daba false en todas y
-- siempre se armaba la moderada. Por eso el asesor recomendaba diversificar
-- y comprar defensivos a alguien cuyo objetivo declarado es maximizar
-- crecimiento.
--
-- `risk_profile` ya existía (default 'agresivo'). Faltaban estos dos.
-- ============================================================

UPDATE users
SET settings = settings
  || jsonb_build_object(
       'preferred_sectors',
       COALESCE(settings->'preferred_sectors', '[]'::jsonb),
       'objective',
       COALESCE(
         settings->'objective',
         '"Maximizar el crecimiento del capital y reinvertir las ganancias, sin descapitalizarme."'::jsonb
       )
     );

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
  "preferred_sectors": [],
  "objective": "Maximizar el crecimiento del capital y reinvertir las ganancias, sin descapitalizarme.",
  "monitoring_start": "10:00",
  "monitoring_end": "18:00",
  "notify_decisions": true,
  "notify_opportunities": true,
  "notify_news": false,
  "review_period_days": 30,
  "muted_alerts": {},
  "allow_ai_after_hours": false
}'::jsonb;

-- El tercer campo del perfil, `investmentHistory`, NO se guarda: se deriva de
-- `transactions` en cada corrida. Un texto cargado a mano se desactualiza y
-- termina describiendo a un inversor que ya no sos; las operaciones son lo que
-- hiciste de verdad y ya están en la base.
