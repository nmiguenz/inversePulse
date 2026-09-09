-- ============================================================
-- Evaluación a 7 y 14 días, además de la de 30
--
-- `evaluate-recommendations` medía todo a 30 días, incluidas las
-- recomendaciones con `time_horizon = 'short'`, que el propio prompt define
-- como "1-4 semanas". Una sugerencia de corto plazo juzgada recién al mes se
-- mide en una ventana que no es la suya: para cuando se evalúa, la tesis ya
-- venció.
--
-- Las columnas de 30 días NO se tocan ni se renombran a `*_30d`: las lee el
-- frontend (Opportunities.tsx) y el track record del asesor. Los horizontes
-- nuevos se agregan al lado, cada uno con su precio, su porcentaje, su verdict
-- y su marca de evaluado — esa última es la que hace que cada horizonte se
-- evalúe una sola vez y de forma independiente de los otros dos.
--
-- Solo la evaluación de 30 días cierra la recomendación (`is_active = false`).
-- Las de 7 y 14 son mediciones intermedias: la sugerencia sigue viva.
-- ============================================================

ALTER TABLE recommendations
  ADD COLUMN IF NOT EXISTS price_after_7d numeric,
  ADD COLUMN IF NOT EXISTS outcome_7d_pct numeric,
  ADD COLUMN IF NOT EXISTS outcome_7d_verdict text,
  ADD COLUMN IF NOT EXISTS evaluated_7d_at timestamptz,
  ADD COLUMN IF NOT EXISTS price_after_14d numeric,
  ADD COLUMN IF NOT EXISTS outcome_14d_pct numeric,
  ADD COLUMN IF NOT EXISTS outcome_14d_verdict text,
  ADD COLUMN IF NOT EXISTS evaluated_14d_at timestamptz;

COMMENT ON COLUMN recommendations.outcome_7d_verdict IS
  'correcta | incorrecta | neutral — evaluada 7 días después';
COMMENT ON COLUMN recommendations.outcome_14d_verdict IS
  'correcta | incorrecta | neutral — evaluada 14 días después';

-- Cada corrida busca las pendientes de un horizonte: las que tienen la marca
-- en null y ya cumplieron los días. Sin índice eso es un scan de la tabla
-- entera por horizonte, todos los días.
CREATE INDEX IF NOT EXISTS idx_recommendations_pending_7d
  ON recommendations (created_at)
  WHERE evaluated_7d_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_recommendations_pending_14d
  ON recommendations (created_at)
  WHERE evaluated_14d_at IS NULL;
