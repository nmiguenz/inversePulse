-- ============================================================
-- El ticker en dólares no siempre es "símbolo + D"
--
-- La 0031 asumió que el par en dólar MEP de un CEDEAR se arma agregando una D
-- al final. Vale para casi todos, pero no para los símbolos de 5 caracteres:
-- IOL los abrevia para que el par entre en 5.
--
--   NVDA  → NVDAD   ✓
--   BRKB  → BRKBD   ✓
--   GOOGL → GOOGLD  ✗  no existe: es GOGLD
--
-- Verificado contra la API: GOOGLD devuelve asset_not_found y
-- related_symbols de GOOGL trae {dollar: "GOGLD", cable: "GOGLC"}.
--
-- Sin esto, GOOGL quedaba sin dólar implícito en silencio — y hoy es
-- justamente el único de la cartera con prima accionable (-3,6% contra el MEP,
-- o sea barato en pesos). El único caso que importaba era el que se perdía.
--
-- NULL significa "usá la convención": solo se cargan las excepciones.
-- ============================================================

ALTER TABLE asset_metadata
  ADD COLUMN IF NOT EXISTS dollar_symbol TEXT;

COMMENT ON COLUMN asset_metadata.dollar_symbol IS
  'Ticker del par en dólar MEP cuando NO es symbol||''D''. NULL = usar la convención. Sale de related_symbols.dollar en el detalle del activo de IOL.';

UPDATE asset_metadata SET dollar_symbol = 'GOGLD' WHERE symbol = 'GOOGL';
