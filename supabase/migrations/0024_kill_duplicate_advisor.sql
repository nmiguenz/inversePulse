-- ============================================================
-- Sacar el asesor viejo y correr el de metas dentro de la rueda
--
-- Después de la 0023 quedaron 11 crons y hay dos problemas.
-- ============================================================

-- ============================================
-- 1. EL ASESOR DUPLICADO
-- ============================================
--
-- `analyze-opportunities` (0 14,19 * * 1-5) es el predecesor de
-- `portfolio-advisor`. La 0003 lo daba de baja al final del archivo, pero en
-- esta base quedó vivo: se ve que se corrió una versión anterior de esa
-- migración, antes de que se agregara el unschedule.
--
-- O sea que venían corriendo LOS DOS. Y hay algo peor que el gasto duplicado:
-- esa función usa `ANTHROPIC_API_KEY`, la clave global del proyecto —la del
-- dueño— para analizar la cartera de cualquiera. Es justo lo que la 0023 vino
-- a sacar del análisis de noticias.
--
-- Encima corre a las 14:00 UTC, que de noviembre a marzo cae ANTES de la
-- apertura de Estados Unidos: el motivo por el que movimos el asesor a 15:00.
SELECT unschedule_if_exists('analyze-opportunities');

-- ============================================
-- 2. EL ASESOR DE METAS NO LLEGABA A CORRER
-- ============================================
--
-- `goal-advisor` estaba en `0 12 * * 0`: domingos al mediodía. Con el corte
-- por horario de mercado de la 0023 eso pasó a ser una corrida que se saltea
-- siempre —el domingo está cerrado— así que los planes de metas dejaban de
-- generarse sin que nada avise.
--
-- Pasa al lunes 16:30 UTC (13:30 ART), dentro de la rueda y sin pisar los
-- momentos del asesor de cartera (15:00 y 19:00). Sigue siendo semanal y
-- sigue cayendo con la semana anterior ya cerrada.
SELECT unschedule_if_exists('goal-advisor');
SELECT cron.schedule(
  'goal-advisor',
  '30 16 * * 1',
  $$ SELECT net.http_post(
       url := 'https://kfxnspxwmcepgzqycjfa.supabase.co/functions/v1/goal-advisor',
       headers := cron_auth_headers(), timeout_milliseconds := 180000); $$
);

-- ============================================
-- 3. `evaluate-performance` se queda donde está
-- ============================================
--
-- Corre los sábados (0 13 * * 6), con el mercado cerrado, y está bien: no usa
-- IA ni el token de IOL. Solo calcula sobre lo que ya está guardado, que es
-- exactamente lo que conviene hacer con la semana cerrada.
