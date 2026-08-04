import type { IolActivo } from './iol.ts'

/** tipo de IOL → asset_type del schema */
export function toAssetType(tipo: string): string {
  const t = tipo.toLowerCase()
  if (t.includes('cedear')) return 'CEDEAR'
  if (t.includes('fondo')) return 'FCI'
  if (t.includes('titulospublicos') || t.includes('bono') || t.includes('obligacion')) return 'BONO'
  if (t.includes('accion')) return 'ACCION'
  return tipo
}

/** plazo de IOL (t0/t1/t2) → rescue_time */
export function toRescueTime(plazo: string | undefined, assetType: string): string {
  const p = (plazo ?? '').toLowerCase().replace(/[^0-9t]/g, '')
  if (p === 't0') return 'T+0'
  if (p === 't1') return 'T+1'
  if (p === 't2') return 'T+2'
  // Default por tipo cuando IOL no informa plazo
  if (assetType === 'FCI') return 'T+0'
  return 'T+1'
}

/** moneda de IOL → código ISO */
export function toCurrency(moneda: string | undefined): string {
  return (moneda ?? '').toLowerCase().includes('dolar') ? 'USD' : 'ARS'
}

/**
 * Sector del activo. Prioridad: tabla asset_metadata → heurística por tipo.
 * Los CEDEARs desconocidos caen en 'Tech' solo si están en la lista; si no,
 * quedan como 'Otros' para que se note que falta cargarlos en asset_metadata.
 */
export function toSector(activo: IolActivo, fromMetadata?: string): string {
  if (fromMetadata) return fromMetadata

  const assetType = toAssetType(activo.titulo.tipo)
  if (assetType === 'FCI') return 'Liquidez'
  if (assetType === 'BONO') {
    const s = activo.titulo.simbolo.toUpperCase()
    // Bonos CER suelen empezar con TX/TZX/TC; el resto, renta fija
    return /^(TX|TZX|TC|PR|DIC|CUAP|PARP)/.test(s) ? 'CER' : 'Renta Fija'
  }
  return 'Otros'
}

/** El precio de un CEDEAR/bono viene en la moneda del título; se normaliza a ARS */
export function valueInArs(activo: IolActivo): number {
  return activo.valorizado ?? activo.cantidad * activo.ultimoPrecio
}

/** previous_close derivado de la variación diaria (IOL no lo expone directo) */
export function previousClose(activo: IolActivo): number {
  const pct = activo.variacionDiaria ?? 0
  if (!activo.ultimoPrecio) return 0
  if (pct === -100) return 0
  return activo.ultimoPrecio / (1 + pct / 100)
}
