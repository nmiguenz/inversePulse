import type { Position, PositionMetrics, SectorSlice } from './types'
import { RESCUE_RANK, sortSectors } from './sectors'

/**
 * Valor de mercado de una posición.
 *
 * Siempre el `market_value` que calcula IOL. El fallback a quantity * precio
 * solo aplica a filas viejas sincronizadas antes de la migración 0005, y es
 * incorrecto para bonos (cotizan por 100 nominales).
 */
function valueOf(p: Position): number {
  // `||` y no `??`: una posición valuada en 0 no es un dato útil, es una fila
  // que todavía no sincronizó. Con `??` la cartera entera mostraba $0.
  return p.market_value || p.quantity * p.current_price
}

export function withMetrics(positions: Position[]): PositionMetrics[] {
  const total = positions.reduce((sum, p) => sum + valueOf(p), 0)

  return positions
    .map((p) => {
      const value = valueOf(p)
      const cost = p.quantity * p.avg_buy_price
      return {
        ...p,
        value,
        dayPct: p.previous_close > 0 ? ((p.current_price - p.previous_close) / p.previous_close) * 100 : 0,
        gain: p.gain_amount ?? value - cost,
        gainPct: p.gain_pct ?? (cost > 0 ? ((value - cost) / cost) * 100 : 0),
        weight: total > 0 ? (value / total) * 100 : 0,
      }
    })
    .sort((a, b) => b.value - a.value)
}

export function totalValue(positions: PositionMetrics[]): number {
  return positions.reduce((sum, p) => sum + p.value, 0)
}

/**
 * Variación del día de toda la cartera, en pesos y en %.
 * El valor de ayer se deriva del valor de hoy y la variación diaria de cada
 * posición — no de quantity * previous_close, que arrastra el problema de los
 * bonos cotizados por 100 nominales.
 */
export function dayChange(positions: PositionMetrics[]): { amount: number; pct: number } {
  const previous = positions.reduce((sum, p) => sum + p.value / (1 + p.dayPct / 100), 0)
  const current = totalValue(positions)
  if (previous === 0) return { amount: 0, pct: 0 }
  return { amount: current - previous, pct: ((current - previous) / previous) * 100 }
}

export function sectorBreakdown(positions: PositionMetrics[]): SectorSlice[] {
  const total = totalValue(positions)
  const byS = new Map<string, number>()
  for (const p of positions) byS.set(p.sector, (byS.get(p.sector) ?? 0) + p.value)

  return sortSectors(
    [...byS.entries()].map(([sector, value]) => ({
      sector,
      value,
      pct: total > 0 ? (value / total) * 100 : 0,
    })),
  )
}

/** Peor posición por P/L en pesos (la que se muestra en la MetricCard de pérdida) */
export function worstPosition(positions: PositionMetrics[]): PositionMetrics | null {
  const losers = positions.filter((p) => p.gain < 0)
  if (!losers.length) return null
  return losers.reduce((worst, p) => (p.gain < worst.gain ? p : worst))
}

/** Top 5 para extraer plata: primero por plazo de rescate, después por valuación */
export function fastestLiquidity(positions: PositionMetrics[], limit = 5): PositionMetrics[] {
  return [...positions]
    .sort((a, b) => {
      const rankA = RESCUE_RANK[a.rescue_time ?? ''] ?? 9
      const rankB = RESCUE_RANK[b.rescue_time ?? ''] ?? 9
      return rankA !== rankB ? rankA - rankB : b.value - a.value
    })
    .slice(0, limit)
}
