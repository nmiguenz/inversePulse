-- ============================================================
-- Nombres reales de los fondos, y PCOMAGB fuera de "Liquidez"
--
-- La migración 0004 sembró los nombres de los FCI declarando en su propio
-- comentario que salían "del mockup del dashboard en docs/CLAUDE.md". Eran
-- inventados, y los tres estaban mal:
--
--   símbolo    lo que decía la app        lo que dice IOL
--   PRMCAPB    Premier Renta CP           Premier Capital
--   CNXPOPA    Cohen Renta Fija           Adcap Pesos Plus
--   PCOMAGB    Pellegrini Money Market    Premier Commodities
--
-- El tercero es el grave: un fondo de COMMODITIES estaba etiquetado como money
-- market y clasificado en el sector "Liquidez". Eso lo metía en el ranking de
-- "si necesitás efectivo" como si fuera un equivalente de caja, y desde la
-- migración anterior también contaba dentro del piso de liquidez intocable que
-- recibe el asesor.
--
-- Los datos lo confirman: acumula +15,85% y se movió +0,79% en un día. Un
-- money market se mueve 0,06% diario. No es liquidez, es un activo de riesgo.
-- ============================================================

UPDATE asset_metadata SET display_name = 'Premier Capital'   WHERE symbol = 'PRMCAPB';
UPDATE asset_metadata SET display_name = 'Adcap Pesos Plus'  WHERE symbol = 'CNXPOPA';

UPDATE asset_metadata
SET display_name = 'Premier Commodities',
    -- Sale de Liquidez: no es caja. Va a "Otros" y no a un sector inventado —
    -- clasificarlo bien requiere saber a qué está expuesto el fondo, y eso no
    -- lo sé desde acá.
    sector = 'Otros'
WHERE symbol = 'PCOMAGB';

-- Se propaga a las posiciones ya sincronizadas para no esperar al próximo sync
UPDATE positions p
SET description = m.display_name,
    sector = m.sector
FROM asset_metadata m
WHERE p.symbol = m.symbol
  AND p.symbol IN ('PRMCAPB', 'CNXPOPA', 'PCOMAGB');

-- ============================================================
-- Qué fondos cuentan como caja
--
-- El piso de liquidez del asesor y el ranking de "si necesitás efectivo"
-- necesitan distinguir un money market de un fondo de riesgo que también
-- rescata en el día. El plazo de rescate NO alcanza: PCOMAGB rescata T+0 y no
-- es caja.
-- ============================================================
ALTER TABLE asset_metadata
  ADD COLUMN IF NOT EXISTS is_cash_equivalent BOOLEAN DEFAULT false;

COMMENT ON COLUMN asset_metadata.is_cash_equivalent IS
  'Money market real: rescate inmediato Y sin riesgo de precio. No basta con rescue_time T+0.';

-- Solo los dos de renta fija corta. PCOMAGB queda afuera a propósito.
UPDATE asset_metadata
SET is_cash_equivalent = true
WHERE symbol IN ('PRMCAPB', 'CNXPOPA');
