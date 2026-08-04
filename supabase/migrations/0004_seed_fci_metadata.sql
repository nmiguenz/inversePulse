-- ============================================================
-- Metadatos de los FCI y bonos de la cartera
--
-- Por qué: el campo `plazo` que devuelve IOL en /portafolio es el plazo de
-- LIQUIDACIÓN de la posición, no el de RESCATE del fondo. Los money market
-- rescatan T+0 pero IOL los informa como t1, así que el ranking de "liquidez
-- rápida" quedaba mal ordenado. asset_metadata pisa ese valor.
--
-- Los plazos de rescate salen del mockup del dashboard en docs/CLAUDE.md.
-- Si alguno no coincide con lo que ves en IOL, se corrige acá con un UPDATE.
-- ============================================================

INSERT INTO asset_metadata (symbol, sector, asset_type, rescue_time, display_name) VALUES
  ('PRMCAPB', 'Liquidez',   'FCI',  'T+0', 'Premier Renta CP'),
  ('CNXPOPA', 'Liquidez',   'FCI',  'T+0', 'Cohen Renta Fija'),
  ('PCOMAGB', 'Liquidez',   'FCI',  'T+0', 'Pellegrini Money Market'),
  ('TZXD6',   'CER',        'BONO', 'T+1', 'Boncer TZXD6')
ON CONFLICT (symbol) DO UPDATE SET
  sector      = EXCLUDED.sector,
  asset_type  = EXCLUDED.asset_type,
  rescue_time = EXCLUDED.rescue_time;
