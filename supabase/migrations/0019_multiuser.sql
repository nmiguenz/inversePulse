-- ============================================================
-- Multiusuario: credenciales y key de IA por persona
--
-- Hasta acá la app tenía un solo dueño: las credenciales de IOL y la key de
-- Anthropic eran secrets globales y las funciones las usaban para todos. Esto
-- mueve las dos cosas a la base, por usuario y cifradas.
-- ============================================================

-- ============================================
-- 1. CONEXIÓN AL BROKER
-- ============================================

-- La tabla NO se renombra a `broker_connections` a pesar de que el nombre va a
-- quedar corto. El rename obliga a tocar cuatro Edge Functions y la vista
-- `iol_status` en la misma tanda que el cambio de seguridad, y no aporta nada
-- funcional: es churn con riesgo. Se hace cuando entre el segundo broker, que
-- es cuando el nombre empieza a mentir de verdad.
ALTER TABLE iol_credentials
  ADD COLUMN IF NOT EXISTS broker TEXT NOT NULL DEFAULT 'iol',
  ADD COLUMN IF NOT EXISTS account_label TEXT,
  ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ,
  -- Los tokens pasan a guardarse cifrados. Las columnas viejas quedan para no
  -- cortar el sync del dueño mientras se migra; el código lee la cifrada y cae
  -- a la vieja si está vacía.
  ADD COLUMN IF NOT EXISTS refresh_token_enc TEXT,
  ADD COLUMN IF NOT EXISTS access_token_enc TEXT;

COMMENT ON COLUMN iol_credentials.refresh_token_enc IS
  'Cifrado con AES-GCM. La clave vive en un secret de las Edge Functions, FUERA de la base: un dump de Postgres no alcanza para descifrarlo.';

COMMENT ON TABLE iol_credentials IS
  'Conexión al broker por usuario. NUNCA guarda la contraseña: se canjea una vez por tokens en connect-broker y se descarta.';

-- ============================================
-- 2. KEY DE IA POR USUARIO
-- ============================================

CREATE TABLE IF NOT EXISTS user_api_keys (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'anthropic',
  -- Cifrada, igual que los tokens del broker
  api_key_enc TEXT NOT NULL,
  -- Los últimos 4 caracteres, para que el usuario reconozca cuál cargó sin
  -- que la app tenga que mostrar (ni poder mostrar) la key entera
  key_hint TEXT,
  last_used_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_api_keys ENABLE ROW LEVEL SECURITY;

-- Sin policy de SELECT a propósito: ni siquiera el dueño puede leer su propia
-- key desde el cliente. Solo las Edge Functions, con la service role key.
-- El frontend usa la vista de abajo para saber si hay una cargada.
CREATE POLICY "Users delete own api key" ON user_api_keys
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE VIEW api_key_status
WITH (security_invoker = true)
AS
  SELECT user_id, provider, key_hint, last_used_at, last_error, updated_at
  FROM user_api_keys
  WHERE user_id = auth.uid();

GRANT SELECT ON api_key_status TO authenticated;

-- ============================================
-- 3. CALENDARIO DE EARNINGS POR USUARIO
-- ============================================
--
-- 0008 lo dejó global con escritura para cualquier autenticado, y lo dijo en su
-- comentario: "en una app multi-tenant esto iría por una Edge Function con
-- service role; acá el trade-off es aceptable y explícito". Deja de serlo en
-- cuanto entra un segundo usuario: hoy cualquiera podría borrar o cambiar las
-- fechas de otro.

ALTER TABLE earnings_calendar
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- Las filas que ya existen son del único usuario que hubo hasta ahora
UPDATE earnings_calendar e
SET user_id = (SELECT id FROM users ORDER BY created_at LIMIT 1)
WHERE e.user_id IS NULL;

DROP POLICY IF EXISTS "Authenticated read earnings" ON earnings_calendar;
DROP POLICY IF EXISTS "Authenticated write earnings" ON earnings_calendar;
DROP POLICY IF EXISTS "Authenticated update earnings" ON earnings_calendar;
DROP POLICY IF EXISTS "Authenticated delete earnings" ON earnings_calendar;

CREATE POLICY "Users manage own earnings" ON earnings_calendar
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_earnings_user
  ON earnings_calendar(user_id, report_date) WHERE is_reported = false;
