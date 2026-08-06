-- ============================================================
-- Desglose del efectivo disponible
--
-- Hasta ahora se guardaba solo `cuentaArs.disponible`: un número plano que no
-- distingue la plata lista para operar hoy de la que viene de una venta que
-- todavía no liquidó.
--
-- IOL devuelve el detalle en `cuentas[].saldos`, una fila por plazo:
--   { liquidacion, saldo, comprometido, disponible, disponibleOperar }
--
-- Y expone DOS campos que la app trataba como uno: `disponible` no es lo mismo
-- que `disponibleOperar`. El segundo es lo que realmente se puede usar para
-- poner una orden, y es el que tiene que usar el asesor para dimensionar
-- compras — si no, puede sugerir montos que no se pueden ejecutar.
-- ============================================================

ALTER TABLE account_balance
  ADD COLUMN IF NOT EXISTS available_to_trade_ars NUMERIC,
  ADD COLUMN IF NOT EXISTS settlement_breakdown JSONB;

COMMENT ON COLUMN account_balance.available_to_trade_ars IS
  'disponibleOperar de IOL: lo que efectivamente se puede usar para una orden. Puede ser menor que available_ars.';

COMMENT ON COLUMN account_balance.settlement_breakdown IS
  'Array crudo de cuentas[].saldos de IOL, una fila por plazo de liquidación. Se guarda tal cual: las etiquetas de liquidacion se traducen en el frontend.';
