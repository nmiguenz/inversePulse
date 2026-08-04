-- ============================================================
-- Fase 5 — Universo de activos sugeribles
--
-- POR QUÉ: una oportunidad de inversión sirve justamente para activos que NO
-- tenés. Pero dejar que el modelo proponga cualquier ticker abre la puerta a
-- que sugiera algo que no cotiza como CEDEAR en BCBA — o que directamente no
-- existe. La solución es la misma que en las noticias, pero más fuerte:
-- `asset_metadata` pasa a ser el UNIVERSO CERRADO de lo que se puede sugerir,
-- y se le pasa al modelo como lista explícita.
--
-- Agregar un activo al universo = un INSERT acá, sin deploy.
-- ============================================================

ALTER TABLE asset_metadata
  ADD COLUMN IF NOT EXISTS suggestable BOOLEAN DEFAULT true;

COMMENT ON COLUMN asset_metadata.suggestable IS
  'Si el motor de oportunidades puede proponer este activo. Los FCI y bonos propios van en false.';

-- Los que ya están cargados son posiciones actuales; los FCI y bonos no son
-- candidatos a "oportunidad de inversión" en el sentido del spec.
UPDATE asset_metadata SET suggestable = false WHERE asset_type IN ('FCI', 'BONO');

-- CEDEARs líquidos en BCBA que el motor puede proponer. Sectores según el spec.
INSERT INTO asset_metadata (symbol, sector, asset_type, rescue_time, display_name) VALUES
  ('AAPL',  'Tech',       'CEDEAR', 'T+1', 'Apple'),
  ('META',  'Tech',       'CEDEAR', 'T+1', 'Meta Platforms'),
  ('TSLA',  'Tech',       'CEDEAR', 'T+1', 'Tesla'),
  ('TSM',   'Tech',       'CEDEAR', 'T+1', 'Taiwan Semiconductor'),
  ('QCOM',  'Tech',       'CEDEAR', 'T+1', 'Qualcomm'),
  ('INTC',  'Tech',       'CEDEAR', 'T+1', 'Intel'),
  ('ORCL',  'Tech',       'CEDEAR', 'T+1', 'Oracle'),
  ('CRM',   'Tech',       'CEDEAR', 'T+1', 'Salesforce'),
  ('NFLX',  'Tech',       'CEDEAR', 'T+1', 'Netflix'),
  ('PYPL',  'Tech',       'CEDEAR', 'T+1', 'PayPal'),
  ('SHOP',  'Tech',       'CEDEAR', 'T+1', 'Shopify'),
  ('COIN',  'Tech',       'CEDEAR', 'T+1', 'Coinbase'),
  ('SLB',   'Energía',    'CEDEAR', 'T+1', 'Schlumberger'),
  ('COP',   'Energía',    'CEDEAR', 'T+1', 'ConocoPhillips'),
  ('KO',    'Defensivo',  'CEDEAR', 'T+1', 'Coca-Cola'),
  ('PEP',   'Defensivo',  'CEDEAR', 'T+1', 'PepsiCo'),
  ('JNJ',   'Defensivo',  'CEDEAR', 'T+1', 'Johnson & Johnson'),
  ('PG',    'Defensivo',  'CEDEAR', 'T+1', 'Procter & Gamble'),
  ('WMT',   'Defensivo',  'CEDEAR', 'T+1', 'Walmart'),
  ('MCD',   'Defensivo',  'CEDEAR', 'T+1', "McDonald's"),
  ('DIS',   'Defensivo',  'CEDEAR', 'T+1', 'Disney'),
  ('JPM',   'Renta Fija', 'CEDEAR', 'T+1', 'JPMorgan Chase'),
  ('BAC',   'Renta Fija', 'CEDEAR', 'T+1', 'Bank of America'),
  ('V',     'Renta Fija', 'CEDEAR', 'T+1', 'Visa'),
  ('MA',    'Renta Fija', 'CEDEAR', 'T+1', 'Mastercard'),
  ('BRKB',  'Renta Fija', 'CEDEAR', 'T+1', 'Berkshire Hathaway B'),
  ('LMT',   'Defensivo',  'CEDEAR', 'T+1', 'Lockheed Martin'),
  ('RTX',   'Defensivo',  'CEDEAR', 'T+1', 'RTX Corporation'),
  ('GLD',   'Defensivo',  'CEDEAR', 'T+1', 'SPDR Gold Trust'),
  ('SPY',   'Renta Fija', 'CEDEAR', 'T+1', 'S&P 500 ETF'),
  ('QQQ',   'Tech',       'CEDEAR', 'T+1', 'Nasdaq 100 ETF')
ON CONFLICT (symbol) DO UPDATE SET suggestable = true;

-- ============================================
-- OPORTUNIDADES: trazabilidad del análisis
-- ============================================
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS analyzed_with TEXT,
  ADD COLUMN IF NOT EXISTS already_owned BOOLEAN DEFAULT false;

COMMENT ON COLUMN opportunities.already_owned IS
  'True si el activo ya está en cartera: la sugerencia es ampliar, no abrir posición.';

CREATE INDEX IF NOT EXISTS idx_opportunities_symbol_active
  ON opportunities(symbol, is_active);
