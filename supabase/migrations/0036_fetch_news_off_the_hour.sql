-- ============================================================
-- Sacar fetch-news de los minutos que comparte con el sync
--
-- El 20/08/2026 la corrida de `fetch-portfolio-main` de las 18:00 UTC no
-- escribió NADA: ni datos ni `last_sync_error`. Muestreando la base cada 30
-- segundos, la cadencia real fue
--
--   17:55:07  ✓
--   18:00     — (nada)
--   18:05:07  ✓
--   18:10:08  ✓
--   18:15:07  ✓
--
-- Que no haya quedado fila de error es el dato importante: el `catch` de
-- `fetch-portfolio` hace un upsert de `last_sync_error` ante cualquier fallo del
-- sync. Si no hay error registrado, la Edge Function murió ANTES de llegar a su
-- propio catch — timeout de plataforma o cold start, no un sync que salió mal.
--
-- 18:00 es uno de los dos minutos por hora en los que `fetch-portfolio-main`
-- (*/5) comparte horario con `fetch-news` (*/30), que es el job más caro que
-- existe acá: RSS de seis fuentes más un análisis con Claude POR USUARIO, con
-- timeout de 150s contra los 30s del sync.
--
-- El control que hace pensar que es eso y no la coincidencia a secas:
-- `fetch-dollar-rates` (*/10) también pisa a `fetch-portfolio-main` en :00, :10,
-- :20… y la corrida de las 18:10 entró perfecta. Compartir minuto no alcanza
-- para romper nada; lo que parece pesar es compartir minuto con el job CARO.
--
-- Con una sola observación esto es una HIPÓTESIS, no una causa probada. Se
-- aplica igual porque el cambio es barato, reversible y no cuesta nada
-- equivocarse: a una noticia no le cambia la vida salir en el minuto 7 en vez
-- del 0. Si en unos días se pierde otra corrida en un minuto donde ya no hay
-- nadie más, la hipótesis queda descartada y hay que mirar la duración de
-- `syncImpliedFx`, que hace una llamada a IOL por cada CEDEAR.
--
-- Ojo con la expectativa: esto NO es lo que arregla el dashboard. Desde el poll
-- de 60s de `useAutoRefresh` una corrida perdida ya no se ve en pantalla. Esto
-- es para no perderla.
--
-- Minutos 7 y 37 por el mismo criterio que usó la 0023 para `fetch-market-quotes`
-- y `fetch-transactions`: minutos que no comparte con nadie. No son múltiplos de
-- 5 (`fetch-portfolio-main`, `fetch-dollar-rates`) ni el 13 de
-- `keep-session-alive`.
--
-- `cron.schedule` hace upsert por nombre, así que no hace falta desprogramarlo
-- antes. Para volver atrás: correr esto mismo con '*/30 14-19 * * 1-5'.
--
-- Para verificar después de aplicar:
--   SELECT jobname, schedule FROM cron.job WHERE jobname LIKE 'fetch-%';
--   SELECT jobname, status, start_time FROM cron.job_run_details
--     ORDER BY start_time DESC LIMIT 20;
-- ============================================================

SELECT cron.schedule(
  'fetch-news',
  '7-37/30 14-19 * * 1-5',
  $$ SELECT net.http_post(
       url := 'https://kfxnspxwmcepgzqycjfa.supabase.co/functions/v1/fetch-news',
       headers := cron_auth_headers(), timeout_milliseconds := 150000); $$
);
