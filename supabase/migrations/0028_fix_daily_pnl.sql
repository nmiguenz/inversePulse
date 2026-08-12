-- ============================================================
-- Borrar los resultados diarios mal calculados
--
-- La 0027 calculó el resultado de cada día como la diferencia entre el valor
-- total de un día y el del anterior, descontando aportes y retiros. Está mal:
-- `total_value` son las POSICIONES, sin el efectivo.
--
-- Vender un CEDEAR o rescatar un FCI mueve plata de las posiciones a la
-- cuenta. El total cae por el monto de la venta y eso figuraba como pérdida
-- del día. Un rescate de $754.000 apareció como una pérdida de $754.000 sin
-- que el mercado se hubiera movido — el dueño lo detectó mirando el 10/8.
--
-- El cálculo correcto, ya desplegado en fetch-portfolio, es la suma de cuánto
-- se movió cada producto: `valorizado - valorizado / (1 + variacionDiaria)`.
-- Así comprar, vender, rescatar, ingresar o retirar no mueven el número.
-- ============================================================

-- Los valores viejos NO se pueden recalcular. Haría falta saber qué cantidad
-- de cada activo había cada día, y eso no se guarda: `price_history` tiene los
-- cierres por símbolo, pero no las tenencias históricas. Justamente porque las
-- cantidades cambiaron —hubo ventas y rescates— no hay forma de reconstruirlo.
--
-- Así que se borran. Un gráfico vacío que se vuelve a llenar desde hoy es
-- mejor que uno lleno de números que no son ciertos, sobre todo cuando el
-- número es plata.
UPDATE portfolio_snapshots
SET daily_pnl = NULL
WHERE daily_pnl IS NOT NULL;

COMMENT ON COLUMN portfolio_snapshots.daily_pnl IS
  'Ganancia o pérdida del día por movimiento de PRECIOS: suma de la variación diaria de cada posición. No lo afectan compras, ventas, rescates, aportes ni retiros. NULL cuando no se pudo medir.';

COMMENT ON COLUMN portfolio_snapshots.net_cash_flow IS
  'Aportes menos retiros del día. Ya no entra en daily_pnl; lo usa el rendimiento del período para no contar un aporte como ganancia.';
