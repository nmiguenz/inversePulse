-- ============================================================
-- Poder cerrar una sugerencia a mano
--
-- Ya existe el cierre automático: `closeFulfilled` en fetch-transactions
-- cruza tus operaciones contra las sugerencias y la que ejecutaste
-- desaparece sola a los pocos minutos.
--
-- Pero solo cubre el caso feliz. No cierra si operaste por un monto menor al
-- 80% del sugerido, si lo hiciste en otro lado, si ya lo tenías decidido, o
-- si la sugerencia es "no hacer nada" —que no tiene operación posible—. En
-- todos esos casos la tarjeta queda ahí hasta que la reemplace una corrida
-- nueva del asesor.
-- ============================================================

ALTER TABLE recommendations
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;

COMMENT ON COLUMN recommendations.dismissed_at IS
  'Cuándo el usuario la descartó sin ejecutarla. Distinto de fulfilled_at a propósito: is_active = false lo ponen también la evaluación a 30 días y la corrida nueva del asesor, así que sin esta columna "descartada" sería indistinguible de "vencida", y contar un descarte como seguido inflaría la tasa de aciertos.';

CREATE INDEX IF NOT EXISTS idx_recommendations_open
  ON recommendations(user_id, created_at DESC)
  WHERE is_active AND fulfilled_at IS NULL AND dismissed_at IS NULL;
