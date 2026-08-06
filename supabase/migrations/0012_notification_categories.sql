-- ============================================================
-- Notificaciones por categoría
--
-- Los toggles anteriores eran por SEVERIDAD (critical/warning/info), que mezcla
-- cosas distintas: una noticia negativa y un rebalanceo son ambos "warning" y
-- por eso interrumpían igual.
--
-- La distinción que importa es otra: ¿esto requiere que YO decida algo?
--   · decisions     → stop loss, toma de ganancia, rebalanceo, concentración,
--                     variación extrema, cash sin invertir, earnings
--   · opportunities → recomendaciones del asesor con convicción alta
--   · news          → noticias negativas sobre activos en cartera
--
-- Las de noticias se siguen creando y suman al badge: solo pierden el push.
-- ============================================================

UPDATE users
SET settings = settings || jsonb_build_object(
  'notify_decisions', true,
  'notify_opportunities', true,
  'notify_news', false
)
WHERE NOT (settings ? 'notify_decisions');

-- El default de los usuarios nuevos
ALTER TABLE users ALTER COLUMN settings SET DEFAULT '{
  "take_profit_pct": 20,
  "stop_loss_pct": -15,
  "rebalance_pct": 15,
  "sector_concentration_pct": 50,
  "daily_extreme_pct": 5,
  "idle_cash_threshold": 50000,
  "monitoring_start": "10:00",
  "monitoring_end": "18:00",
  "notify_decisions": true,
  "notify_opportunities": true,
  "notify_news": false
}'::jsonb;
