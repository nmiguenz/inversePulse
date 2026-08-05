-- ============================================================
-- Fase 5 — Calendario de earnings cargado a mano
--
-- No hay fuente gratuita confiable de fechas de earnings, y una fecha
-- inventada es peor que ninguna: dispararía un recordatorio falso sobre
-- una posición real. Se cargan a mano desde la app (Config → Earnings),
-- que para 6 CEDEARs son 4 veces al año.
-- ============================================================

-- `earnings_calendar` es una tabla global (las fechas no son por usuario), y
-- 0001 solo le dio permiso de lectura. Para que se pueda cargar desde la app
-- hace falta escritura. En una app multi-tenant esto iría por una Edge
-- Function con service role; acá el trade-off es aceptable y explícito:
-- cualquier usuario autenticado puede editar el calendario compartido.
CREATE POLICY "Authenticated write earnings" ON earnings_calendar
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated update earnings" ON earnings_calendar
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated delete earnings" ON earnings_calendar
  FOR DELETE TO authenticated USING (true);

-- El recordatorio consulta "próximos N días", así que el índice va por fecha.
CREATE INDEX IF NOT EXISTS idx_earnings_upcoming
  ON earnings_calendar(report_date) WHERE is_reported = false;

-- Deja registrado que ya se avisó, para no repetir el recordatorio cada día
-- durante los 3 días previos.
ALTER TABLE earnings_calendar
  ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ;

-- ============================================================
-- DÓNDE SACAR LAS FECHAS
--
-- Cada empresa las publica en su sitio de investor relations, y la app de IOL
-- las muestra en la ficha del CEDEAR. Ejemplo de carga manual por SQL, si
-- preferís eso a la pantalla:
--
--   INSERT INTO earnings_calendar (symbol, report_date, time_of_day)
--   VALUES ('NVDA', '2026-11-19', 'after_close')
--   ON CONFLICT (symbol, report_date) DO NOTHING;
--
-- NO se siembran fechas acá a propósito: una fecha inventada dispararía un
-- recordatorio falso sobre una posición real.
-- ============================================================
