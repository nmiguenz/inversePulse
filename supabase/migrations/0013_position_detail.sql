-- ============================================================
-- Datos por posición que IOL manda y estábamos descartando
--
-- `comprometido`: cuántas unidades están reservadas por una orden puesta.
-- Es lo que IOL usa para mostrar "Comprometido" y "Disponible para operar".
--
-- `variacionDiaria`: hoy la convertimos a previous_close y el frontend la
-- vuelve a derivar. El ida y vuelta es exacto (verificado: AMD da -8,29% igual
-- que IOL), así que no arregla ningún número — saca un paso intermedio y evita
-- la división por cero cuando previous_close es 0.
-- ============================================================

ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS committed_quantity NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_change_pct NUMERIC;

COMMENT ON COLUMN positions.committed_quantity IS
  'Unidades reservadas por órdenes puestas. quantity - committed_quantity = disponible para operar.';

COMMENT ON COLUMN positions.daily_change_pct IS
  'variacionDiaria de IOL, tal cual. previous_close queda como respaldo para filas viejas.';
