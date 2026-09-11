-- ============================================================
-- Red de seguridad del sizing
--
-- `enforcePositionLimits()` en `portfolio-advisor` ya capa las compras por
-- posición (8% nueva, 15% existente) y por sector (40% AL COSTO). Esto es una
-- segunda mirada, del lado de la base: si una recomendación de compra llega
-- pasada de esos techos, algo falló antes.
--
-- AVISA, NO BLOQUEA. `RAISE WARNING`, nunca `EXCEPTION`.
--
-- El motivo es concreto: una excepción acá aborta el INSERT del lote entero y
-- el usuario se queda sin ninguna recomendación del día por un error de
-- redondeo. El código de arriba es el que decide; esto solo deja rastro en los
-- logs para poder encontrar el bug. Si alguna vez hay que bloquear de verdad,
-- que sea una decisión explícita y no el efecto lateral de un trigger.
--
-- Los márgenes son más anchos que los límites reales a propósito:
--
--   posición  15% + 2 = 17%   El cap se calcula con el precio del momento y el
--                             insert ocurre segundos después; un activo volátil
--                             se mueve en el medio.
--   sector    40% + 5 = 45%   Además del timing, el peso al costo se mueve
--                             cuando entra cualquier compra nueva al
--                             denominador.
--
-- Un aviso dentro del margen es ruido; uno fuera es un bug de verdad.
-- ============================================================

CREATE OR REPLACE FUNCTION warn_on_oversized_recommendation()
RETURNS TRIGGER AS $$
DECLARE
  v_cost_basis     NUMERIC;
  v_sector         TEXT;
  v_sector_cost    NUMERIC;
  v_position_value NUMERIC;
  v_total_value    NUMERIC;
  v_position_pct   NUMERIC;
  v_sector_pct     NUMERIC;
BEGIN
  -- Solo compras: vender o rebalancear nunca aumenta una concentración.
  IF NEW.action NOT IN ('buy', 'add') OR COALESCE(NEW.suggested_amount, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  -- El costo de cada posición sale de `avg_buy_price`. Cuando no está o es 0
  -- —una posición migrada sin costo conocido— se usa `current_price`: es la
  -- mejor aproximación disponible y equivale a tratarla como recién comprada.
  SELECT
    COALESCE(SUM(quantity * COALESCE(NULLIF(avg_buy_price, 0), current_price)), 0),
    COALESCE(SUM(COALESCE(market_value, quantity * current_price)), 0)
  INTO v_cost_basis, v_total_value
  FROM positions
  WHERE user_id = NEW.user_id;

  IF v_cost_basis <= 0 THEN
    RETURN NEW;  -- cartera vacía: no hay contra qué comparar
  END IF;

  -- El sector del símbolo: primero la posición, si no el universo curado.
  SELECT sector INTO v_sector FROM positions
   WHERE user_id = NEW.user_id AND symbol = NEW.symbol;
  IF v_sector IS NULL THEN
    SELECT sector INTO v_sector FROM asset_metadata WHERE symbol = NEW.symbol;
  END IF;

  -- ── Techo por posición ──
  SELECT COALESCE(market_value, quantity * current_price) INTO v_position_value
    FROM positions WHERE user_id = NEW.user_id AND symbol = NEW.symbol;

  IF v_total_value > 0 THEN
    v_position_pct := ((COALESCE(v_position_value, 0) + NEW.suggested_amount) / v_total_value) * 100;
    IF v_position_pct > 17 THEN
      -- El signo de porcentaje va DENTRO del argumento, no en el formato: en
      -- RAISE, '%%%' se parsea como '%%' (literal) seguido de '%' (placeholder),
      -- y los valores terminan desalineados del texto.
      RAISE WARNING
        'sizing: % de % dejaría la posición en % de la cartera (techo 15+2 de margen). Recomendación %',
        NEW.action, NEW.symbol, ROUND(v_position_pct, 1)::TEXT || '%', NEW.id;
    END IF;
  END IF;

  -- ── Techo por sector, AL COSTO ──
  IF v_sector IS NOT NULL THEN
    SELECT COALESCE(SUM(quantity * COALESCE(NULLIF(avg_buy_price, 0), current_price)), 0)
      INTO v_sector_cost
      FROM positions
     WHERE user_id = NEW.user_id AND sector = v_sector;

    -- El monto entra en los dos lados: suma al sector y al total invertido.
    v_sector_pct := ((v_sector_cost + NEW.suggested_amount) / (v_cost_basis + NEW.suggested_amount)) * 100;

    IF v_sector_pct > 45 THEN
      RAISE WARNING
        'sizing: % de % dejaría el sector % en % al costo (techo 40+5 de margen). Recomendación %',
        NEW.action, NEW.symbol, v_sector, ROUND(v_sector_pct, 1)::TEXT || '%', NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_warn_oversized_recommendation ON recommendations;

CREATE TRIGGER trg_warn_oversized_recommendation
  BEFORE INSERT ON recommendations
  FOR EACH ROW
  EXECUTE FUNCTION warn_on_oversized_recommendation();

COMMENT ON FUNCTION warn_on_oversized_recommendation() IS
  'Avisa (WARNING, nunca EXCEPTION) si una compra recomendada excede 17 por ciento de posicion o 45 por ciento de sector al costo. Deteccion, no bloqueo: el limite real lo aplica enforcePositionLimits en portfolio-advisor.';
