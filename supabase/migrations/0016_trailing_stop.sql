-- ============================================================
-- Trailing stop, vigilancia de recompra y perfil de riesgo
--
-- POR QUÉ: `take_profit_pct` en 20% venía pidiendo vender MSFT (+29,5%) y
-- AMZN (+26,1%) todos los días — seis alertas en tres días sobre las dos
-- mejores posiciones de la cartera. Un umbral fijo no distingue "subió 20% y
-- sigue subiendo" de "subió 20% y se está dando vuelta", que es exactamente la
-- distinción que importa cuando el objetivo es dejar correr las ganancias.
-- ============================================================

-- ============================================
-- 1. MÁXIMO POR POSICIÓN
-- ============================================

ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS peak_price NUMERIC,
  ADD COLUMN IF NOT EXISTS peak_at TIMESTAMPTZ;

COMMENT ON COLUMN positions.peak_price IS
  'Precio máximo visto desde que se registra. Base del trailing stop.';

-- El máximo se mantiene en un trigger y no en la Edge Function a propósito:
-- así ningún camino de escritura puede bajarlo por accidente, ni siquiera un
-- upsert que mande el campo en null.
CREATE OR REPLACE FUNCTION track_position_peak()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.current_price IS NULL OR NEW.current_price <= 0 THEN
    NEW.peak_price := OLD.peak_price;
    NEW.peak_at := OLD.peak_at;
    RETURN NEW;
  END IF;

  IF OLD.peak_price IS NULL OR NEW.current_price > OLD.peak_price THEN
    NEW.peak_price := NEW.current_price;
    NEW.peak_at := now();
  ELSE
    NEW.peak_price := OLD.peak_price;
    NEW.peak_at := OLD.peak_at;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS positions_peak_tracking ON positions;
CREATE TRIGGER positions_peak_tracking
  BEFORE UPDATE ON positions
  FOR EACH ROW EXECUTE FUNCTION track_position_peak();

-- En un INSERT no hay OLD: el máximo arranca en el precio actual.
CREATE OR REPLACE FUNCTION init_position_peak()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.peak_price IS NULL AND NEW.current_price > 0 THEN
    NEW.peak_price := NEW.current_price;
    NEW.peak_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS positions_peak_init ON positions;
CREATE TRIGGER positions_peak_init
  BEFORE INSERT ON positions
  FOR EACH ROW EXECUTE FUNCTION init_position_peak();

-- Siembra con lo que se pueda: el máximo de los cierres que ya tenemos, o el
-- precio actual si no hay historia.
--
-- LIMITACIÓN: `price_history` arranca cuando arrancó la app. Para una posición
-- comprada el 1/7 que hizo pico en julio, ese pico no está y el trailing stop
-- no lo va a conocer. De acá en adelante sí.
UPDATE positions p
SET peak_price = GREATEST(
      p.current_price,
      COALESCE((SELECT MAX(close_price) FROM price_history h WHERE h.symbol = p.symbol), 0)
    ),
    peak_at = now()
WHERE p.peak_price IS NULL;

-- ============================================
-- 2. VIGILANCIA DE RECOMPRA
-- ============================================

-- Lo que vendiste, para avisar si después queda más barato.
--
-- El aviso dice un HECHO ("está 12% abajo de tu precio de venta"), nunca un
-- pronóstico: si va a volver a subir no lo sabe nadie, y una app que lo afirma
-- es peligrosa justamente porque suena confiable.
CREATE TABLE IF NOT EXISTS sell_watch (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  sold_price NUMERIC NOT NULL,
  sold_quantity NUMERIC,
  sold_at TIMESTAMPTZ NOT NULL,
  -- El id de la operación de IOL: hace idempotente al sync
  external_id TEXT,
  alerted_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sell_watch_external
  ON sell_watch(user_id, external_id);

CREATE INDEX IF NOT EXISTS idx_sell_watch_active
  ON sell_watch(user_id, symbol) WHERE is_active;

ALTER TABLE sell_watch ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own sell watch" ON sell_watch
  FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- 3. UMBRALES Y PERFIL DE RIESGO
-- ============================================

UPDATE users
SET settings = settings || jsonb_build_object(
  -- Retroceso desde el máximo que dispara el aviso de venta. 12% no es
  -- arbitrario: AMD se movió -8,29% en un solo día y los CEDEARs tech oscilan
  -- 5-8% con normalidad. Más angosto te saca de posiciones buenas por ruido.
  'trailing_stop_pct', 12,
  -- Ganancia mínima para que el trailing stop aplique. Debajo de esto la
  -- posición es territorio del stop loss, no de la toma de ganancia.
  'trailing_min_gain_pct', 15,
  -- Cuánto tiene que caer algo que vendiste para que te avise
  'rebuy_watch_pct', 10,
  -- agresivo | moderado. Define el rango de escenarios de las metas.
  'risk_profile', 'agresivo'
)
WHERE NOT (settings ? 'trailing_stop_pct');

-- El umbral fijo se apaga, no se borra: queda disponible por si algún día
-- querés un techo duro. En 0 la regla no evalúa.
UPDATE users
SET settings = jsonb_set(settings, '{take_profit_pct}', '0')
WHERE (settings->>'take_profit_pct')::numeric > 0;

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
  "risk_profile": "agresivo",
  "monitoring_start": "10:00",
  "monitoring_end": "18:00",
  "notify_decisions": true,
  "notify_opportunities": true,
  "notify_news": false,
  "review_period_days": 30
}'::jsonb;
