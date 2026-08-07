import type { Recommendation } from '@/lib/types'

/**
 * Orden de importancia de las recomendaciones.
 *
 * ── Por qué existe esto ──────────────────────────────────────────────────
 *
 * Antes se ordenaba con `.order('confidence')` en la consulta. `confidence` es
 * TEXT, así que Postgres ordena alfabéticamente: **high, low, medium**. O sea
 * que convicción MEDIA aparecía debajo de BAJA. Nunca se notó porque casi
 * siempre hay dos o tres recomendaciones.
 *
 * Se resuelve en el cliente y no con una columna nueva porque el criterio es de
 * presentación y puede cambiar sin migrar nada.
 */

const CONFIDENCE_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

/**
 * Dentro de una misma convicción, primero lo que protege plata.
 *
 * Cortar una pérdida o tomar una ganancia que se está dando vuelta es urgente:
 * si no se hace hoy, mañana el precio ya se movió. Una compra puede esperar un
 * día sin costo — el activo va a seguir estando.
 */
const ACTION_RANK: Record<string, number> = {
  sell: 0,
  trim: 1,
  rebalance: 2,
  buy: 3,
  add: 4,
  hold: 5,
}

export function importanceRank(rec: Recommendation): number {
  const confidence = CONFIDENCE_RANK[rec.confidence] ?? 3
  const action = ACTION_RANK[rec.action] ?? 5
  // La convicción manda; la acción desempata dentro del mismo nivel
  return confidence * 10 + action
}

/** De más a menos importante, y a igual importancia la más reciente primero. */
export function byImportance(a: Recommendation, b: Recommendation): number {
  const diff = importanceRank(a) - importanceRank(b)
  if (diff !== 0) return diff
  return b.created_at.localeCompare(a.created_at)
}

/**
 * La que hay que mirar primero.
 *
 * `hold` queda afuera: "no hagas nada" es información valiosa, pero no es algo
 * para destacar arriba del Dashboard como si hubiera que actuar.
 */
export function topAction(recs: Recommendation[]): Recommendation | null {
  const actionable = recs.filter((r) => r.action !== 'hold' && !r.fulfilled_at)
  if (!actionable.length) return null
  return [...actionable].sort(byImportance)[0]
}
