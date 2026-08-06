-- ============================================================
-- Carteras por objetivo
--
-- No son carteras separadas ni simuladas: son ETIQUETAS sobre tenencias que ya
-- tenés. "20 de mis 60 NVDA son el ahorro de mi hijo". Por eso suman al total
-- de la cartera — son la misma plata, vista de otra forma — y el precio se
-- actualiza solo con el sync de IOL, sin cotizaciones extra.
-- ============================================================

CREATE TABLE goal_portfolios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                 -- "Ahorro de Tomás"
  description TEXT,                   -- "Para el viaje de egresados"
  target_date DATE,
  target_amount NUMERIC,              -- meta en pesos, opcional
  emoji TEXT DEFAULT '🎯',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE goal_holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID REFERENCES goal_portfolios(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(goal_id, symbol)
);

ALTER TABLE goal_portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_holdings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own goals" ON goal_portfolios
  FOR ALL USING (auth.uid() = user_id);

-- goal_holdings no tiene user_id: se resuelve por la meta a la que pertenece
CREATE POLICY "Users manage own goal holdings" ON goal_holdings
  FOR ALL USING (
    EXISTS (SELECT 1 FROM goal_portfolios g WHERE g.id = goal_id AND g.user_id = auth.uid())
  );

CREATE INDEX idx_goal_holdings_goal ON goal_holdings(goal_id);
CREATE INDEX idx_goal_portfolios_user ON goal_portfolios(user_id);

-- ============================================================
-- La regla que evita el error obvio: no se puede apartar más de lo que tenés.
--
-- Va en un trigger y no solo en la UI porque hay dos caminos que la UI no
-- cubre: asignar el mismo símbolo a dos metas distintas, y vender en IOL una
-- posición que ya estaba comprometida.
-- ============================================================
CREATE OR REPLACE FUNCTION check_goal_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  owner UUID;
  held NUMERIC;
  allocated NUMERIC;
BEGIN
  SELECT user_id INTO owner FROM goal_portfolios WHERE id = NEW.goal_id;

  SELECT COALESCE(quantity, 0) INTO held
  FROM positions WHERE user_id = owner AND symbol = NEW.symbol;

  IF held IS NULL OR held = 0 THEN
    RAISE EXCEPTION 'No tenés % en tu cartera', NEW.symbol;
  END IF;

  -- Suma de lo apartado en TODAS las metas, excluyendo la fila que se edita
  SELECT COALESCE(SUM(gh.quantity), 0) INTO allocated
  FROM goal_holdings gh
  JOIN goal_portfolios g ON g.id = gh.goal_id
  WHERE g.user_id = owner
    AND gh.symbol = NEW.symbol
    AND gh.id IS DISTINCT FROM NEW.id;

  IF allocated + NEW.quantity > held THEN
    RAISE EXCEPTION
      'Estás asignando % de % pero tenés % y ya hay % apartadas en otras metas',
      NEW.quantity, NEW.symbol, held, allocated;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER goal_holdings_allocation_check
  BEFORE INSERT OR UPDATE ON goal_holdings
  FOR EACH ROW EXECUTE FUNCTION check_goal_allocation();

-- ============================================================
-- Vista con el valor actual de cada meta.
-- security_invoker: respeta las policies del usuario que consulta.
-- ============================================================
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
    g.created_at,
    COALESCE(SUM(gh.quantity * p.current_price), 0) AS current_value,
    COALESCE(SUM(gh.quantity * p.avg_buy_price), 0) AS cost_basis,
    COUNT(gh.id) AS holdings_count,
    -- Si vendiste y quedaste por debajo de lo asignado, la meta queda marcada
    -- en vez de mostrar un valor que ya no existe
    BOOL_OR(gh.quantity > p.quantity) AS over_allocated
  FROM goal_portfolios g
  LEFT JOIN goal_holdings gh ON gh.goal_id = g.id
  LEFT JOIN positions p ON p.symbol = gh.symbol AND p.user_id = g.user_id
  GROUP BY g.id;

GRANT SELECT ON goal_summary TO authenticated;
