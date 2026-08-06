-- ============================================================
-- Registro de operaciones, medición de resultados y datos de mercado
--
-- Tres cosas que la app no podía hacer porque solo conocía las posiciones
-- actuales:
--   1. Mostrar el historial (la tabla `transactions` existía desde 0001 y
--      NUNCA se escribió: la pantalla estaba vacía).
--   2. Medir si está funcionando. Sin saber cuánta plata entró y salió, el
--      valor de la cartera no dice nada: un depósito parece una ganancia.
--   3. Mostrar qué se mueve afuera de la cartera.
-- ============================================================

-- ============================================
-- 1. TRANSACCIONES REALES DESDE IOL
-- ============================================

-- Los depósitos y las extracciones no tienen símbolo. La columna era NOT NULL
-- porque 0001 la pensó solo para compras y ventas.
ALTER TABLE transactions ALTER COLUMN symbol DROP NOT NULL;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS kind TEXT,
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'ARS',
  ADD COLUMN IF NOT EXISTS description TEXT;

COMMENT ON COLUMN transactions.kind IS
  'buy, sell, deposit, withdrawal, dividend, fci_subscription, fci_redemption';

COMMENT ON COLUMN transactions.external_id IS
  'ticket/transaction id de IOL. Es lo que hace idempotente al sync.';

-- `side` era el único discriminador y solo distingue compra de venta. Las
-- filas viejas no existen (la tabla está vacía), pero el default deja
-- consistente cualquier inserción manual previa.
UPDATE transactions SET kind = side WHERE kind IS NULL;

-- Sin esto, cada corrida del sync duplicaría todo el historial.
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_external
  ON transactions(user_id, external_id) WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_user_date
  ON transactions(user_id, executed_at DESC);

-- ── Aportes y retiros de julio, cargados a mano ──────────────────────────
--
-- IOL NO expone los depósitos ni las extracciones por API: probé seis rutas
-- distintas y todas devuelven el mismo "Runtime Error" 500 genérico, el mismo
-- que devuelve una ruta inexistente.
--
-- De acá en adelante la app los detecta por diferencia de saldo y pregunta.
-- Pero julio quedó afuera: el primer snapshot de efectivo es de agosto, así
-- que no hay contra qué comparar. Sin estos tres movimientos el rendimiento
-- del primer mes daría un disparate (+1400%, contando el depósito como
-- ganancia).
--
-- Los importes salen de la lista de movimientos de la cuenta leída el
-- 2026-08-06. SON VERIFICABLES en la app de IOL, en Mi Cuenta → Movimientos.
-- Si alguno no coincide, corregilo acá: es un dato transcrito, no calculado.
INSERT INTO transactions (user_id, external_id, kind, side, symbol, quantity, price, total, currency, description, executed_at)
SELECT
  u.id, v.external_id, v.kind, v.side, NULL, 0, 0, v.total, 'ARS', v.description, v.executed_at::timestamptz
FROM users u
CROSS JOIN (VALUES
  ('manual-depo-20260701', 'deposit',    'buy',  1400000.0, 'Depósito (carga manual: IOL no lo expone por API)', '2026-07-01T10:34:00-03:00'),
  ('manual-ext-20260729a', 'withdrawal', 'sell',   20000.0, 'Extracción (carga manual: IOL no lo expone por API)', '2026-07-29T00:32:41-03:00'),
  ('manual-ext-20260729b', 'withdrawal', 'sell',   50000.0, 'Extracción (carga manual: IOL no lo expone por API)', '2026-07-29T15:35:24-03:00')
) AS v(external_id, kind, side, total, description, executed_at)
ON CONFLICT (user_id, external_id) WHERE external_id IS NOT NULL DO NOTHING;

-- ============================================
-- 2. REVISIONES DE RENDIMIENTO
-- ============================================

-- Una fila por período cerrado. Se guardan todas para poder mirar la
-- tendencia: un solo mes es ruido estadístico y el veredicto aislado engaña.
CREATE TABLE IF NOT EXISTS performance_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,

  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  -- Valuación de las puntas
  start_value NUMERIC NOT NULL,
  end_value NUMERIC NOT NULL,

  -- Aportes y retiros del período. Sin esto el rendimiento es indefendible.
  net_flows NUMERIC NOT NULL DEFAULT 0,
  deposits NUMERIC NOT NULL DEFAULT 0,
  withdrawals NUMERIC NOT NULL DEFAULT 0,
  dividends NUMERIC NOT NULL DEFAULT 0,

  -- Rendimiento ajustado por flujos (Modified Dietz), en pesos y en dólares
  return_pct NUMERIC,
  return_amount NUMERIC,
  return_usd_pct NUMERIC,

  -- MEP de cada punta, para poder auditar la conversión
  mep_start NUMERIC,
  mep_end NUMERIC,

  -- El contrafáctico: qué habría pasado sin tocar nada desde period_start
  hold_value NUMERIC,
  hold_return_pct NUMERIC,

  -- ok | mixed | bad | insufficient_data
  verdict TEXT,
  -- Por qué dio eso, en texto legible
  verdict_reason TEXT,
  -- Qué datos faltaron, si faltaron. NULL = el cálculo fue completo.
  data_gaps TEXT[],

  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, period_start, period_end)
);

ALTER TABLE performance_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own reviews" ON performance_reviews
  FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- 3. COTIZACIONES DEL UNIVERSO
-- ============================================

-- Precios de activos que NO tenés, para los paneles de "mejores del día" y
-- "mejores de la semana". `price_history` sigue guardando el cierre diario;
-- esta tabla es el estado actual, una fila por símbolo.
CREATE TABLE IF NOT EXISTS market_quotes (
  symbol TEXT PRIMARY KEY,
  price NUMERIC,
  previous_close NUMERIC,
  daily_change_pct NUMERIC,
  -- NULL mientras no haya cierre de hace una semana. El frontend lo muestra
  -- como "faltan datos", no como 0%.
  week_change_pct NUMERIC,
  volume NUMERIC,
  -- Hora del último precio según IOL, no la de nuestro sync: sirve para saber
  -- si el dato está viejo porque el mercado está cerrado.
  quoted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE market_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read quotes" ON market_quotes
  FOR SELECT TO authenticated USING (true);

-- ============================================
-- 4. PERTENENCIA A ÍNDICES
-- ============================================

ALTER TABLE asset_metadata
  ADD COLUMN IF NOT EXISTS index_membership TEXT[];

COMMENT ON COLUMN asset_metadata.index_membership IS
  'Índices a los que pertenece. La composición cambia con el tiempo: revisar contra una fuente actual antes de confiar en el recorte.';

-- Top 50 del S&P 500 por capitalización, verificado contra marketcap.company
-- el 2026-08-06. Solo se marcan los símbolos que YA están en el universo y
-- que aparecen en esa lista: nada cargado de memoria.
--
-- Quedan afuera del distintivo, por no estar en el top 50 a esta fecha:
-- TSM (no integra el S&P: es taiwanesa), QCOM, CRM, PYPL, SHOP, COIN, SLB,
-- COP, PEP, MCD, DIS, LMT, y los ETF GLD, SPY y QQQ, que no son empresas.
UPDATE asset_metadata
SET index_membership = ARRAY['SP500_TOP50']
WHERE symbol IN (
  'NVDA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'AVGO', 'META', 'TSLA',
  'WMT', 'JPM', 'AMD', 'BRKB', 'XOM', 'V', 'JNJ', 'INTC',
  'MA', 'ORCL', 'BAC', 'CVX', 'KO', 'PG', 'NFLX', 'RTX'
);

-- ============================================
-- 5. CONFIGURACIÓN DE LA REVISIÓN
-- ============================================

UPDATE users
SET settings = settings || jsonb_build_object('review_period_days', 30)
WHERE NOT (settings ? 'review_period_days');

ALTER TABLE users ALTER COLUMN settings SET DEFAULT '{
  "take_profit_pct": 20,
  "stop_loss_pct": -15,
  "rebalance_pct": 15,
  "sector_concentration_pct": 50,
  "daily_extreme_pct": 5,
  "idle_cash_threshold": 50000,
  "monitoring_start": "10:00",
  "monitoring_end": "18:00",
  "notify_decisions": true,
  "notify_opportunities": true,
  "notify_news": false,
  "review_period_days": 30
}'::jsonb;

-- ============================================
-- 6. TAREAS PROGRAMADAS
-- ============================================
-- Horarios en UTC. Buenos Aires = UTC-3.

-- fetch-transactions: una vez por día, después del cierre (18:30 ART).
-- Las operaciones ya liquidaron y el efectivo del día está firme, que es lo
-- que necesita la detección de aportes por diferencia de saldo.
SELECT cron.schedule(
  'fetch-transactions',
  '30 21 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://kfxnspxwmcepgzqycjfa.supabase.co/functions/v1/fetch-transactions',
    headers := cron_auth_headers(),
    timeout_milliseconds := 60000
  );
  $$
);

-- fetch-market-quotes: al cierre de la rueda (17:15 ART). Una sola vez por
-- día: son ~40 llamadas a IOL y el dato que alimenta los paneles es el cierre.
SELECT cron.schedule(
  'fetch-market-quotes',
  '15 20 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://kfxnspxwmcepgzqycjfa.supabase.co/functions/v1/fetch-market-quotes',
    headers := cron_auth_headers(),
    timeout_milliseconds := 120000
  );
  $$
);

-- evaluate-performance: los sábados a la mañana, con la semana cerrada.
-- No tiene sentido más seguido: el veredicto de un período de 30 días no
-- cambia de un día para el otro, y recalcularlo a diario invita a mirarlo
-- como si fuera un precio.
SELECT cron.schedule(
  'evaluate-performance',
  '0 13 * * 6',
  $$
  SELECT net.http_post(
    url := 'https://kfxnspxwmcepgzqycjfa.supabase.co/functions/v1/evaluate-performance',
    headers := cron_auth_headers(),
    timeout_milliseconds := 60000
  );
  $$
);
