-- ============================================================
-- CRON jobs (Fase 2 + Fase 3)
--
-- La service role key NO va escrita acá: se guarda cifrada en Vault y el job la
-- lee en cada corrida. Así este archivo se puede versionar sin filtrar nada.
--
-- PASO PREVIO (una sola vez, en el SQL Editor, NO versionar el resultado):
--   select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');
--
-- Para rotarla más adelante:
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'service_role_key'),
--     '<NUEVA_KEY>'
--   );
--
-- Correr este archivo de nuevo pisa los jobs existentes (cron.schedule hace
-- upsert por nombre), así que sirve para migrar los que ya tenían la key inline.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- Arma el header de autorización leyendo la key de Vault.
-- SECURITY DEFINER porque vault.decrypted_secrets solo lo lee el owner.
CREATE OR REPLACE FUNCTION cron_auth_headers()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (
      SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'
    )
  );
$$;

-- Que no la pueda llamar nadie desde la API: devuelve la key en texto plano.
REVOKE ALL ON FUNCTION cron_auth_headers() FROM PUBLIC;
REVOKE ALL ON FUNCTION cron_auth_headers() FROM anon, authenticated;

-- Los horarios de pg_cron son UTC. Buenos Aires = UTC-3, así que
-- 10:00-18:00 ART = 13:00-21:00 UTC.

-- fetch-portfolio: cada 5 min, lun-vie. Encadena evaluate-alerts al terminar.
SELECT cron.schedule(
  'fetch-portfolio',
  '*/5 13-21 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://kfxnspxwmcepgzqycjfa.supabase.co/functions/v1/fetch-portfolio',
    headers := cron_auth_headers(),
    timeout_milliseconds := 30000
  );
  $$
);

-- fetch-dollar-rates: cada 10 min, lun-vie
SELECT cron.schedule(
  'fetch-dollar-rates',
  '*/10 13-21 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://kfxnspxwmcepgzqycjfa.supabase.co/functions/v1/fetch-dollar-rates',
    headers := cron_auth_headers(),
    timeout_milliseconds := 15000
  );
  $$
);

-- Ver estado / revisar corridas / borrar:
--   SELECT jobid, jobname, schedule, active FROM cron.job;
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
--   SELECT cron.unschedule('fetch-portfolio');
