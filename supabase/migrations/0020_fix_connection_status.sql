-- ============================================================
-- La vista de estado miraba la columna equivocada
--
-- La 0019 movió los tokens a las columnas cifradas y `connect-broker` pone la
-- vieja en NULL a propósito, para que no quede nada en claro en la base. Pero
-- `iol_status` —que es lo único que el frontend puede leer— seguía calculando:
--
--   (c.refresh_token IS NOT NULL) AS is_connected
--
-- Resultado: la conexión se guardaba bien y la app mostraba "sin conectar"
-- para siempre. La cuenta quedaba conectada de verdad, con el token cifrado y
-- el sync andando, pero el botón seguía pidiendo conectar.
--
-- Se agregan de paso `account_label` y `connected_at`: sin ellos la pantalla no
-- puede decir QUÉ cuenta está conectada, que es justo lo que uno quiere ver
-- cuando duda de si funcionó.
-- ============================================================

DROP VIEW IF EXISTS iol_status;

CREATE VIEW iol_status AS
  SELECT
    c.user_id,
    -- Cualquiera de las dos: la cifrada es la que se usa de ahora en más, la
    -- vieja cubre las filas que todavía no pasaron por un refresh.
    (c.refresh_token_enc IS NOT NULL OR c.refresh_token IS NOT NULL) AS is_connected,
    c.broker,
    c.account_label,
    c.connected_at,
    c.last_sync_at,
    c.last_sync_error
  FROM iol_credentials c
  WHERE c.user_id = auth.uid();

-- Sigue siendo security definer (el default): tiene que poder leer
-- iol_credentials, que no tiene policy de SELECT justamente para que el
-- frontend nunca llegue a los tokens.
GRANT SELECT ON iol_status TO authenticated;
