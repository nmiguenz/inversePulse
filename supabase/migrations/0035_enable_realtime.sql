-- ============================================================
-- Habilitar realtime en las tablas que la app escucha
--
-- El CRON de 5 minutos funcionaba perfecto —pg_cron dispara puntual, pg_net
-- devuelve 200, fetch-portfolio sincroniza las 15 posiciones y encadena
-- transacciones y alertas— pero la app no se enteraba nunca. Desde el celular
-- eso se ve exactamente igual que un cron roto: los números quedan congelados
-- hasta que recargás o hacés pull-to-refresh.
--
-- La causa: la publicación `supabase_realtime` estaba VACÍA. Suscribirse a
-- `postgres_changes` no falla ni avisa si la tabla no está publicada — el canal
-- conecta, dice SUBSCRIBED, y no llega un solo evento. Silencioso por diseño.
--
-- Las seis tablas son las que el frontend escucha hoy:
--   positions, account_balance   → usePortfolio (dashboard)
--   dollar_rates                 → usePortfolio (la tira del dólar)
--   alerts                       → useAlerts (el badge del nav)
--   recommendations              → Opportunities
--   news                         → useNews
--
-- REPLICA IDENTITY FULL en las que se filtran por user_id: sin eso, el UPDATE
-- viaja solo con la clave primaria y el filtro `user_id=eq.<id>` del cliente no
-- puede evaluarse, así que el evento se descarta del lado del servidor. Es la
-- segunda mitad de la misma trampa: todo "funciona" y no llega nada.
-- ============================================================

ALTER TABLE positions REPLICA IDENTITY FULL;
ALTER TABLE account_balance REPLICA IDENTITY FULL;
ALTER TABLE alerts REPLICA IDENTITY FULL;
ALTER TABLE recommendations REPLICA IDENTITY FULL;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'positions',
    'account_balance',
    'dollar_rates',
    'alerts',
    'recommendations',
    'news'
  ] LOOP
    -- Idempotente: agregar una tabla ya publicada tira error y cortaría la
    -- migración a la mitad.
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    END IF;
  END LOOP;
END $$;
