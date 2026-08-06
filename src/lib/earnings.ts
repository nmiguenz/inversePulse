/**
 * La regla de "a qué activos les falta la fecha de resultados".
 *
 * Vive acá porque la usan tres lugares: la pantalla de carga (Config →
 * Earnings), el chequeo que corre al abrir la app y —replicada en Deno— la
 * función `earnings-reminder`. Con la regla escrita en cada lugar era cuestión
 * de tiempo que se desincronizaran y la app avisara de algo que la pantalla
 * mostraba como cargado.
 */

/** Lo mínimo que necesita la regla de una posición */
export type EarningsCandidate = { symbol: string; asset_type: string }

/** Lo mínimo que necesita la regla de una fila del calendario */
export type EarningsEntry = { symbol: string; is_reported?: boolean | null }

/**
 * Los tipos de activo que reportan resultados trimestrales.
 * Los bonos y los fondos comunes no, así que nunca cuentan como faltantes.
 */
export function reportsEarnings(assetType: string): boolean {
  return assetType === 'CEDEAR' || assetType === 'ACCION'
}

/**
 * Símbolos en cartera que reportan resultados y no tienen ninguna fecha futura
 * pendiente cargada.
 *
 * `calendar` tiene que venir ya filtrado a fechas de hoy en adelante: la regla
 * no puede saber qué ventana pidió quien la llama.
 */
export function missingEarnings(
  positions: EarningsCandidate[],
  calendar: EarningsEntry[],
): string[] {
  const scheduled = new Set(calendar.filter((e) => !e.is_reported).map((e) => e.symbol))

  return [
    ...new Set(
      positions
        .filter((p) => reportsEarnings(p.asset_type) && !scheduled.has(p.symbol))
        .map((p) => p.symbol),
    ),
  ].sort()
}

/** El texto del aviso, compartido entre la alerta y la pantalla */
export function missingEarningsTitle(symbols: string[]): string {
  return symbols.length === 1
    ? `Falta la fecha de resultados de ${symbols[0]}`
    : `Faltan ${symbols.length} fechas de resultados`
}
