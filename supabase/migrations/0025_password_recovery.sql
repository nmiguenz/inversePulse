-- ============================================================
-- Recuperación automática de la sesión de IOL
--
-- Esto REVIERTE una decisión deliberada, y vale dejar escrito por qué.
--
-- La contraseña no se guardaba: se canjeaba por tokens y se descartaba,
-- porque el token puede operar en la cuenta y guardar además la contraseña
-- era acumular riesgo. El costo de esa pureza apareció en la práctica: la
-- API de IOL ROTA el refresh token en cada uso y no tiene otra puerta de
-- entrada. Cuando ese token muere —un corte de red en plena rotación, otra
-- app entrando a IOL con las mismas credenciales, el choque que ya
-- arreglamos— la conexión queda muerta hasta que el usuario vuelva a
-- escribir la contraseña a mano. Pasó tres veces en una semana.
--
-- El dueño eligió, explícitamente, disponibilidad: "necesito que el sistema
-- opere normalmente durante el horario de mercado". Así que la contraseña
-- se guarda CIFRADA (AES-GCM, la clave vive en un secret de las Edge
-- Functions, fuera de la base) y se usa para UNA sola cosa: volver a entrar
-- cuando IOL rechaza la renovación. Nunca se loguea, nunca sale por la API,
-- y no hay policy de SELECT que la exponga.
-- ============================================================

ALTER TABLE iol_credentials
  ADD COLUMN IF NOT EXISTS password_enc TEXT;

COMMENT ON COLUMN iol_credentials.password_enc IS
  'Contraseña de IOL cifrada con la clave de las Edge Functions. Último recurso cuando IOL rechaza el refresh token: sin esto, cada muerte del token obliga a reconectar a mano. Se borra al desconectar.';

-- El usuario (account_label) ya se guarda en claro como etiqueta; es el mismo
-- que se usa para el login, así que no hace falta duplicarlo cifrado.
