import type { Position, PositionMetrics, SectorSlice } from './types'
import { RESCUE_RANK, sortSectors } from './sectors'
import { formatPct } from './format'

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

export type SellCandidate = PositionMetrics & {
  /** Cuánto conviene vender esto, de 0 a ~160 */
  score: number
  /** Por qué conviene (o por qué no) */
  reason: string
  /** false = vender esto tiene un costo real; no debería sugerirse */
  advisable: boolean
}

/**
 * Punto de partida según qué es el activo.
 * Un money market es plata estacionada: venderlo no cristaliza nada ni te saca
 * de una posición. Un CEDEAR sí. Un bono además puede tener spread de salida.
 */
const ASSET_BASE: Record<string, number> = { FCI: 100, CEDEAR: 50, ACCION: 50, BONO: 35 }

/** Cuánto suma la rapidez de rescate. */
const RESCUE_BONUS: Record<string, number> = { 'T+0': 30, 'T+1': 15, 'T+2': 0 }

/**
 * Ranking de qué conviene vender para hacerse de efectivo.
 *
 * El orden anterior era solo "lo más rápido primero, y dentro de eso lo más
 * grande". Eso responde "qué puedo sacar antes", no "qué me conviene sacar":
 * ponía arriba una posición en pérdida solo porque liquidaba rápido.
 *
 * Ahora se combinan tres cosas:
 *  · qué es el activo (liquidez estacionada vs una posición de inversión)
 *  · qué tan rápido entrega la plata
 *  · qué te cuesta venderlo (pérdida a cristalizar, ganancia a resignar,
 *    o sobre-ponderación que además te conviene corregir)
 *
 * Lo que está en pérdida queda marcado como NO recomendable: venderlo convierte
 * una pérdida en papel en una pérdida real. Aparece igual, pero separado y
 * explicando por qué, en vez de esconderlo.
 */
export function sellRanking(
  positions: PositionMetrics[],
  { rebalancePct = 15 }: { rebalancePct?: number } = {},
): SellCandidate[] {
  return positions
    .map((p): SellCandidate => {
      const isCash = p.asset_type === 'FCI'
      let score = ASSET_BASE[p.asset_type] ?? 40
      score += RESCUE_BONUS[p.rescue_time ?? ''] ?? 0

      let reason: string
      let advisable = true

      if (isCash) {
        // No tiene P/L relevante: es plata parada
        reason = p.rescue_time === 'T+0' ? 'Liquidez, rescate hoy' : 'Liquidez'
      } else if (p.gainPct < 0) {
        // Vender acá transforma una pérdida en papel en una pérdida real
        advisable = false
        score -= 60 + Math.min(Math.abs(p.gainPct), 30)
        reason = `En pérdida ${formatPct(p.gainPct, 1)} — cristalizarías la pérdida`
      } else if (p.weight >= rebalancePct) {
        // Doblemente bueno: hacés caja y de paso corregís la concentración
        score += 25
        reason = `Sobre-ponderada: ${p.weight.toFixed(1)}% de la cartera`
      } else {
        // Ganancia realizable, pero resignás la posición
        score += Math.min(p.gainPct, 20) / 2
        reason = `Ganancia realizable ${formatPct(p.gainPct, 1)}`
      }

      return { ...p, score, reason, advisable }
    })
    .sort((a, b) => {
      // Lo no recomendable siempre al fondo, sin importar el score
      if (a.advisable !== b.advisable) return a.advisable ? -1 : 1
      if (Math.abs(b.score - a.score) > 0.5) return b.score - a.score
      // Empate: primero lo que entrega antes, después lo más grande
      const rankA = RESCUE_RANK[a.rescue_time ?? ''] ?? 9
      const rankB = RESCUE_RANK[b.rescue_time ?? ''] ?? 9
      return rankA !== rankB ? rankA - rankB : b.value - a.value
    })
}
