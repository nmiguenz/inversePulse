-- ============================================================
-- Alpha vs SPY en las evaluaciones
--
-- `verdict()` mide el movimiento ABSOLUTO del activo: si subió, la compra fue
-- correcta. Eso deja afuera la pregunta que importa cuando hay una alternativa
-- pasiva a un click de distancia: si AVGO subió 5% y el S&P subió 8% en el
-- mismo período, la recomendación "acertó" y sin embargo te habría ido mejor
-- comprando el índice y no haciendo nada.
--
-- El benchmark es el CEDEAR de SPY, que cotiza en pesos igual que todo lo
-- demás de esta cartera. Comparar dos retornos en la misma moneda deja el
-- movimiento del dólar fuera de la cuenta: si el CCL salta, sube tanto el
-- activo como el benchmark, y el alpha sigue midiendo lo único que se le puede
-- atribuir a la decisión.
--
-- `spy_price_at_rec` se escribe al CREAR la recomendación, no al evaluarla:
-- reconstruirlo después obligaría a adivinar a qué hora del día se sugirió.
-- Las recomendaciones anteriores a esta migración quedan con ese campo en null
-- y por lo tanto sin alpha — para siempre, y a propósito.
-- ============================================================

ALTER TABLE recommendations
  ADD COLUMN IF NOT EXISTS spy_price_at_rec numeric,
  ADD COLUMN IF NOT EXISTS spy_return_7d numeric,
  ADD COLUMN IF NOT EXISTS spy_return_14d numeric,
  ADD COLUMN IF NOT EXISTS spy_return_30d numeric,
  ADD COLUMN IF NOT EXISTS alpha_7d numeric,
  ADD COLUMN IF NOT EXISTS alpha_14d numeric,
  ADD COLUMN IF NOT EXISTS alpha_30d numeric;

COMMENT ON COLUMN recommendations.alpha_30d IS
  'outcome_pct - spy_return_30d: positivo = le ganó al mercado';

-- El alpha solo se calcula para buy y add. Un sell no toma exposición: restarle
-- el retorno del índice a la caída del activo que saliste a tiempo daría un
-- número muy negativo para una decisión que estuvo bien. El veredicto de esas
-- sigue siendo el de `verdict()`, que ya las juzga al revés.
COMMENT ON COLUMN recommendations.spy_return_30d IS
  'Retorno del CEDEAR de SPY en el mismo período. Se guarda para toda recomendación evaluada, tenga alpha o no.';
