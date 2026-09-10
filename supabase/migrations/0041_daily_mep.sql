-- ============================================================
-- Un cierre de MEP por día
--
-- El detector de régimen mide SPY, pero lo que hay en `price_history` es el
-- CEDEAR de SPY, que cotiza en PESOS. Cuando el peso se deprecia el CEDEAR sube
-- aunque el índice esté cayendo en dólares: el 10/9/2026 el S&P venía de varias
-- ruedas en baja y el CEDEAR mostraba apenas -1,3% en cinco días. El régimen no
-- estaba mal calibrado — estaba midiendo en la moneda equivocada.
--
-- Para dividir por el tipo de cambio hace falta la SERIE, no el valor de hoy, y
-- `dollar_rates` no sirve: guarda un registro cada diez minutos y se poda, así
-- que el 10/9 tenía 12 filas, todas del mismo día. Acá queda una por fecha.
--
-- No hay backfill posible: no tenemos fuente de MEP histórico. La tabla se
-- llena de acá en adelante, con el upsert que ya hace `portfolio-advisor` en
-- sus dos corridas diarias — sin cron nuevo y sin costo extra. Hasta juntar 5
-- días, el régimen sigue midiendo en pesos.
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_mep (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recorded_date date NOT NULL UNIQUE,
  mep_rate numeric NOT NULL,
  source text DEFAULT 'dollar_rates',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_mep_date
  ON daily_mep(recorded_date DESC);

COMMENT ON TABLE daily_mep IS
  'Un cierre de MEP por día, para convertir CEDEARs a dólares en el régimen y el backtest';
