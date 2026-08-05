-- ============================================================
-- Asesor de inversión
--
-- Reemplaza a `opportunities` con algo que produce ACCIONES en vez de
-- observaciones, y que además lleva registro de sus propios resultados.
--
-- Ese registro no es un extra: una IA que sugiere mover plata sin dejar rastro
-- de si acertó es una caja negra que opina. Cada recomendación guarda el precio
-- del momento, y una función diaria (sin IA, solo aritmética sobre
-- price_history) marca qué pasó después.
-- ============================================================

CREATE TABLE recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,

  action TEXT NOT NULL,          -- buy, add, trim, sell, rebalance, hold
  symbol TEXT NOT NULL,          -- el activo sobre el que se actúa
  counterpart_symbol TEXT,       -- en un rebalance: de dónde sale la plata

  title TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  confidence TEXT NOT NULL,      -- high, medium, low
  time_horizon TEXT,             -- short, medium, long

  -- Dimensionamiento: en pesos y en unidades, calculado sobre el efectivo real
  suggested_amount NUMERIC,
  suggested_quantity NUMERIC,

  -- Una venta puede sugerirse aunque la posición esté en rojo, si la tesis se
  -- rompió. Se marca explícitamente para que la UI lo advierta.
  realizes_loss BOOLEAN DEFAULT false,

  -- ---------- Registro de resultados ----------
  price_at_recommendation NUMERIC,
  price_after_30d NUMERIC,
  outcome_pct NUMERIC,           -- cuánto se movió el activo desde la sugerencia
  outcome_verdict TEXT,          -- correcta, incorrecta, neutral
  evaluated_at TIMESTAMPTZ,

  is_active BOOLEAN DEFAULT true,
  analyzed_with TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own recommendations" ON recommendations
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_recommendations_active ON recommendations(user_id, is_active, created_at DESC);
CREATE INDEX idx_recommendations_pending_eval
  ON recommendations(created_at) WHERE evaluated_at IS NULL;

COMMENT ON COLUMN recommendations.outcome_verdict IS
  'Resultado a 30 días comparado contra price_history. Una compra que subió es correcta; una venta que subió es incorrecta.';
