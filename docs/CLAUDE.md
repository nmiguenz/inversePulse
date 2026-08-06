# CLAUDE.md — IOL Portfolio Monitor

## Qué es este proyecto

**IOL Portfolio Monitor** es una PWA de inversiones personales que conecta con IOL Inversiones (broker argentino) para monitorear una cartera en tiempo real, sugerir oportunidades de compra/venta, enviar notificaciones push, y mostrar un dashboard completo con toda la información que un inversor necesita para tomar decisiones rápidas y ganar dinero.

No es solo un visor de cartera — es un **asistente de inversión automatizado** que analiza noticias mundiales, detecta oportunidades, sugiere cuándo comprar y cuándo vender, y notifica al usuario al instante.

## Stack tecnológico

- **Frontend:** React 18 + Vite + TypeScript
- **Styling:** Tailwind CSS (custom dark theme — ver Design System abajo)
- **Charts:** Recharts
- **PWA:** vite-plugin-pwa + Workbox (para push notifications y offline)
- **Backend:** Supabase (Postgres + Auth + Edge Functions + Realtime + pg_cron)
- **AI:** Claude API (Sonnet 4.6) para análisis de noticias, sugerencias de inversión y resúmenes
- **Push Notifications:** Web Push API con VAPID keys
- **Deploy:** Vercel
- **Fuentes de datos:**
  - IOL Inversiones API (portfolio, precios, balance, órdenes)
  - RSS feeds de noticias (Ámbito, Cronista, La Nación, Reuters, Bloomberg, CNBC)
  - APIs de cotización de dólar (MEP, CCL, blue, oficial)
  - Datos de earnings calendario

## Arquitectura

```
┌──────────────────────────────────────────────┐
│              REACT PWA (Frontend)            │
│  Dashboard · Alertas · Noticias · Oportunidades │
│  Service Worker → Push Notifications         │
└────────────────────┬─────────────────────────┘
                     │ Supabase Client SDK
                     ▼
┌──────────────────────────────────────────────┐
│               SUPABASE (Backend)             │
│                                              │
│  Auth ─── Postgres DB ─── Realtime (WS)      │
│                │                             │
│         Edge Functions (CRON):               │
│         ├── fetch-portfolio    (cada 5 min)  │
│         ├── evaluate-alerts    (cada 5 min)  │
│         ├── fetch-news         (cada 30 min) │
│         ├── analyze-opportunities (cada 1h)  │
│         ├── fetch-dollar-rates (cada 10 min) │
│         └── earnings-reminder  (diaria 9AM)  │
│                │                             │
│         External APIs:                       │
│         ├── IOL Inversiones API              │
│         ├── Claude API (análisis/sugerencias) │
│         ├── RSS Feeds (noticias)             │
│         └── Dollar rate APIs                 │
└──────────────────────────────────────────────┘
```

---

## Design System

### Filosofía visual

Dashboard financiero oscuro, denso en información pero legible. Inspirado en terminales de trading profesionales pero con la claridad de una app consumer. La información más importante se ve sin scroll. Cada número tiene un color que indica si es bueno (verde), malo (rojo), o neutral.

### Paleta de colores

```css
:root {
  /* Backgrounds */
  --bg-primary: #06060a; /* Fondo principal — casi negro con tinte azul */
  --bg-surface: #0e0e14; /* Cards y contenedores */
  --bg-elevated: #161620; /* Elementos elevados, modals */
  --bg-hover: #1c1c28; /* Hover states */

  /* Borders */
  --border-subtle: rgba(255, 255, 255, 0.05);
  --border-default: rgba(255, 255, 255, 0.08);
  --border-strong: rgba(255, 255, 255, 0.12);

  /* Text */
  --text-primary: #eeeef4; /* Texto principal */
  --text-secondary: #8888a0; /* Labels, descripciones */
  --text-muted: #555568; /* Texto terciario */

  /* Semantic */
  --gain: #00e68a; /* Verde ganancia — eléctrico, inequívoco */
  --loss: #ff4757; /* Rojo pérdida — urgente */
  --warning: #ffb020; /* Amarillo alerta */
  --info: #4da6ff; /* Azul informativo */
  --accent: #8b5cf6; /* Violeta accent — CTAs, highlights */

  /* Gradients */
  --gradient-gain: linear-gradient(135deg, #00e68a 0%, #00b368 100%);
  --gradient-loss: linear-gradient(135deg, #ff4757 0%, #cc3a47 100%);
  --gradient-accent: linear-gradient(135deg, #8b5cf6 0%, #6d3ae8 100%);

  /* Glow effects (para números importantes) */
  --glow-gain: 0 0 20px rgba(0, 230, 138, 0.15);
  --glow-loss: 0 0 20px rgba(255, 71, 87, 0.15);
}
```

### Tipografía

```css
/* Display — para el total de cartera y números grandes */
@import url("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap");

/* Body — para texto general */
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap");

/* Mono — para precios, porcentajes, datos financieros */
@import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap");

:root {
  --font-display: "Space Grotesk", sans-serif;
  --font-body: "Inter", sans-serif;
  --font-mono: "JetBrains Mono", monospace;
}
```

### Componentes clave

**MetricCard:** Fondo `--bg-surface`, borde `--border-subtle`, label en `--text-muted` con `--font-mono` 11px uppercase, valor en `--font-display` 28px bold, sub-label en `--text-secondary` 12px. Si el valor es positivo, color `--gain` con `--glow-gain`. Si negativo, `--loss` con `--glow-loss`.

**PositionRow:** Grid de 7 columnas (símbolo, desc, qty, precio, variación día, P/L, % cartera). Símbolo en `--font-mono` bold con dot de color del sector. Hover `--bg-hover`. Border-bottom `--border-subtle`.

**AlertBadge:** Pill con border-radius 999px. Crítica: fondo rgba(255,71,87,0.12) borde rgba(255,71,87,0.3) texto --loss. Warning: fondo rgba(255,176,32,0.12). Info: fondo rgba(77,166,255,0.12).

**OpportunityCard:** Card con borde izquierdo de 3px en `--accent`. Título del activo en `--font-display`, porcentaje de crecimiento proyectado en `--gain` grande, razón resumida en `--text-secondary`, botón "Ver análisis" con `--gradient-accent`.

**TagPill (temáticas mundiales):** Pill redondeada interactiva. Fondo `--bg-elevated`, borde `--border-default`, texto `--text-secondary`. Al presionar: expande inline o abre modal con noticias resumidas del tema. Tags ejemplo: "IA y Semiconductores", "Petróleo y Geopolítica", "Fed y Tasas", "Dólar Argentina", "Earnings Season", "Europa Defensa".

---

## Base de datos

### Schema SQL completo

```sql
-- ============================================
-- USUARIOS
-- ============================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
-- HISTORIAL DE PRECIOS (para sparklines y gráficos)
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
-- REGLAS DE ALERTA (configurables por usuario)
-- ============================================
CREATE TABLE alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL,
  -- Tipos: take_profit, stop_loss, rebalance, sector_concentration,
  --        daily_extreme, idle_cash, opportunity_buy, news_negative
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
  related_symbols TEXT[], -- {NVDA, AMD, AVGO}
  tags TEXT[], -- {IA, semiconductores, Fed, petroleo}
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- TEMÁTICAS MUNDIALES (tags interactivos)
-- ============================================
CREATE TABLE world_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL, -- ia-semiconductores, fed-tasas, petroleo-geopolitica
  label TEXT NOT NULL, -- "IA y Semiconductores"
  emoji TEXT, -- 🤖
  description TEXT, -- breve descripción del tema
  keywords TEXT[] NOT NULL, -- keywords para filtrar noticias
  related_symbols TEXT[], -- activos que impacta
  is_active BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0
);

-- Seed de temáticas
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
-- OPORTUNIDADES DE INVERSIÓN (generadas por AI)
-- ============================================
CREATE TABLE opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  opportunity_type TEXT NOT NULL, -- buy_signal, momentum, undervalued, sector_rotation, earnings_play
  title TEXT NOT NULL,
  reasoning TEXT NOT NULL, -- análisis generado por Claude
  growth_estimate_pct NUMERIC, -- % de crecimiento estimado
  confidence TEXT, -- high, medium, low
  time_horizon TEXT, -- short (1-4 sem), medium (1-6 mes), long (6+ mes)
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
-- PORTFOLIO SNAPSHOTS (para gráfico de evolución)
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
-- ============================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_balance ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_snapshots ENABLE ROW LEVEL SECURITY;

-- Policies: cada usuario solo ve sus datos
CREATE POLICY "Users see own data" ON users FOR ALL USING (auth.uid() = id);
CREATE POLICY "Users see own positions" ON positions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users see own alerts" ON alerts FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users see own rules" ON alert_rules FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users see own transactions" ON transactions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users see own balance" ON account_balance FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users see own snapshots" ON portfolio_snapshots FOR ALL USING (auth.uid() = user_id);

-- Tablas públicas (lectura para todos los autenticados)
CREATE POLICY "Authenticated read news" ON news FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read topics" ON world_topics FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read opportunities" ON opportunities FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read dollar" ON dollar_rates FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read earnings" ON earnings_calendar FOR SELECT USING (auth.role() = 'authenticated');
```

---

## Pantallas y Layout

### Bottom Navigation (5 tabs)

```
[ 📊 Dashboard ] [ 🔔 Alertas ] [ 🚀 Oportunidades ] [ 📰 Noticias ] [ ⚙️ Config ]
```

### Pantalla 1: DASHBOARD (home)

```
┌─────────────────────────────────────────────┐
│  IOL Portfolio Monitor           🔔 3       │
├─────────────────────────────────────────────┤
│                                             │
│  TOTAL CARTERA              VARIACIÓN HOY   │
│  $7.296.070                 +$46.244        │
│  ████████████               +0.65%  🟢      │
│                                             │
├──────────┬──────────┬───────────────────────┤
│ GANANCIA │ PÉRDIDA  │ CASH DISPONIBLE       │
│+$441.205 │ -$86.000 │ $1.510               │
│  total   │  AMD     │ sin rendir            │
├──────────┴──────────┴───────────────────────┤
│                                             │
│  COMPOSICIÓN POR SECTOR      [donut chart]  │
│  Tech 52% · RF 23% · CER 7% · Energía 6%  │
│                                             │
├─────────────────────────────────────────────┤
│  💰 LIQUIDEZ RÁPIDA (Top 5 para extraer)   │
│                                             │
│  1. PRMCAPB    $1.62M   T+0  🟢 rescate hoy│
│  2. CNXPOPA    $663k    T+0  🟢 rescate hoy│
│  3. PCOMAGB    $209k    T+0  🟢 rescate hoy│
│  4. TZXD6      $502k    T+1  🟡 mañana     │
│  5. AMZN       $503k    T+1  🟡 mañana     │
│                                             │
├─────────────────────────────────────────────┤
│  🚀 OPORTUNIDADES DETECTADAS               │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ 🟣 AVGO — Broadcom                 │    │
│  │ Pullback post-earnings. Revenue IA  │    │
│  │ +143%. Target: +37%                 │    │
│  │ Confianza: ALTA    [Ver análisis →] │    │
│  └─────────────────────────────────────┘    │
│                                             │
├─────────────────────────────────────────────┤
│  📈 POSICIONES                              │
│                                             │
│  SYM    QTY    PRECIO    DÍA     P/L    %   │
│  ──────────────────────────────────────────  │
│  MSFT    24   $25.980  +1.24%  +$124k  8.6% │
│  NVDA    60   $13.860  +1.91%  +$57k  11.3% │
│  AMD     10   $82.100  +6.90%  +$101k 10.4% │
│  AVGO    40   $16.700  +5.09%  +$72k   8.7% │
│  AMZN   162   $3.042   -2.40%  +$61k   7.0% │
│  GOOGL   39   $10.270  +0.98%  +$20k   5.5% │
│  ...                                        │
│                                             │
├─────────────────────────────────────────────┤
│  🌍 TEMÁTICAS MUNDIALES                     │
│                                             │
│  [🤖 IA y Semis] [🏦 Fed] [🛢️ Petróleo]   │
│  [💵 Dólar AR] [📊 Earnings] [🇨🇳 China]   │
│                                             │
├─────────────────────────────────────────────┤
│  💱 DÓLAR                                   │
│  MEP $1.518 · CCL $1.582 · Blue $1.560     │
│  Brecha MEP/Oficial: 3.0%                  │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│  [ 📊 ] [ 🔔 ] [ 🚀 ] [ 📰 ] [ ⚙️ ]       │
│                                             │
└─────────────────────────────────────────────┘
```

### Pantalla 2: ALERTAS

Lista cronológica de alertas con badges de severidad.
Filtros: Todas · Críticas · Importantes · Info · Oportunidades
Cada alerta muestra: icono de severidad, título, mensaje, acción sugerida (ej: "Vender 4 MSFT"), timestamp.
Swipe left para dismiss, tap para ver detalle.

### Pantalla 3: OPORTUNIDADES

Cards de oportunidades de inversión detectadas por el AI.
Cada card: símbolo, nombre, tipo (buy signal, momentum, undervalued), razón (generada por Claude), % de crecimiento estimado en grande con color verde, precio actual vs target, horizonte temporal, nivel de confianza (Alta/Media/Baja), noticias relacionadas.

### Pantalla 4: NOTICIAS

Feed cronológico filtrable por tags (las temáticas mundiales).
Cada noticia: fuente + timestamp, título, resumen AI (2-3 líneas), sentimiento (badge verde/rojo/gris), activos relacionados (pills), impacto (alto/medio/bajo).
Al tocar un tag de temática: filtra las noticias por ese tema.

### Pantalla 5: CONFIGURACIÓN

- Umbrales de alertas (sliders editables)
- Horario de monitoreo (start/end)
- Tipos de notificación (toggles por severidad)
- Gestión de posiciones (editar precio de compra)
- Exportar historial de operaciones
- Info de cuenta IOL

---

## Edge Functions (CRON Jobs)

### 1. fetch-portfolio (cada 5 min, lun-vie 10:00-18:00)

```
1. Llamar a IOL API → get_portfolio + get_balance
2. Actualizar tabla `positions` con precios actuales
3. Actualizar `account_balance`
4. Guardar snapshot diario en `portfolio_snapshots` (si es la primera del día)
5. Llamar a evaluate-alerts
```

### 2. evaluate-alerts (trigger: después de fetch-portfolio)

```
Para cada posición del usuario:
  1. Calcular P/L vs avg_buy_price
  2. Calcular variación diaria vs previous_close
  3. Calcular % del total de cartera
  4. Calcular concentración por sector

  Evaluar reglas:
  - P/L > take_profit_pct → alerta TOMA DE GANANCIA
  - P/L < stop_loss_pct → alerta STOP LOSS (crítica)
  - daily_change > daily_extreme_pct → alerta VARIACIÓN EXTREMA
  - position_pct > rebalance_pct → alerta REBALANCEO
  - sector_pct > sector_concentration_pct → alerta CONCENTRACIÓN
  - available_cash > idle_cash_threshold → alerta CASH SIN INVERTIR

  Si alerta es nueva (no existe una similar en las últimas 24hs):
    1. Insertar en `alerts`
    2. Si push habilitado → enviar Web Push notification
```

### 3. fetch-news (cada 30 min)

```
1. Fetch RSS de: Ámbito, Cronista, La Nación Economía, Reuters, Bloomberg, CNBC
2. Filtrar por keywords de `world_topics`
3. Para cada noticia nueva:
   a. Llamar a Claude API con prompt:
      "Analiza esta noticia. Devolvé JSON con:
       summary (2-3 oraciones en español),
       sentiment (positive/negative/neutral),
       impact_level (high/medium/low),
       related_symbols (array de tickers afectados),
       tags (array de temáticas)"
   b. Insertar en `news`
   c. Si sentiment=negative Y related_symbols incluye activo en cartera → alerta
```

### 4. analyze-opportunities (cada 1 hora)

```
1. Obtener últimas 20 noticias + precios actuales de CEDEARs populares
2. Obtener posiciones actuales del usuario
3. Llamar a Claude API con prompt:
   "Eres un analista financiero experto. Analiza estos datos y sugiere
    oportunidades de inversión. Para cada oportunidad devolvé JSON con:
    symbol, opportunity_type, title, reasoning (en español),
    growth_estimate_pct, confidence, time_horizon, target_price.
    Prioriza activos con momentum, pullbacks en acciones sólidas,
    y rotaciones sectoriales. Máximo 3 oportunidades."
4. Insertar en `opportunities` (desactivar oportunidades anteriores del mismo symbol)
5. Si confidence=high → alerta tipo opportunity al usuario
```

### 5. fetch-dollar-rates (cada 10 min, lun-vie 10:00-18:00)

```
1. Fetch cotizaciones MEP, CCL, Blue, Oficial
2. Insertar en `dollar_rates`
3. Si brecha MEP/oficial > threshold → alerta
```

### 6. earnings-reminder (diaria a las 9:00 AM)

```
1. Consultar `earnings_calendar` para próximos 3 días
2. Si algún activo en cartera del usuario reporta:
   → Notificación: "AMZN reporta earnings en 2 días. Evaluar posición."
```

---

## Prompts para Claude API

### Prompt de análisis de noticias

```
Eres un analista financiero especializado en mercados globales y su impacto
en CEDEARs argentinos. Analiza la siguiente noticia y respondé SOLO con
un JSON válido (sin markdown, sin backticks):

{
  "summary": "Resumen en español de 2-3 oraciones. Claro, directo, sin jerga innecesaria.",
  "sentiment": "positive | negative | neutral",
  "impact_level": "high | medium | low",
  "related_symbols": ["NVDA", "AMD"],
  "tags": ["ia-semiconductores", "earnings-season"]
}

Noticia:
[TÍTULO]
[CONTENIDO]
```

### Prompt de oportunidades de inversión

```
Eres un analista financiero experto con perfil moderado-agresivo, especializado
en CEDEARs argentinos y mercados globales. Tu objetivo es detectar oportunidades
de inversión para maximizar ganancias.

CARTERA ACTUAL:
[posiciones con precios y P/L]

NOTICIAS RECIENTES:
[últimas 10 noticias con sentimiento]

PRECIOS ACTUALES DE CEDEARs DISPONIBLES:
[precios de los principales CEDEARs en BCBA]

Respondé SOLO con un JSON array (sin markdown, sin backticks):
[
  {
    "symbol": "AVGO",
    "opportunity_type": "pullback | momentum | undervalued | sector_rotation | earnings_play",
    "title": "Título corto y accionable",
    "reasoning": "Análisis en español de 3-4 oraciones explicando POR QUÉ es oportunidad ahora",
    "growth_estimate_pct": 25,
    "confidence": "high | medium | low",
    "time_horizon": "short | medium | long",
    "current_price": 15470,
    "target_price": 19340
  }
]

Máximo 3 oportunidades. Solo sugiere activos donde tengas alta convicción.
Prioriza:
- Pullbacks en acciones sólidas (caída temporal en empresa fuerte)
- Momentum confirmado por earnings positivos
- Rotaciones sectoriales por cambios macro
```

---

## PWA y Push Notifications

### Service Worker (sw.js)

```javascript
// Escuchar push events
self.addEventListener("push", (event) => {
  const data = event.data.json();

  const options = {
    body: data.body,
    icon: "/icons/icon-192x192.png",
    badge: "/icons/badge-72x72.png",
    tag: data.tag || "default",
    renotify: true,
    vibrate:
      data.severity === "critical"
        ? [300, 100, 300, 100, 300]
        : [200, 100, 200],
    data: {
      url: data.url || "/",
      alertId: data.alertId,
    },
    actions: [
      { action: "open", title: "Ver detalle" },
      { action: "dismiss", title: "Descartar" },
    ],
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Click en notificación
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "open" || !event.action) {
    event.waitUntil(clients.openWindow(event.notification.data.url));
  }
});
```

### Manifest (manifest.json)

```json
{
  "name": "IOL Portfolio Monitor",
  "short_name": "Inverse Pulse",
  "description": "Monitor inteligente de inversiones con alertas automáticas",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#06060A",
  "theme_color": "#8B5CF6",
  "orientation": "portrait",
  "icons": [
    { "src": "/icons/icon-72x72.png", "sizes": "72x72", "type": "image/png" },
    { "src": "/icons/icon-96x96.png", "sizes": "96x96", "type": "image/png" },
    {
      "src": "/icons/icon-128x128.png",
      "sizes": "128x128",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-144x144.png",
      "sizes": "144x144",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-152x152.png",
      "sizes": "152x152",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-384x384.png",
      "sizes": "384x384",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

---

## Roadmap de desarrollo

### Fase 1 — Fundación (3-4 días)

- [ ] Init proyecto: Vite + React + TypeScript + Tailwind
- [ ] Configurar Supabase: crear proyecto, ejecutar schema SQL
- [ ] Setup PWA: vite-plugin-pwa, manifest, service worker básico
- [ ] Auth: login con email/magic link via Supabase
- [ ] Layout base: bottom nav, dark theme, tipografía

### Fase 2 — Dashboard (3-4 días)

- [ ] Integración IOL API: fetch portfolio y balance
- [ ] MetricCards: total, ganancia, pérdida, cash
- [ ] Tabla de posiciones con sparklines (Recharts)
- [ ] Donut chart de composición por sector
- [ ] Top 5 liquidez rápida (ordenado por rescue_time + valuación)
- [ ] Cotización dólar inline

### Fase 3 — Motor de alertas (2-3 días)

- [ ] Implementar evaluate-alerts en Edge Function
- [ ] Crear alert_rules por defecto al registrar usuario
- [ ] Push notifications con Web Push API + VAPID
- [ ] Lista de alertas con filtros y swipe dismiss
- [ ] Badge counter en bottom nav

### Fase 4 — Noticias y AI (3-4 días)

- [ ] RSS fetcher Edge Function
- [ ] Integración Claude API para análisis de noticias
- [ ] Feed de noticias con filtros por tags
- [ ] Tags de temáticas mundiales interactivos
- [ ] Alertas por noticias negativas sobre activos en cartera

### Fase 5 — Oportunidades (2-3 días)

- [ ] Edge Function analyze-opportunities con Claude API
- [ ] Cards de oportunidades con growth estimate
- [ ] Earnings calendar y reminders
- [ ] Sugerencia de compra cuando oportunidad es de alta confianza

### Fase 6 — Pulido y deploy (2-3 días)

- [ ] Gráfico de evolución de cartera (portfolio_snapshots)
- [ ] Pantalla de configuración (editar umbrales, toggles)
- [ ] Historial de operaciones
- [ ] Optimización mobile, animaciones, transitions
- [ ] Deploy a Vercel
- [ ] Testing completo

---

## Variables de entorno necesarias

```env
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ... (solo en Edge Functions)
ANTHROPIC_API_KEY=sk-ant-... (solo en Edge Functions)
VAPID_PUBLIC_KEY=BN... (frontend + backend)
VAPID_PRIVATE_KEY=... (solo en Edge Functions)
IOL_API_TOKEN=... (solo en Edge Functions — refresh token de IOL)
```

---

## Notas importantes para el desarrollo

1. **IOL API:** La conexión con IOL se hace vía MCP. Para la app standalone necesitamos usar la API REST de IOL directamente. Documentar los endpoints necesarios: portfolio, balance, quotes, orders.

2. **Rate limits:** IOL tiene rate limits. El CRON de 5 minutos debería ser suficiente. No hacer polling desde el frontend.

3. **Claude API costs:** Usar Sonnet (no Opus) para mantener costos bajos. Cachear respuestas de análisis de noticias.

4. **Seguridad:** NUNCA almacenar credenciales de IOL en el frontend. Todo pasa por Edge Functions.

5. **Mobile first:** El 90% del uso va a ser desde el celular. Diseñar para pantallas de 375px primero.

6. **Offline:** La PWA debe mostrar la última data conocida cuando no hay conexión. Cachear agresivamente con el Service Worker.
