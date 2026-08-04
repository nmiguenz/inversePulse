-- ============================================================
-- Valuación de posiciones tomada de IOL (Fase 3)
--
-- POR QUÉ: calcular el valor como quantity * current_price está MAL para los
-- bonos, que cotizan por cada 100 nominales. TZXD6 daba $50.254.466 en vez de
-- $502.595 — 100x — y con eso pasaba a "pesar" el 88% de la cartera, lo que
-- disparaba alertas falsas de rebalanceo y concentración por sector.
--
-- Mismo problema con el P/L: quantity * avg_buy_price arrastra el mismo factor.
--
-- IOL ya devuelve `valorizado`, `gananciaDinero` y `gananciaPorcentaje` bien
-- calculados para CEDEARs, FCI y bonos por igual. Se guardan tal cual y el
-- frontend deja de recalcularlos.
-- ============================================================

ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS market_value NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gain_amount  NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gain_pct     NUMERIC DEFAULT 0;

COMMENT ON COLUMN positions.market_value IS
  'Valuación en ARS según IOL (campo `valorizado`). NO recalcular como quantity * current_price: los bonos cotizan por 100 nominales.';
