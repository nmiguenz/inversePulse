-- ============================================================
-- Metas con plan: financiación, seguimiento y recomendaciones propias
--
-- Hasta ahora una meta era una etiqueta sobre tenencias: servía para MIRAR la
-- cartera por objetivo, pero no hacía nada para LLEGAR al objetivo.
-- ============================================================

-- ============================================
-- 0. ARREGLO DE 0014 — el sync de operaciones estaba roto
-- ============================================
--
-- El índice único de `transactions` quedó PARCIAL (`WHERE external_id IS NOT
-- NULL`) y PostgREST no puede inferir un índice parcial desde
-- `onConflict: 'user_id,external_id'`. La función fallaba entera con:
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification (42P10)"
--
-- El predicado además sobraba: en Postgres dos NULL no colisionan entre sí en
-- un índice único, así que las filas cargadas a mano sin external_id nunca se
-- iban a pisar.
DROP INDEX IF EXISTS idx_transactions_external;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_external
  ON transactions(user_id, external_id);

-- ============================================
-- 1. FINANCIACIÓN Y SEGUIMIENTO DE LA META
-- ============================================

ALTER TABLE goal_portfolios
  -- Efectivo apartado para la meta. Mismo criterio que las tenencias: es una
  -- etiqueta sobre la plata que ya está en la cuenta, no una cuenta aparte.
  ADD COLUMN IF NOT EXISTS cash_ars NUMERIC NOT NULL DEFAULT 0,
  -- Cuándo se alcanzó el objetivo por primera vez. NO cierra la meta: se sigue
  -- acumulando, que es lo que se pidió — "si se supera, mejor, pero nunca
  -- detenerse".
  ADD COLUMN IF NOT EXISTS reached_at TIMESTAMPTZ,
  -- Con cuántos días de anticipación avisar que conviene pasar a algo sin
  -- riesgo para no perder un objetivo ya cubierto.
  ADD COLUMN IF NOT EXISTS derisk_days INT NOT NULL DEFAULT 30,
  -- Última vez que se generó el plan de compra, para no gastar en Opus dos
  -- veces el mismo día.
  ADD COLUMN IF NOT EXISTS plan_generated_at TIMESTAMPTZ;

COMMENT ON COLUMN goal_portfolios.reached_at IS
  'Primera vez que el valor superó el objetivo. La meta sigue viva y sumando.';

-- El mismo control que ya existe para las tenencias, ahora para el efectivo:
-- no se puede apartar plata que no está.
CREATE OR REPLACE FUNCTION check_goal_cash()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  available NUMERIC;
  committed NUMERIC;
BEGIN
  IF NEW.cash_ars = 0 THEN
    RETURN NEW;
  END IF;

  IF NEW.cash_ars < 0 THEN
    RAISE EXCEPTION 'El efectivo de una meta no puede ser negativo';
  END IF;

  SELECT COALESCE(available_ars, 0) INTO available
  FROM account_balance WHERE user_id = NEW.user_id;

  -- Sin sync todavía no hay contra qué validar. Se deja pasar en vez de
  -- bloquear: el peor caso es una meta sobre-financiada que la vista marca.
  IF available IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(cash_ars), 0) INTO committed
  FROM goal_portfolios
  WHERE user_id = NEW.user_id AND id IS DISTINCT FROM NEW.id;

  IF committed + NEW.cash_ars > available THEN
    RAISE EXCEPTION
      'Estás apartando % pero tenés % disponibles y ya hay % en otras metas',
      NEW.cash_ars, available, committed;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS goal_cash_check ON goal_portfolios;
CREATE TRIGGER goal_cash_check
  BEFORE INSERT OR UPDATE OF cash_ars ON goal_portfolios
  FOR EACH ROW EXECUTE FUNCTION check_goal_cash();

-- ============================================
-- 2. RECOMENDACIONES ATADAS A UNA META
-- ============================================

-- Se reusa la tabla que ya existe en vez de crear una paralela: así el plan de
-- una meta hereda gratis la tarjeta de la UI y el registro de aciertos.
ALTER TABLE recommendations
  ADD COLUMN IF NOT EXISTS goal_id UUID REFERENCES goal_portfolios(id) ON DELETE CASCADE;

COMMENT ON COLUMN recommendations.goal_id IS
  'NULL = recomendación general de la cartera. Con valor = parte del plan de esa meta.';

CREATE INDEX IF NOT EXISTS idx_recommendations_goal
  ON recommendations(goal_id, is_active) WHERE goal_id IS NOT NULL;

-- Las alertas de meta no tienen símbolo, así que el dedupe por `alert_type +
-- symbol` que usa evaluate-alerts las confundiría entre sí: dos metas
-- distintas alcanzadas el mismo día generarían un solo aviso.
ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS goal_id UUID REFERENCES goal_portfolios(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_alerts_goal
  ON alerts(goal_id, alert_type, created_at DESC) WHERE goal_id IS NOT NULL;

-- ============================================
-- 3. LA VISTA, CON EL EFECTIVO ADENTRO
-- ============================================

-- `current_value` ahora suma el efectivo apartado. Sin esto, una meta recién
-- creada con plata pero todavía sin comprar mostraría $0 y una dificultad
-- imposible de calcular.
DROP VIEW IF EXISTS goal_summary;

CREATE VIEW goal_summary
WITH (security_invoker = true)
AS
  SELECT
    g.id,
    g.user_id,
    g.name,
    g.description,
    g.emoji,
    g.target_date,
    g.target_amount,
    g.cash_ars,
    g.reached_at,
    g.derisk_days,
    g.plan_generated_at,
    g.created_at,
    COALESCE(SUM(gh.quantity * p.current_price), 0) + g.cash_ars AS current_value,
    COALESCE(SUM(gh.quantity * p.avg_buy_price), 0) + g.cash_ars AS cost_basis,
    -- Solo lo invertido, para poder mostrar el rendimiento sin que el efectivo
    -- quieto lo diluya
    COALESCE(SUM(gh.quantity * p.current_price), 0) AS invested_value,
    COALESCE(SUM(gh.quantity * p.avg_buy_price), 0) AS invested_cost,
    COUNT(gh.id) AS holdings_count,
    BOOL_OR(gh.quantity > p.quantity) AS over_allocated
  FROM goal_portfolios g
  LEFT JOIN goal_holdings gh ON gh.goal_id = g.id
  LEFT JOIN positions p ON p.symbol = gh.symbol AND p.user_id = g.user_id
  GROUP BY g.id;

GRANT SELECT ON goal_summary TO authenticated;

-- ============================================
-- 4. TAREA PROGRAMADA
-- ============================================

-- goal-advisor: domingos a la mañana. El plan de una meta a meses no cambia de
-- un día para el otro, y cada corrida es una llamada a Opus por meta activa.
-- El botón de la app permite pedirlo antes cuando hace falta.
SELECT cron.schedule(
  'goal-advisor',
  '0 12 * * 0',
  $$
  SELECT net.http_post(
    url := 'https://kfxnspxwmcepgzqycjfa.supabase.co/functions/v1/goal-advisor',
    headers := cron_auth_headers(),
    timeout_milliseconds := 120000
  );
  $$
);
