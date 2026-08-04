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

-- Sin DEFAULT: las columnas arrancan en NULL a propósito.
-- Con DEFAULT 0 las filas ya sincronizadas quedaban valuadas en 0 y el frontend
-- las tomaba como válidas (`??` no cae al fallback con 0), así que la cartera
-- entera mostraba $0 hasta el siguiente sync.
ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS market_value NUMERIC,
  ADD COLUMN IF NOT EXISTS gain_amount  NUMERIC,
  ADD COLUMN IF NOT EXISTS gain_pct     NUMERIC;

-- Si ya corriste una versión anterior de esta migración (con DEFAULT 0),
-- esto deshace el backfill en 0 para que el fallback vuelva a funcionar.
ALTER TABLE positions
  ALTER COLUMN market_value DROP DEFAULT,
  ALTER COLUMN gain_amount  DROP DEFAULT,
  ALTER COLUMN gain_pct     DROP DEFAULT;

UPDATE positions SET market_value = NULL WHERE market_value = 0;

COMMENT ON COLUMN positions.market_value IS
  'Valuación en ARS según IOL (campo `valorizado`). NO recalcular como quantity * current_price: los bonos cotizan por 100 nominales.';
