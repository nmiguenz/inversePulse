-- ============================================================
-- Resultado diario guardado, y el monto en la alerta de efectivo
-- ============================================================

-- ============================================
-- 1. EL RESULTADO DE CADA DÍA
-- ============================================
--
-- La Evolución mostraba el VALOR total de la cartera día a día. Ese gráfico
-- responde "cuánto tengo", que ya está escrito arriba en letras grandes, y
-- esconde lo que en realidad se quiere ver: cuánto se ganó o se perdió cada
-- día. Una cartera que sube y baja 2% diario dibuja una línea casi plana.
--
-- El cálculo NO puede ser la simple resta entre dos días: un aporte de
-- $200.000 haría figurar una ganancia de $200.000. Hay que descontar los
-- movimientos de dinero, que es justamente para lo que existe la carga
-- manual de aportes y retiros.
--
-- Se guarda calculado en vez de derivarlo en el cliente porque el balance
-- mensual tiene que poder sumarse en la base, y porque el neto de caja de un
-- día depende de lo que se sabía ESE día.
ALTER TABLE portfolio_snapshots
  ADD COLUMN IF NOT EXISTS daily_pnl NUMERIC,
  ADD COLUMN IF NOT EXISTS net_cash_flow NUMERIC DEFAULT 0;

COMMENT ON COLUMN portfolio_snapshots.daily_pnl IS
  'Ganancia o pérdida del día: total de hoy menos el del día anterior con snapshot, descontando aportes y retiros. NULL en el primer día, que no tiene contra qué comparar.';

COMMENT ON COLUMN portfolio_snapshots.net_cash_flow IS
  'Aportes menos retiros del día. Se guarda aparte para poder recalcular daily_pnl si un movimiento se carga tarde.';

-- ---------- Backfill ----------
-- Los snapshots ya guardados tienen el total pero no el resultado. Se calcula
-- con LAG sobre la serie de cada usuario: "el día anterior CON SNAPSHOT", que
-- no es lo mismo que ayer — los fines de semana no hay corridas.
WITH flows AS (
  SELECT
    user_id,
    (executed_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS day,
    SUM(CASE WHEN kind = 'deposit' THEN total WHEN kind = 'withdrawal' THEN -total ELSE 0 END) AS net
  FROM transactions
  WHERE kind IN ('deposit', 'withdrawal')
  GROUP BY 1, 2
),
series AS (
  SELECT
    s.id,
    s.user_id,
    s.snapshot_date,
    s.total_value,
    LAG(s.total_value) OVER (PARTITION BY s.user_id ORDER BY s.snapshot_date) AS prev_value,
    COALESCE(f.net, 0) AS net
  FROM portfolio_snapshots s
  LEFT JOIN flows f ON f.user_id = s.user_id AND f.day = s.snapshot_date
)
UPDATE portfolio_snapshots ps
SET
  daily_pnl = series.total_value - series.prev_value - series.net,
  net_cash_flow = series.net
FROM series
WHERE ps.id = series.id
  AND series.prev_value IS NOT NULL
  AND ps.daily_pnl IS NULL;

-- ============================================
-- 2. EL MONTO EN LA ALERTA
-- ============================================
--
-- La alerta "¿Ingresaste $X?" tenía el número solo dentro del texto. Para que
-- al tocarla se abra el formulario ya completo, el monto tiene que ser un dato
-- y no algo que el frontend parsee del título — parsear un texto en castellano
-- se rompe el día que alguien cambia una palabra.
ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS amount NUMERIC;

COMMENT ON COLUMN alerts.amount IS
  'Monto asociado, cuando la alerta tiene uno. Hoy lo usa cash_flow_review para prellenar el formulario de aportes y retiros.';
