-- ============================================================
-- Fase 4 — Fuentes RSS y análisis de noticias
-- ============================================================

-- ============================================
-- FUENTES RSS
-- Configurables desde la base, igual que asset_metadata: agregar o desactivar
-- una fuente no debería requerir un deploy.
-- ============================================
CREATE TABLE rss_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,        -- coincide con news.source
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  language TEXT DEFAULT 'es',
  enabled BOOLEAN DEFAULT true,
  last_fetched_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE rss_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read rss sources" ON rss_sources
  FOR SELECT TO authenticated USING (true);
-- La escritura la hacen las Edge Functions con la service role key (bypassea RLS).

-- URLs verificadas una por una antes de sembrarlas. Tres de las fuentes que
-- pedía el spec ya no sirven:
--   · Reuters y Bloomberg discontinuaron sus RSS públicos → se reemplazan por
--     MarketWatch (Dow Jones) e Investing.com, que cubren el mismo terreno.
--   · Los feeds de La Nación y El Cronista se mudaron a /arc/outboundfeeds/.
INSERT INTO rss_sources (slug, name, url, language) VALUES
  ('ambito',      'Ámbito Financiero',  'https://www.ambito.com/rss/pages/economia.xml',                    'es'),
  ('cronista',    'El Cronista',        'https://www.cronista.com/arc/outboundfeeds/rss/?outputType=xml',   'es'),
  ('lanacion',    'La Nación',          'https://www.lanacion.com.ar/arc/outboundfeeds/rss/?outputType=xml','es'),
  ('cnbc',        'CNBC',               'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', 'en'),
  ('yahoo',       'Yahoo Finance',      'https://finance.yahoo.com/news/rssindex',                          'en'),
  ('marketwatch', 'MarketWatch',        'https://feeds.content.dowjones.io/public/rss/mw_topstories',       'en'),
  ('investing',   'Investing.com',      'https://www.investing.com/rss/news_25.rss',                        'en')
ON CONFLICT (slug) DO NOTHING;

-- ============================================
-- NOTICIAS: metadatos del análisis
-- ============================================
ALTER TABLE news
  ADD COLUMN IF NOT EXISTS analyzed_with TEXT,       -- modelo que produjo el análisis
  ADD COLUMN IF NOT EXISTS analyzed_at TIMESTAMPTZ;

COMMENT ON COLUMN news.analyzed_with IS
  'Model ID que generó summary/sentiment/impact_level. Permite comparar resultados al cambiar de modelo.';

-- El feed se ordena por fecha y se filtra por tag; el índice de tags (GIN) ya
-- existe desde 0001. Falta el compuesto para la query real del frontend.
CREATE INDEX IF NOT EXISTS idx_news_recent ON news(published_at DESC NULLS LAST, created_at DESC);
