-- ============================================================
-- Backfill: los análisis viejos de noticias, a news_analysis
--
-- La 0023 movió el análisis a una tabla por usuario, pero los análisis que
-- ya existían quedaron en las columnas globales de `news` — que la pantalla
-- ya no lee. Resultado: todo el historial apareció como "neutral" de un día
-- para el otro, como si nunca se hubiera analizado.
--
-- Se copian a cada usuario existente. Ese análisis se calculó sobre la
-- cartera del dueño de la única key que había, así que para los usuarios de
-- entonces es exactamente el suyo.
-- ============================================================

INSERT INTO news_analysis (news_id, user_id, summary, sentiment, impact_level, related_symbols, tags)
SELECT n.id, u.id, n.summary, n.sentiment, n.impact_level, n.related_symbols, n.tags
FROM news n
CROSS JOIN users u
WHERE n.summary IS NOT NULL
ON CONFLICT (news_id, user_id) DO NOTHING;

-- Las columnas globales quedan como legado, ya sin lectores. No se borran en
-- esta migración para poder verificar el backfill contra ellas; se van en una
-- limpieza futura.
