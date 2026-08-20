-- ============================================================
-- Tipo de cambio implícito de cada CEDEAR
--
-- Un CEDEAR cotiza en pesos (NVDA) y también en dólar MEP (NVDAD). El cociente
-- entre ambos es el dólar al que estás comprando el activo, y puede diferir
-- bastante del MEP de mercado: si el implícito está caro, comprar en pesos es
-- pagar de más por el mismo papel.
--
-- Hasta ahora la app no lo sabía, y el asesor podía sugerir una compra con 8%
-- de prima sobre el MEP sin siquiera mencionarlo. El Dashboard ya arrastraba el
-- problema — hay un comentario admitiendo que IOL convierte con el implícito y
-- nosotros con el MEP de mercado, y que los números difieren ~1%.
--
-- Va en `market_quotes` y no en `positions` ni en una tabla nueva por usuario:
-- el dólar implícito de NVDA es un hecho de mercado, igual para todos. Repetirlo
-- por usuario sería invitar a que se desincronice.
-- ============================================================

ALTER TABLE market_quotes
  ADD COLUMN IF NOT EXISTS usd_price NUMERIC,
  ADD COLUMN IF NOT EXISTS implied_fx NUMERIC,
  ADD COLUMN IF NOT EXISTS implied_fx_at TIMESTAMPTZ;

COMMENT ON COLUMN market_quotes.usd_price IS
  'Último precio del ticker en dólar MEP (sufijo D). NULL para lo que no tiene par en dólares: FCI, bonos, acciones locales.';

COMMENT ON COLUMN market_quotes.implied_fx IS
  'Dólar implícito = precio ARS / precio USD MEP. Comparar contra dollar_rates.mep para saber si el CEDEAR está caro o barato en pesos.';

COMMENT ON COLUMN market_quotes.implied_fx_at IS
  'Cuándo se calculó. Las dos patas se cotizan en la misma corrida, pero si el mercado está cerrado el dato queda viejo y esto lo delata.';
