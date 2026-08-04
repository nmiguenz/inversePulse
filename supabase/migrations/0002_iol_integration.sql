-- ============================================================
-- Fase 2 — Integración con IOL
-- ============================================================

-- ============================================
-- CREDENCIALES / TOKENS DE IOL
-- El refresh token de IOL ROTA en cada renovación, así que no puede vivir
-- en una env var (son inmutables en runtime). Se guarda acá y solo lo tocan
-- las Edge Functions con la service role key.
-- RLS habilitado SIN policies = nadie llega con la anon key.
-- ============================================
CREATE TABLE iol_credentials (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  refresh_token TEXT,
  access_token TEXT,
  access_token_expires_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  last_sync_error TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE iol_credentials ENABLE ROW LEVEL SECURITY;

-- El frontend necesita saber si la cuenta está conectada y cuándo fue el último
-- sync, pero NUNCA los tokens. Vista security definer (owner postgres) que
-- expone solo esas 3 columnas y filtra por el usuario logueado.
-- Ojo: no ponerle policies de SELECT a iol_credentials — eso le daría al
-- frontend acceso a los tokens con la anon key.
CREATE VIEW iol_status AS
  SELECT
    c.user_id,
    (c.refresh_token IS NOT NULL) AS is_connected,
    c.last_sync_at,
    c.last_sync_error
  FROM iol_credentials c
  WHERE c.user_id = auth.uid();

GRANT SELECT ON iol_status TO authenticated;

-- ============================================
-- METADATOS DE ACTIVOS
-- El portafolio de IOL no trae sector ni plazo de rescate; se resuelven acá.
-- Tabla editable para no hardcodear el mapeo en el código.
-- ============================================
CREATE TABLE asset_metadata (
  symbol TEXT PRIMARY KEY,
  sector TEXT NOT NULL,          -- Tech, Energía, Defensivo, CER, Renta Fija, Liquidez
  asset_type TEXT,               -- CEDEAR, FCI, BONO
  rescue_time TEXT,              -- T+0, T+1, T+2
  display_name TEXT
);

ALTER TABLE asset_metadata ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read asset metadata" ON asset_metadata
  FOR SELECT TO authenticated USING (true);

INSERT INTO asset_metadata (symbol, sector, asset_type, rescue_time, display_name) VALUES
  ('MSFT',  'Tech',       'CEDEAR', 'T+1', 'Microsoft'),
  ('NVDA',  'Tech',       'CEDEAR', 'T+1', 'NVIDIA'),
  ('AMD',   'Tech',       'CEDEAR', 'T+1', 'Advanced Micro Devices'),
  ('AVGO',  'Tech',       'CEDEAR', 'T+1', 'Broadcom'),
  ('AMZN',  'Tech',       'CEDEAR', 'T+1', 'Amazon'),
  ('GOOGL', 'Tech',       'CEDEAR', 'T+1', 'Alphabet'),
  ('AAPL',  'Tech',       'CEDEAR', 'T+1', 'Apple'),
  ('META',  'Tech',       'CEDEAR', 'T+1', 'Meta Platforms'),
  ('TSLA',  'Tech',       'CEDEAR', 'T+1', 'Tesla'),
  ('XOM',   'Energía',    'CEDEAR', 'T+1', 'Exxon Mobil'),
  ('CVX',   'Energía',    'CEDEAR', 'T+1', 'Chevron'),
  ('KO',    'Defensivo',  'CEDEAR', 'T+1', 'Coca-Cola'),
  ('JNJ',   'Defensivo',  'CEDEAR', 'T+1', 'Johnson & Johnson'),
  ('PG',    'Defensivo',  'CEDEAR', 'T+1', 'Procter & Gamble'),
  ('WMT',   'Defensivo',  'CEDEAR', 'T+1', 'Walmart')
ON CONFLICT (symbol) DO NOTHING;

-- ============================================
-- price_history: el upsert diario necesita la unique key explícita
-- (ya existe UNIQUE(symbol, recorded_at) en 0001, esto solo documenta el uso)
-- ============================================
CREATE INDEX IF NOT EXISTS idx_price_history_recent ON price_history(recorded_at DESC);
