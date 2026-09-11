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
- **AI:** Claude API, con dos modelos según la tarea:
  - **Opus 5** (`claude-opus-5`) en `portfolio-advisor` y `goal-advisor` — son decisiones sobre plata real.
  - **Sonnet 5** (`claude-sonnet-5`) en `fetch-news` — clasificación de alto volumen, tarea simple.
  - **Cada usuario carga su propia API key** desde Configuración. No hay key global del proyecto.
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
│         ├── fetch-portfolio     (cada 5 min) │
│         ├── evaluate-alerts     (tras cada   │
│         │                        fetch)      │
│         ├── fetch-news          (cada 30 min)│
│         ├── fetch-dollar-rates  (cada 10 min)│
│         ├── fetch-market-quotes (al cierre)  │
│         ├── fetch-transactions  (al cierre)  │
│         ├── portfolio-advisor   (2x/día)     │
│         ├── evaluate-recommend. (diaria)     │
│         ├── evaluate-performance (semanal)   │
│         ├── goal-advisor        (semanal)    │
│         ├── earnings-reminder   (diaria)     │
│         └── keep-session-alive  (cada 6h)    │
│                                              │
│         A mano (nunca por CRON):             │
│         ├── backfill-prices  (carga histórica)│
│         └── backtest         (simulación)    │
│                │                             │
│         External APIs:                       │
│         ├── IOL Inversiones API              │
│         ├── Claude API (key de cada usuario) │
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

### Tablas agregadas por las migraciones 0002-0041

El schema de arriba es el de la 0001. Lo que sigue lo agregaron las migraciones
posteriores; el SQL vive en `supabase/migrations/` y esa es la fuente de verdad.

| Tabla | Migración | Qué guarda |
| --- | --- | --- |
| `iol_credentials` | 0002 | Credenciales de IOL cifradas (refresh token, contraseña, expiración del access token) |
| `asset_metadata` | 0002 | Universo de activos: sector, `display_name`, `asset_type`, `suggestable`, `is_cash_equivalent` |
| `rss_sources` | 0006 | Fuentes RSS de noticias, configurables |
| `recommendations` | 0009 | Recomendaciones del asesor, con evaluación a 7, 14 y 30 días y alpha vs SPY |
| `goal_portfolios` | 0010 | Metas de inversión (monto objetivo, fecha, banda) |
| `goal_holdings` | 0010 | Qué posiciones están afectadas a cada meta |
| `performance_reviews` | 0014 | Revisiones periódicas de desempeño de la cartera |
| `market_quotes` | 0014 | Última cotización por símbolo del universo, con volumen y dólar implícito |
| `sell_watch` | 0016 | Seguimiento de lo vendido, para el aviso de recompra |
| `user_api_keys` | 0019 | API key de Anthropic de cada usuario, cifrada |
| `news_analysis` | 0023 | Análisis de noticias POR USUARIO (sentimiento, impacto, símbolos relacionados) |
| `backtest_results` | 0039 | Resultado del backtest semana por semana, por estrategia |
| `daily_mep` | 0041 | Un cierre de MEP por día, para convertir CEDEARs a dólares |

Las columnas nuevas sobre tablas que ya existían están en las migraciones y no
se repiten acá. Las que más cambiaron:

- `recommendations` (0037, 0038): `outcome_7d_*`, `outcome_14d_*`, `spy_price_at_rec`, `spy_return_*`, `alpha_*`.
- `price_history`: la columna `volume` existía desde la 0001 pero recién se empezó a escribir en septiembre de 2026.

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

## Edge Functions

Todas viven en `supabase/functions/`. Los horarios son **UTC** y salen de
`cron.schedule` en las migraciones (0003, 0014, 0015, 0023, 0024, 0036);
`cron.schedule` pisa por nombre, así que manda la migración más nueva.
Argentina no tiene horario de verano: UTC-3 siempre.

### Datos de mercado

| Función | Cuándo | Qué hace |
| --- | --- | --- |
| `fetch-portfolio` | cada 5 min, 13:30-19:59 UTC, lun-vie | Trae posiciones y balance de IOL, guarda el snapshot del día y dispara `evaluate-alerts` |
| `evaluate-alerts` | después de cada `fetch-portfolio` | Evalúa umbrales (trailing stop, stop loss, techo, variación extrema) y manda push |
| `fetch-dollar-rates` | cada 10 min, 14-19 UTC, lun-vie | Cotizaciones de dólar MEP, CCL, blue y oficial |
| `fetch-market-quotes` | 20:17 UTC, lun-vie (al cierre) | Cotiza el universo sugerible, guarda el cierre del día en `price_history` con volumen y calcula el dólar implícito |
| `fetch-transactions` | 20:37 UTC, lun-vie (post cierre) | Operaciones cerradas del día desde IOL |
| `fetch-news` | cada 30 min desfasado (`7-37/30`), 14-19 UTC, lun-vie | Lee los RSS y clasifica con **Sonnet 5** en `news_analysis`, por usuario |
| `keep-session-alive` | cada 6 horas | Mantiene viva la sesión de IOL para que el refresh token no muera |

### Asesor y evaluación

| Función | Cuándo | Qué hace |
| --- | --- | --- |
| `portfolio-advisor` | 15:00 y 19:00 UTC, lun-vie | El asesor. Arma el contexto completo y le pide a **Opus 5** acciones concretas sobre la cartera |
| `evaluate-recommendations` | 12:30 UTC, diaria | Mide cada recomendación a 7, 14 y 30 días contra `price_history`, y calcula el alpha vs SPY |
| `evaluate-performance` | 13:00 UTC, sábados | Revisión semanal del desempeño de la cartera |
| `goal-advisor` | 16:30 UTC, lunes (y a pedido) | Plan de inversión para cada meta, con **Opus 5** |
| `earnings-reminder` | 12:00 UTC, diaria | Avisa los earnings próximos de los activos en cartera |

### A pedido desde la app

| Función | Qué hace |
| --- | --- |
| `connect-broker` | Conecta la cuenta de IOL y guarda las credenciales cifradas |
| `save-api-key` | Guarda la API key de Anthropic del usuario, cifrada |

### A mano (nunca por CRON)

| Función | Qué hace |
| --- | --- |
| `backfill-prices` | Carga la serie histórica de IOL en `price_history`. One-shot, o cuando entra un símbolo nuevo al universo |
| `backtest` | Simula qué habría hecho el scoring semana a semana y lo mide contra SPY. Sin IA, determinístico |

> `analyze-opportunities` **ya no existe**: era el predecesor de
> `portfolio-advisor` y la 0024 lo dio de baja. Usaba la API key global del
> proyecto para analizar la cartera de cualquier usuario.

### Módulos compartidos (`supabase/functions/_shared/`)

| Módulo | Qué resuelve |
| --- | --- |
| `claude.ts` | Prompts, structured outputs y llamadas a la API de Claude |
| `indicators.ts` | RSI, SMA, MACD, retornos, ranking de fuerza relativa, correlaciones, `investmentScore` y volatilidad realizada |
| `marketRegime.ts` | Régimen de mercado (risk_on / risk_off / crisis) a partir de 4 factores |
| `priceHistory.ts` | Lectura paginada de `price_history` y corrección de cambios de ratio |
| `iol.ts` | Cliente de la API de IOL, con renovación y candado del refresh token |
| `profile.ts` | Perfil del inversor, umbrales y límites de position sizing |
| `crypto.ts` / `apiKey.ts` | Cifrado de credenciales y de la API key de cada usuario |
| `market.ts` | Horarios de mercado y feriados |
| `impliedFx.ts` | Dólar implícito de cada activo contra el MEP |
| `push.ts` / `rss.ts` / `mapping.ts` / `auth.ts` / `cors.ts` | Web Push, feeds, normalización de símbolos, auth y CORS |

---

## Prompts para Claude API

**La fuente de verdad es `supabase/functions/_shared/claude.ts`.** Los prompts
cambian seguido y copiarlos acá garantiza que queden desincronizados; esta
sección describe la ESTRUCTURA, no el texto.

La forma de la respuesta la garantiza la API con **structured outputs**
(`output_config.format` con JSON schema), así que no hay que pedirle al modelo
que "responda solo con JSON" ni limpiar backticks.

### `buildAdvisorSystemPrompt()` — el asesor (Opus 5)

Se arma por secciones, y cada una aparece **solo si el dato existe**: explicarle
cómo leer algo que no está es invitarlo a inventarlo. En orden:

1. **Régimen de mercado** — va primero de todo, antes de la Regla #0: risk_on / risk_off / crisis con sus factores y qué hacer en cada uno.
2. **Regla #0** — no recomendar es una respuesta válida y preferible.
3. **Perfil del inversor** — objetivo, sectores preferidos, historial de decisiones.
4. **Umbrales del usuario** — trailing stop, stop loss, techo de ganancia, concentración.
5. **Cómo leer cada línea**: movimiento esperado (volatilidad y earnings), indicadores técnicos (RSI, SMA, MACD), ranking de fuerza relativa, score cuantitativo con su desglose, correlaciones altas entre posiciones y TC implícito.
6. **Límites duros de concentración** — 8% posición nueva, 15% existente, 40% sector.
7. **Track record** — accuracy a 7 y 30 días, peores errores, activos donde falló más de una vez y alpha promedio vs SPY.
8. **Regla final** — toda recomendación incluye qué la invalidaría.

El mensaje de usuario trae la cartera línea por línea (valor, peso, P/L,
tendencia, indicadores, rank, correlaciones), la concentración por sector y por
tipo, la liquidez, las noticias recientes y el universo sugerible ordenado por
score.

### `buildOpportunitySystemPrompt()` — búsqueda de oportunidades (Opus 5)

Comparte con el asesor las guías de indicadores, ranking y score. Hoy no tiene
llamador: quedó lista para cuando se retome.

### Análisis de noticias (Sonnet 5)

Un LOTE de noticias por request, no una por llamada: el system prompt se paga
una vez por lote. `thinking: disabled` y `effort: low` — clasificar sentimiento
no necesita razonamiento y en Sonnet 5 el thinking adaptativo viene activo por
defecto.

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

## Estado del proyecto

### Base — ✅ completada

La app funcionando de punta a punta: PWA con auth, sync de cartera desde IOL cada
5 minutos, motor de alertas con push, feed de noticias analizadas con IA,
dashboard con métricas y gráficos, metas de inversión y el asesor guardando
recomendaciones evaluables. Todo lo que el roadmap original llamaba Fases 1 a 6.

### Fase 1 (Contexto cuantitativo) — ✅ completada

Le dio al asesor con qué decidir, además del precio y las noticias:

- **Indicadores técnicos** desde `price_history`: RSI de Wilder, SMA 20/50, MACD.
- **Ranking de fuerza relativa** sobre retornos de 7, 30 y 90 días.
- **Track record**: el resultado de sus propias recomendaciones entra al prompt.
- **Position sizing duro**: 8% / 15% / 40% aplicados por código sobre la respuesta del modelo, no sugeridos.
- **Evaluación a 7, 14 y 30 días**, para medir las tesis de corto plazo en su propio horizonte.

### Fase 2 (Robustez) — ✅ casi completada

- **Benchmark vs SPY**: alpha por recomendación y promedio en el prompt.
- **Correlaciones** entre posiciones, para que "diversificar" no sea duplicar la apuesta.
- **Scoring cuantitativo** (`investmentScore`) que prefiltra y ordena antes de que la IA opine, con 3 variantes de pesos.
- **Backtesting** semana a semana contra SPY, determinístico y sin IA.
- **Backfill de 14 meses** de historia desde IOL, más la corrección de cambios de ratio.
- **Detector de régimen de mercado** con 4 factores y multiplicador sobre el score, más la conversión de SPY a dólares para no perderse caídas tapadas por la devaluación.

Lo que falta de esta fase es lo que siga al detector de régimen.

**Resultado del backtest, a septiembre de 2026:** sobre 44 semanas con datos
corregidos, el scoring da alpha negativo o apenas positivo según la variante
(V1 -1.43%, V2 +0.05%, V3 +1.16% a 4 semanas) y las tres ganan menos de la mitad
de las semanas. El acumulado positivo de V3 sale casi entero de una sola semana
—el rally post-electoral del 27-O—, así que **el default sigue siendo V1**. El
scoring todavía no demostró que le gane al índice.

### Fase 3 (Trading) — pendiente

Ejecución de órdenes contra IOL desde la app, con confirmación explícita del
usuario. Hoy todo el sistema es de solo lectura: sugiere, mide y avisa, pero
nunca opera. Escribir en IOL cambia el perfil de riesgo del proyecto entero.

---

## Variables de entorno necesarias

```env
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ... (solo en Edge Functions)
VAPID_PUBLIC_KEY=BN... (frontend + backend)
VAPID_PRIVATE_KEY=... (solo en Edge Functions)
ENCRYPTION_KEY=... (solo en Edge Functions — cifra credenciales de IOL y API keys)
```

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya vienen inyectadas en el runtime
de las Edge Functions; no hace falta setearlas como secrets.

**No hay `ANTHROPIC_API_KEY` ni `IOL_API_TOKEN` de proyecto.** La key de
Anthropic la carga cada usuario desde Configuración y se guarda cifrada en
`user_api_keys`; las credenciales de IOL se conectan desde la app y se guardan
cifradas en `iol_credentials`.

---

## Notas importantes para el desarrollo

1. **IOL API:** la app usa la API REST de IOL directamente (`api.invertironline.com`), no MCP. El cliente está en `_shared/iol.ts`. El refresh token ROTA en cada uso, por eso se persiste y hay un candado para que dos procesos no lo renueven a la vez. El gateway interno de IOL no resuelve en DNS público: no intentarlo.

2. **Rate limits:** IOL tiene rate limits. El CRON de 5 minutos alcanza. No hacer polling desde el frontend. `backfill-prices` va de a un símbolo con 500 ms de freno entre uno y otro.

3. **Costos de IA:** **cada usuario carga su propia API key de Anthropic en la app. El costo de la IA lo paga el usuario, no el proyecto.** Por eso el asesor usa Opus 5 sin culpa: son dos corridas por día sobre decisiones de plata real. Sonnet 5 queda para el análisis de noticias, que es alto volumen y tarea simple.

4. **Seguridad:** NUNCA almacenar credenciales de IOL ni API keys en el frontend. Todo pasa por Edge Functions y se guarda cifrado.

5. **Mobile first:** el 90% del uso va a ser desde el celular. Diseñar para pantallas de 375px primero.

6. **Offline:** la PWA debe mostrar la última data conocida cuando no hay conexión. Cachear agresivamente con el Service Worker.

7. **`price_history` necesita profundidad.** Los indicadores técnicos y el backtest no funcionan con una serie corta: el MACD necesita 35 ruedas, la SMA50 necesita 50 y el retorno de 90 días necesita 63. Con pocas barras `relativeStrengthRank` manda a todos los símbolos al grupo de "incompletos", que se ordena alfabéticamente, y la componente de momentum del score termina repartida por abecedario. **Correr `backfill-prices` (14 meses) cuando se agrega un símbolo nuevo al universo.**

8. **Los CEDEARs cambian de ratio periódicamente.** Un cambio de ratio entra a la serie como una caída del 90% que nunca ocurrió, y IOL no ofrece serie ajustada (el parámetro `ajustada` devuelve vacío para CEDEARs). `adjustRatioChanges()` en `_shared/priceHistory.ts` los corrige **en la lectura**: los datos crudos se preservan en la base. Detecta por dos condiciones juntas —salto mayor a ±45% Y factor a menos de 5% de un entero—, porque la magnitud sola borraría un derrumbe real. Un factor ÷2 avisa por consola: mirando solo el precio es indistinguible de una caída del 50%.

9. **El benchmark cotiza en pesos.** SPY en `price_history` es el CEDEAR, así que una devaluación lo empuja para arriba mientras el índice cae en dólares. `marketRegime.ts` convierte a dólares con `daily_mep` y se queda con la señal más pesimista de las dos monedas. `daily_mep` se llena sola con las dos corridas diarias del asesor y no tiene backfill posible: hasta juntar 5 días, el régimen mide en pesos.

10. **Todo el sistema es de solo lectura sobre IOL.** Sugiere, mide y avisa; no opera. El único POST a IOL que existe en el cliente está sin usar.
