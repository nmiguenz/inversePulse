-- ============================================================
-- La vista de estado de la API key nunca devolvía nada
--
-- La 0019 la creó con `security_invoker = true`, lo que hace que las policies
-- de `user_api_keys` se evalúen con los permisos de quien consulta. Y esa tabla
-- NO tiene policy de SELECT — a propósito, para que la key no se pueda leer
-- desde el cliente ni con la sesión del dueño.
--
-- Resultado: la vista devolvía cero filas siempre, y Configuración mostraba
-- "Sin API key de Claude" con la key perfectamente cargada y funcionando. La
-- propia migración se contradecía: el comentario decía "el frontend usa la
-- vista de abajo para saber si hay una cargada".
--
-- Se recrea como security DEFINER (el default), igual que `iol_status`, que
-- funciona bien justamente por eso. El `WHERE user_id = auth.uid()` es lo que
-- acota a cada usuario, y las columnas expuestas siguen sin incluir la key: el
-- hint son los últimos cuatro caracteres.
-- ============================================================

DROP VIEW IF EXISTS api_key_status;

CREATE VIEW api_key_status AS
  SELECT
    user_id,
    provider,
    key_hint,
    last_used_at,
    last_error,
    created_at,
    updated_at
  FROM user_api_keys
  WHERE user_id = auth.uid();

GRANT SELECT ON api_key_status TO authenticated;
