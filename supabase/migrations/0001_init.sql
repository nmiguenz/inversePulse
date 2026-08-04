-- ============================================================
-- IOL Portfolio Monitor — schema inicial
-- Correr en Supabase → SQL Editor (o `supabase db push`)
-- Basado en docs/CLAUDE.md, con 3 ajustes marcados como [AJUSTE]
-- ============================================================

-- ============================================
-- USUARIOS
-- [AJUSTE 1] id referencia auth.users(id) en vez de gen_random_uuid():
-- las policies usan `auth.uid() = id`, así que el id TIENE que ser el de Auth.
-- ============================================
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  push_subscription JSONB,
  settings JSONB DEFAULT '{
    "take_profit_pct": 20,
    "stop_loss_pct": -15,
    "rebalance_pct": 15,
    "sector_concentration_pct": 50,
    "daily_extreme_pct": 5,
    "idle_cash_threshold": 50000,
    "monitoring_start": "10:00",
    "monitoring_end": "18:00",
    "notify_critical": true,
    "notify_warning": true,
    "notify_info": true
  }'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- POSICIONES ACTUALES
-- ============================================
CREATE TABLE positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  description TEXT,
  quantity NUMERIC NOT NULL DEFAULT 0,
  avg_buy_price NUMERIC NOT NULL DEFAULT 0,
  current_price NUMERIC DEFAULT 0,
  previous_close NUMERIC DEFAULT 0,
  sector TEXT NOT NULL, -- Tech, Energía, Defensivo, CER, Renta Fija, Liquidez
  asset_type TEXT NOT NULL, -- CEDEAR, FCI, BONO
  currency TEXT DEFAULT 'ARS',
  rescue_time TEXT, -- T+0, T+1, T+2 (para ranking de liquidez)
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, symbol)
);

-- ============================================
-- HISTORIAL DE PRECIOS (sparklines y gráficos)
-- ============================================
CREATE TABLE price_history (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  open_price NUMERIC,
  close_price NUMERIC NOT NULL,
  high_price NUMERIC,
  low_price NUMERIC,
  volume NUMERIC,
  recorded_at DATE NOT NULL,
  UNIQUE(symbol, recorded_at)
);

-- ============================================
-- REGLAS DE ALERTA
-- ============================================
CREATE TABLE alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL,
  -- take_profit, stop_loss, rebalance, sector_concentration,
  -- daily_extreme, idle_cash, opportunity_buy, news_negative
  threshold NUMERIC NOT NULL,
  symbol TEXT, -- NULL = aplica a todos
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- ALERTAS DISPARADAS
-- ============================================
CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES alert_rules(id),
  alert_type TEXT NOT NULL,
  symbol TEXT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL, -- critical, warning, info, opportunity
  action_suggested TEXT, -- "Vender 4 MSFT", "Comprar 10 NVDA"
  is_read BOOLEAN DEFAULT false,
  is_dismissed BOOLEAN DEFAULT false,
  push_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- OPERACIONES HISTÓRICAS
-- ============================================
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL, -- buy, sell
  quantity NUMERIC NOT NULL,
  price NUMERIC NOT NULL,
  total NUMERIC NOT NULL,
  notes TEXT,
  executed_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- NOTICIAS ECONÓMICAS
-- ============================================
CREATE TABLE news (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  source TEXT NOT NULL, -- ambito, cronista, lanacion, reuters, bloomberg, cnbc
  url TEXT UNIQUE,
  summary TEXT, -- generado por Claude API
  sentiment TEXT, -- positive, negative, neutral
  impact_level TEXT, -- high, medium, low
  related_symbols TEXT[],
  tags TEXT[],
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- TEMÁTICAS MUNDIALES (tags interactivos)
-- ============================================
CREATE TABLE world_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  emoji TEXT,
  description TEXT,
  keywords TEXT[] NOT NULL,
  related_symbols TEXT[],
  is_active BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0
);

INSERT INTO world_topics (slug, label, emoji, keywords, related_symbols, sort_order) VALUES
  ('ia-semiconductores', 'IA y Semiconductores', '🤖', '{IA, AI, artificial intelligence, NVIDIA, AMD, chip, semiconductor, GPU, datacenter, training, inference}', '{NVDA, AMD, AVGO, MSFT, GOOGL, AMZN}', 1),
  ('fed-tasas', 'Fed y Tasas', '🏦', '{Fed, Federal Reserve, interest rate, tasa, Powell, Warsh, FOMC, monetary policy, inflation}', '{MSFT, AMZN, GOOGL, NVDA}', 2),
  ('petroleo-geopolitica', 'Petróleo y Geopolítica', '🛢️', '{oil, petróleo, OPEC, Irán, Iran, crude, Brent, WTI, energy, guerra, war, sanctions}', '{XOM, CVX}', 3),
  ('dolar-argentina', 'Dólar Argentina', '💵', '{dólar, dollar, MEP, CCL, blue, BCRA, cepo, banda, devaluación, tipo de cambio, reservas}', '{}', 4),
  ('earnings-season', 'Earnings Season', '📊', '{earnings, revenue, EPS, guidance, quarterly, results, beat, miss, outlook}', '{MSFT, AMZN, GOOGL, NVDA, AMD, AVGO}', 5),
  ('china-trade', 'China y Comercio', '🇨🇳', '{China, tariff, arancel, trade war, export control, Taiwan, TSMC}', '{NVDA, AMD, AVGO}', 6),
  ('europa-defensa', 'Europa y Defensa', '🇪🇺', '{Europe, NATO, defense, defensa, rearmament, Lockheed, RTX, military}', '{}', 7),
  ('crypto-fintech', 'Crypto y Fintech', '₿', '{Bitcoin, crypto, blockchain, fintech, DeFi, regulation, SEC}', '{}', 8);

-- ============================================
-- OPORTUNIDADES (generadas por AI)
-- ============================================
CREATE TABLE opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  opportunity_type TEXT NOT NULL, -- buy_signal, momentum, undervalued, sector_rotation, earnings_play
  title TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  growth_estimate_pct NUMERIC,
  confidence TEXT, -- high, medium, low
  time_horizon TEXT, -- short, medium, long
  current_price NUMERIC,
  target_price NUMERIC,
  related_news_ids UUID[],
  is_active BOOLEAN DEFAULT true,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- COTIZACIONES DÓLAR
-- ============================================
CREATE TABLE dollar_rates (
  id BIGSERIAL PRIMARY KEY,
  rate_type TEXT NOT NULL, -- mep, ccl, blue, oficial, cripto
  buy_price NUMERIC,
  sell_price NUMERIC,
  spread NUMERIC,
  recorded_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- CALENDARIO DE EARNINGS
-- ============================================
CREATE TABLE earnings_calendar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  report_date DATE NOT NULL,
  time_of_day TEXT, -- before_open, after_close
  estimated_eps NUMERIC,
  actual_eps NUMERIC,
  estimated_revenue NUMERIC,
  actual_revenue NUMERIC,
  is_reported BOOLEAN DEFAULT false,
  UNIQUE(symbol, report_date)
);

-- ============================================
-- BALANCE DE CUENTA
-- ============================================
CREATE TABLE account_balance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  available_ars NUMERIC DEFAULT 0,
  committed_ars NUMERIC DEFAULT 0,
  available_usd NUMERIC DEFAULT 0,
  total_portfolio_value NUMERIC DEFAULT 0,
  total_gain_loss NUMERIC DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- PORTFOLIO SNAPSHOTS
-- ============================================
CREATE TABLE portfolio_snapshots (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  total_value NUMERIC NOT NULL,
  cedears_value NUMERIC,
  fci_value NUMERIC,
  bonds_value NUMERIC,
  cash_value NUMERIC,
  snapshot_date DATE NOT NULL,
  UNIQUE(user_id, snapshot_date)
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_positions_user ON positions(user_id);
CREATE INDEX idx_alerts_user_unread ON alerts(user_id, is_read);
CREATE INDEX idx_news_published ON news(published_at DESC);
CREATE INDEX idx_news_symbols ON news USING GIN(related_symbols);
CREATE INDEX idx_news_tags ON news USING GIN(tags);
CREATE INDEX idx_opportunities_active ON opportunities(is_active, created_at DESC);
CREATE INDEX idx_price_history_symbol ON price_history(symbol, recorded_at DESC);
CREATE INDEX idx_dollar_rates_type ON dollar_rates(rate_type, recorded_at DESC);

-- ============================================
-- ROW LEVEL SECURITY
-- [AJUSTE 2] El spec define policies para news/world_topics/opportunities/
-- dollar_rates/earnings_calendar pero nunca les habilita RLS. Sin RLS activo
-- las policies no se aplican y esas tablas quedan abiertas con la anon key.
-- Acá se habilita en TODAS las tablas.
-- ============================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_balance ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE news ENABLE ROW LEVEL SECURITY;
ALTER TABLE world_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE dollar_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE earnings_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;

-- Cada usuario solo ve sus datos
CREATE POLICY "Users see own data" ON users FOR ALL USING (auth.uid() = id);
CREATE POLICY "Users see own positions" ON positions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users see own alerts" ON alerts FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users see own rules" ON alert_rules FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users see own transactions" ON transactions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users see own balance" ON account_balance FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users see own snapshots" ON portfolio_snapshots FOR ALL USING (auth.uid() = user_id);

-- Tablas públicas (lectura para autenticados)
CREATE POLICY "Authenticated read news" ON news FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read topics" ON world_topics FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read opportunities" ON opportunities FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read dollar" ON dollar_rates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read earnings" ON earnings_calendar FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read prices" ON price_history FOR SELECT TO authenticated USING (true);
-- La escritura en estas tablas la hacen las Edge Functions con la service role key,
-- que bypassea RLS. Por eso no hay policies de INSERT/UPDATE.

-- ============================================
-- [AJUSTE 3] ALTA AUTOMÁTICA DE USUARIO
-- Al registrarse por magic link, crea la fila en public.users con los settings
-- por defecto + las alert_rules iniciales (Fase 3 las usa).
-- ============================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  defaults JSONB;
BEGIN
  INSERT INTO public.users (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;

  SELECT settings INTO defaults FROM public.users WHERE id = NEW.id;

  INSERT INTO public.alert_rules (user_id, rule_type, threshold) VALUES
    (NEW.id, 'take_profit',            (defaults->>'take_profit_pct')::numeric),
    (NEW.id, 'stop_loss',              (defaults->>'stop_loss_pct')::numeric),
    (NEW.id, 'rebalance',              (defaults->>'rebalance_pct')::numeric),
    (NEW.id, 'sector_concentration',   (defaults->>'sector_concentration_pct')::numeric),
    (NEW.id, 'daily_extreme',          (defaults->>'daily_extreme_pct')::numeric),
    (NEW.id, 'idle_cash',              (defaults->>'idle_cash_threshold')::numeric);

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
