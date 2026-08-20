-- ============================================================
-- Los bonos también tienen par en dólares
--
-- La 0031 asumió que esto era cosa de CEDEARs. No: el detalle de TZXD6 trae
-- `related_symbols.dollar = "TXD6D"`. Las acciones locales también (GGAL →
-- GGALD). Los únicos que realmente no tienen par son los FCI, verificado
-- contra CNXPOPA y PRMCAPB, que devuelven `dollar: null`.
--
-- Y confirma que la abreviatura de los símbolos de 5 caracteres NO se puede
-- derivar con una regla: GOOGL tira la segunda O, TZXD6 tira la Z. Por eso se
-- curan uno por uno acá en vez de intentar adivinarlos.
-- ============================================================

UPDATE asset_metadata SET dollar_symbol = 'TXD6D' WHERE symbol = 'TZXD6';

-- El bono puede no estar en asset_metadata: la tabla es el universo curado y
-- los títulos públicos entraron por posición, no por el seed.
INSERT INTO asset_metadata (symbol, sector, asset_type, rescue_time, display_name, dollar_symbol)
SELECT 'TZXD6', 'CER', 'BONO', 'T+1', 'Boncer Vto 15/12/26', 'TXD6D'
WHERE NOT EXISTS (SELECT 1 FROM asset_metadata WHERE symbol = 'TZXD6');
