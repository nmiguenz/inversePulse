/**
 * Colores por sector.
 *
 * Paleta categórica validada contra la superficie de las cards (#0E0E14):
 * banda de lightness, piso de croma, separación CVD (peor par adyacente ΔE 8.4
 * protan) y contraste ≥ 3:1 — todos PASS.
 *
 * El color sigue al SECTOR, nunca a su posición en el ranking: si cambia la
 * composición de la cartera, Tech sigue siendo azul.
 */
export const SECTOR_ORDER = [
  'Tech',
  'Renta Fija',
  'CER',
  'Energía',
  'Defensivo',
  'Liquidez',
  'Otros',
] as const

export const SECTOR_COLORS: Record<string, string> = {
  Tech: '#3987e5',
  'Renta Fija': '#d95926',
  CER: '#199e70',
  Energía: '#c98500',
  Defensivo: '#d55181',
  Liquidez: '#008300',
  Otros: '#9085e9',
}

export function sectorColor(sector: string): string {
  return SECTOR_COLORS[sector] ?? SECTOR_COLORS.Otros
}

/** Orden estable para el donut y la leyenda */
export function sortSectors<T extends { sector: string }>(items: T[]): T[] {
  const index = (s: string) => {
    const i = SECTOR_ORDER.indexOf(s as (typeof SECTOR_ORDER)[number])
    return i === -1 ? SECTOR_ORDER.length : i
  }
  return [...items].sort((a, b) => index(a.sector) - index(b.sector))
}

/** Ranking de liquidez: T+0 primero */
export const RESCUE_RANK: Record<string, number> = { 'T+0': 0, 'T+1': 1, 'T+2': 2 }

export const RESCUE_LABEL: Record<string, string> = {
  'T+0': 'rescate hoy',
  'T+1': 'mañana',
  'T+2': 'en 2 días',
}
