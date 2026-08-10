-- ============================================================
-- Sesión de IOL estable, IA por usuario y horarios de mercado
--
-- La conexión con IOL se moría sola. Los datos del viernes:
--
--   conectado           21:08
--   token válido hasta  21:28   (20 minutos)
--   último sync OK      21:20
--   último error        21:55
--
-- Seis corridas seguidas fallaron y ninguna se recuperó. Un choque puntual
-- dejaría que una gane; que fallen todas significa que el refresh token quedó
-- inservible de forma permanente.
--
-- CAUSA: `fetch-portfolio` (*/5 13-21) y `fetch-transactions` (30 21) salieron
-- juntas a las 21:30 con el access token recién vencido. Las dos leyeron el
-- mismo refresh token y las dos lo renovaron. IOL lo ROTA en cada uso: una lo
-- consumió y la otra escribió encima el valor ya gastado.
-- ============================================================

-- ============================================
-- 1. UN SOLO PROCESO RENOVANDO
-- ============================================

ALTER TABLE iol_credentials
  ADD COLUMN IF NOT EXISTS refresh_lock_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN iol_credentials.refresh_lock_until IS
  'Candado con vencimiento. Quien logra ponerlo renueva el token; el resto espera y relee. Vence solo para que un proceso muerto a la mitad no deje la conexión trabada.';

COMMENT ON COLUMN iol_credentials.token_version IS
  'Se incrementa en cada guardado. Al persistir se exige la versión leída, así una escritura tardía no puede pisar un token nuevo con uno ya consumido — que es exactamente lo que rompió la conexión.';

-- ============================================
-- 2. NOTICIAS: EL ANÁLISIS ES DE CADA UNO
-- ============================================
--
-- `fetch-news` analizaba una vez con la primera key disponible y guardaba el
-- resultado en la tabla global: el dueño de esa key pagaba el análisis de
-- todos.
--
-- Se separa lo gratis de lo que cuesta. El artículo crudo sale del RSS y sigue
-- siendo compartido; el análisis pasa a ser por usuario y con su propia key.
--
-- No es solo quién paga: el análisis YA dependía de la cartera —qué símbolos
-- toca la noticia, qué tan relevante es— así que uno compartido estaba
-- calculado sobre las tenencias de otro.
CREATE TABLE IF NOT EXISTS news_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  news_id UUID NOT NULL REFERENCES news(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  summary TEXT,
  sentiment TEXT,
  impact_level TEXT,
  related_symbols TEXT[],
  tags TEXT[],
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(news_id, user_id)
);

ALTER TABLE news_analysis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own news analysis" ON news_analysis
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_news_analysis_user
  ON news_analysis(user_id, created_at DESC);

-- ============================================
-- 3. IA FUERA DEL HORARIO DE MERCADO
-- ============================================

UPDATE users
SET settings = settings || jsonb_build_object('allow_ai_after_hours', false)
WHERE NOT (settings ? 'allow_ai_after_hours');

ALTER TABLE users ALTER COLUMN settings SET DEFAULT '{
  "take_profit_pct": 0,
  "stop_loss_pct": -15,
  "rebalance_pct": 15,
  "sector_concentration_pct": 50,
  "daily_extreme_pct": 5,
  "idle_cash_threshold": 50000,
  "trailing_stop_pct": 12,
  "trailing_min_gain_pct": 15,
  "rebuy_watch_pct": 10,
  "liquidity_floor_pct": 15,
  "risk_profile": "agresivo",
  "monitoring_start": "10:00",
  "monitoring_end": "18:00",
  "notify_decisions": true,
  "notify_opportunities": true,
  "notify_news": false,
  "review_period_days": 30,
  "muted_alerts": {},
  "allow_ai_after_hours": false
}'::jsonb;

-- ============================================
-- 4. HORARIOS
-- ============================================
-- BYMA opera 10:30-17:00 hora argentina = 13:30-20:00 UTC, lunes a viernes.
-- Argentina no tiene horario de verano, así que en UTC es fijo todo el año.

-- fetch-portfolio: cada 5 min DENTRO de la rueda. Antes arrancaba 13:00 (media
-- hora antes de la apertura) y seguía hasta las 21:55, dos horas después del
-- cierre, sincronizando precios que ya no se movían.
SELECT cron.unschedule('fetch-portfolio');
SELECT cron.schedule(
  'fetch-portfolio',
  '30-55/5 13 * * 1-5',
  $$ SELECT net.http_post(
       url := 'https://kfxnspxwmcepgzqycjfa.supabase.co/functions/v1/fetch-portfolio',
       headers := cron_auth_headers(), timeout_milliseconds := 30000); $$
);
SELECT cron.schedule(
  'fetch-portfolio-main',
  '*/5 14-19 * * 1-5',
  $$ SELECT net.http_post(
       url := 'https://kfxnspxwmcepgzqycjfa.supabase.co/functions/v1/fetch-portfolio',
       headers := cron_auth_headers(), timeout_milliseconds := 30000); $$
);

-- fetch-news: de 336 corridas por semana a 65. Solo en rueda: una noticia de
-- las 4 de la mañana del domingo no mueve ningún precio hasta el lunes.
SELECT cron.unschedule('fetch-news');
SELECT cron.schedule(
  'fetch-news',
  '*/30 14-19 * * 1-5',
  $$ SELECT net.http_post(
       url := 'https://kfxnspxwmcepgzqycjfa.supabase.co/functions/v1/fetch-news',
       headers := cron_auth_headers(), timeout_milliseconds := 150000); $$
);

-- portfolio-advisor: los dos momentos clave de la rueda.
--
--   15:00 UTC (12:00 ART) — hora y media después de la apertura local, y con
--   Wall Street ya abierto en cualquier época del año. Las 14:00 de antes caen
--   ANTES de la apertura de EE.UU. de noviembre a marzo, cuando allá abren
--   14:30 UTC.
--
--   19:00 UTC (16:00 ART) — una hora antes del cierre: se ve el movimiento del
--   día y todavía se puede operar.
SELECT cron.unschedule('portfolio-advisor');
SELECT cron.schedule(
  'portfolio-advisor',
  '0 15,19 * * 1-5',
  $$ SELECT net.http_post(
       url := 'https://kfxnspxwmcepgzqycjfa.supabase.co/functions/v1/portfolio-advisor',
       headers := cron_auth_headers(), timeout_milliseconds := 180000); $$
);

-- fetch-dollar-rates: acompaña la rueda. No usa IA ni el token de IOL.
SELECT cron.unschedule('fetch-dollar-rates');
SELECT cron.schedule(
  'fetch-dollar-rates',
  '*/10 14-19 * * 1-5',
  $$ SELECT net.http_post(
       url := 'https://kfxnspxwmcepgzqycjfa.supabase.co/functions/v1/fetch-dollar-rates',
       headers := cron_auth_headers(), timeout_milliseconds := 15000); $$
);

-- Los dos que chocaban con fetch-portfolio se corren a minutos que no comparte
-- con nadie. El candado ya lo hace seguro, pero dos procesos peleando por el
-- mismo token todos los días es algo que conviene no tener aunque esté cubierto.
SELECT cron.unschedule('fetch-market-quotes');
SELECT cron.schedule(
  'fetch-market-quotes',
  '17 20 * * 1-5',
  $$ SELECT net.http_post(
       url := 'https://kfxnspxwmcepgzqycjfa.supabase.co/functions/v1/fetch-market-quotes',
       headers := cron_auth_headers(), timeout_milliseconds := 120000); $$
);

SELECT cron.unschedule('fetch-transactions');
SELECT cron.schedule(
  'fetch-transactions',
  '37 20 * * 1-5',
  $$ SELECT net.http_post(
       url := 'https://kfxnspxwmcepgzqycjfa.supabase.co/functions/v1/fetch-transactions',
       headers := cron_auth_headers(), timeout_milliseconds := 60000); $$
);

-- ============================================
-- 5. QUE LA SESIÓN NO MUERA DE VIEJA
-- ============================================
--
-- Del viernes 21:55 al lunes 13:00 pasaban 63 horas sin renovar el token. Si
-- caduca por inactividad, la conexión aparece muerta cada lunes.
--
-- Es la excepción deliberada a la regla de horarios: NO sincroniza nada ni usa
-- IA, solo pide un access token. Mantener viva la sesión fuera del mercado es
-- justamente lo que evita tener que reconectar a mano.
SELECT cron.schedule(
  'keep-session-alive',
  '13 */6 * * *',
  $$ SELECT net.http_post(
       url := 'https://kfxnspxwmcepgzqycjfa.supabase.co/functions/v1/keep-session-alive',
       headers := cron_auth_headers(), timeout_milliseconds := 30000); $$
);
