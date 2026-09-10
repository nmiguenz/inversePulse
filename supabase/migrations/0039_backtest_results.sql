-- ============================================================
-- Resultados del backtest del scoring
--
-- Una fila por semana simulada y por corrida. No se borra lo anterior: cada
-- corrida queda registrada con su `run_at` y su `strategy`, que es lo que
-- permite comparar 'score_v1' contra la versión que venga cuando se toquen los
-- pesos de `investmentScore`. Sin eso, ajustar los pesos sería mover números a
-- ciegas.
--
-- La tabla NO la escribe ningún CRON: el backtest se corre a mano, es pesado y
-- solo tiene sentido después de cambiar la estrategia o de acumular datos.
--
-- No hay RLS ni `user_id` a propósito: el backtest no simula la cartera de
-- nadie en particular, simula el scoring sobre el universo sugerible, que es
-- común a todos. Se escribe y se lee solo con la service role key.
-- ============================================================

CREATE TABLE IF NOT EXISTS backtest_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at timestamptz NOT NULL DEFAULT now(),
  strategy text NOT NULL,            -- 'score_v1' para esta versión
  week_start date NOT NULL,          -- la semana que se simuló
  selected_symbols text[] NOT NULL,  -- los 3 elegidos
  selected_scores jsonb,             -- {symbol: score} de cada elegido
  return_1w numeric,                 -- retorno promedio de los seleccionados a 1 semana
  return_2w numeric,
  return_4w numeric,
  spy_return_1w numeric,
  spy_return_2w numeric,
  spy_return_4w numeric,
  alpha_1w numeric,
  alpha_2w numeric,
  alpha_4w numeric
);

CREATE INDEX IF NOT EXISTS idx_backtest_strategy_week
  ON backtest_results(strategy, week_start);

COMMENT ON COLUMN backtest_results.alpha_4w IS
  'return_4w - spy_return_4w: es el número que dice si el scoring agrega valor';
COMMENT ON COLUMN backtest_results.selected_symbols IS
  'Vacío cuando ninguna semana llegó al score mínimo: no operar también es un resultado';
