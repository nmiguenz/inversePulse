-- ============================================================
-- Borrar el resultado de los días en que no hubo rueda
--
-- `fetch-portfolio` guardaba un snapshot cada vez que corría, sin preguntarse
-- si el mercado había operado. Un sábado, un domingo o un feriado los precios
-- no se mueven, pero IOL sigue devolviendo la variación del último día operado
-- — así que el resultado de la jornada anterior se guardaba de nuevo.
--
-- El fin de semana del 15/8/2026 más el feriado del lunes 17 (Paso a la
-- Inmortalidad del Gral. San Martín) hicieron que el viernes 14 se contara
-- CUATRO veces: -49.897 repetido en el 15, el 16 y el 17. El gráfico mostraba
-- -293.800 de pérdida en el período cuando la real era -146.832, y decía
-- "2 de 9 días en positivo" cuando eran 2 de 6.
--
-- NULL y no cero: cero afirma "no ganaste ni perdiste", que es distinto de "no
-- se sabe". Es el mismo criterio que ya usaba el primer día de la serie, que no
-- tiene contra qué compararse.
--
-- De acá en adelante lo previene `isTradingDay` en _shared/market.ts, que lee
-- el calendario de feriados de argentinadatos.com.
-- ============================================================

-- 1. Fines de semana: no hace falta calendario, alcanza el día de la semana.
UPDATE portfolio_snapshots
SET daily_pnl = NULL
WHERE daily_pnl IS NOT NULL
  AND EXTRACT(ISODOW FROM snapshot_date) IN (6, 7);

-- 2. Feriados y cualquier otro día sin rueda, sin necesidad de conocerlos: si
--    la valuación total quedó IDÉNTICA a la del snapshot anterior, no se movió
--    ni un precio. Con carteras de siete cifras, dos totales exactamente
--    iguales no son una coincidencia: son el mismo cierre repetido.
WITH sin_movimiento AS (
  SELECT id
  FROM (
    SELECT
      id,
      total_value,
      daily_pnl,
      LAG(total_value) OVER (PARTITION BY user_id ORDER BY snapshot_date) AS total_previo
    FROM portfolio_snapshots
  ) t
  WHERE daily_pnl IS NOT NULL
    AND total_previo IS NOT NULL
    AND total_value = total_previo
)
UPDATE portfolio_snapshots
SET daily_pnl = NULL
WHERE id IN (SELECT id FROM sin_movimiento);
