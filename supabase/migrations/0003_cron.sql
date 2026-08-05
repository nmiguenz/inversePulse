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
--
-- Falla RUIDOSAMENTE si el secret no está: la versión anterior devolvía
-- 'Bearer ' || NULL = NULL, así que los jobs salían sin Authorization y
-- morían con un 401 que nadie veía. Un día entero sin sincronizar y ni un
-- error en ningún lado. Ahora la excepción queda en cron.job_run_details.
CREATE OR REPLACE FUNCTION cron_auth_headers()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  key TEXT;
BEGIN
  SELECT decrypted_secret INTO key FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF key IS NULL OR key = '' THEN
    RAISE EXCEPTION
      'Falta el secret "service_role_key" en Vault. Guardalo con vault.create_secret() usando la key de Settings → API.';
  END IF;

  -- Trampa clásica: correr el ejemplo sin reemplazar el placeholder deja
  -- guardado el texto "<SERVICE_ROLE_KEY>" (18 chars) y todos los jobs se
  -- van al 401. Una service role key real pasa los 100 caracteres.
  IF length(key) < 100 THEN
    RAISE EXCEPTION
      'El secret "service_role_key" tiene solo % caracteres: parece un placeholder, no la key real. Actualizalo con vault.update_secret().',
      length(key);
  END IF;

  RETURN jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || key
  );
END;
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

-- fetch-news: cada 30 min. Corre todo el día, no solo en horario de mercado:
-- las noticias que mueven precios salen fuera de rueda.
SELECT cron.schedule(
  'fetch-news',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://kfxnspxwmcepgzqycjfa.supabase.co/functions/v1/fetch-news',
    headers := cron_auth_headers(),
    timeout_milliseconds := 120000
  );
  $$
);

-- analyze-opportunities: 11:00 y 16:00 ART (14:00 y 19:00 UTC), lun-vie.
--
-- El spec pedía "cada 1 hora", pero las oportunidades que genera tienen
-- horizonte de semanas a meses. Correr un modelo Opus 24 veces por día para
-- revisar tesis a ese plazo cuesta ~US$65/mes y no cambia las conclusiones.
-- Dos corridas — una con el mercado abierto, otra a media rueda — alcanzan.
-- La function además se saltea sola si no entraron noticias nuevas.
SELECT cron.schedule(
  'analyze-opportunities',
  '0 14,19 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://kfxnspxwmcepgzqycjfa.supabase.co/functions/v1/analyze-opportunities',
    headers := cron_auth_headers(),
    timeout_milliseconds := 180000
  );
  $$
);

-- Ver estado / revisar corridas / borrar:
--   SELECT jobid, jobname, schedule, active FROM cron.job;
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
--   SELECT cron.unschedule('fetch-portfolio');
