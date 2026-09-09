/**
 * El perfil del inversor y los umbrales, en el formato que espera el asesor.
 *
 * Existe porque `portfolio-advisor` y `goal-advisor` armaban este contexto cada
 * uno por su lado, con nombres que no coincidían con los del prompt. Cuando el
 * contrato cambió, los dos se rompieron igual y de la misma forma.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { AdvisorContext, InvestorProfile } from './claude.ts'

/**
 * Límites de position sizing.
 *
 * Son ADICIONALES a los umbrales del usuario, no los reemplazan: los de
 * `settings` son alertas que el prompt le pide al modelo respetar, y estos son
 * un techo que el código aplica sobre lo que el modelo devolvió, aunque el
 * modelo no los haya respetado. Viven acá, al lado de `toAdvisorSettings`,
 * porque son parte del mismo contrato de riesgo.
 */

/** Máximo peso que puede alcanzar una posición NUEVA (que no está en cartera). */
export const MAX_NEW_POSITION_PCT = 8
/** Máximo peso que puede alcanzar una posición EXISTENTE después de agregar. */
export const MAX_EXISTING_POSITION_PCT = 15
/** Máximo peso sectorial después de la operación. */
export const MAX_SECTOR_AFTER_BUY_PCT = 40

/** Lo que hay guardado en `users.settings`. Todo opcional: viene de un JSONB. */
export type UserSettings = {
  rebalance_pct?: number
  sector_concentration_pct?: number
  take_profit_pct?: number
  stop_loss_pct?: number
  trailing_stop_pct?: number
  trailing_min_gain_pct?: number
  daily_extreme_pct?: number
  rebuy_watch_pct?: number
  liquidity_floor_pct?: number
  risk_profile?: string
  preferred_sectors?: string[]
  objective?: string
  allow_ai_after_hours?: boolean
}

/**
 * Los 9 umbrales que el prompt escribe, con los nombres que el prompt usa.
 *
 * Dos no coinciden con la base y por eso están acá y no dispersos:
 *
 * - `fixed_ceiling_pct` ← `take_profit_pct`. Es el techo fijo de ganancia, que
 *   quedó en 0 —desactivado— cuando lo reemplazó el trailing stop.
 * - `rebuy_alert_pct` ← `rebuy_watch_pct`.
 *
 * Los defaults importan: sin ellos el prompt renderiza "undefined%" y el modelo
 * recibe una instrucción sin número, que es peor que no dársela.
 */
export function toAdvisorSettings(s: UserSettings | null | undefined): AdvisorContext['settings'] {
  const v = s ?? {}
  return {
    rebalance_pct: v.rebalance_pct ?? 15,
    sector_concentration_pct: v.sector_concentration_pct ?? 50,
    take_profit_pct: v.take_profit_pct ?? 0,
    stop_loss_pct: v.stop_loss_pct ?? -15,
    trailing_stop_pct: v.trailing_stop_pct ?? 12,
    trailing_min_gain_pct: v.trailing_min_gain_pct ?? 15,
    fixed_ceiling_pct: v.take_profit_pct ?? 0,
    daily_extreme_pct: v.daily_extreme_pct ?? 5,
    rebuy_alert_pct: v.rebuy_watch_pct ?? 10,
  }
}

/** Cuántas operaciones entran en el historial que ve el modelo. */
const HISTORY_SIZE = 15

/**
 * Arma el perfil que el asesor usa para saber a quién le habla.
 *
 * `investmentHistory` sale de las operaciones REALES, no de un campo cargado a
 * mano: un texto escrito una vez describe al inversor que eras ese día. Lo que
 * compraste y vendiste el mes pasado es lo que efectivamente hacés.
 *
 * Se resume en una línea por operación a propósito. El historial entra en el
 * prompt de cada corrida, así que cada línea de más se paga dos veces por día.
 */
export async function buildInvestorProfile(
  db: SupabaseClient,
  userId: string,
  settings: UserSettings | null | undefined,
): Promise<InvestorProfile> {
  const s = settings ?? {}

  // El valor guardado está en castellano ('agresivo'), el prompt espera inglés
  const riskProfile = s.risk_profile === 'moderado' ? 'moderate' : 'aggressive'

  return {
    riskProfile,
    preferredSectors: Array.isArray(s.preferred_sectors) ? s.preferred_sectors : [],
    objective: s.objective ?? '',
    investmentHistory: await recentOperations(db, userId),
  }
}

/** Las últimas operaciones, en una línea cada una. */
async function recentOperations(db: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await db
    .from('transactions')
    .select('kind, side, symbol, quantity, total, executed_at')
    .eq('user_id', userId)
    // Los aportes y retiros no son decisiones de inversión: mueven plata hacia
    // adentro o hacia afuera, no dicen nada sobre en qué creés.
    .not('kind', 'in', '("deposit","withdrawal")')
    .order('executed_at', { ascending: false })
    .limit(HISTORY_SIZE)

  if (error || !data?.length) return ''

  const fmt = (n: number) =>
    new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      maximumFractionDigits: 0,
    }).format(n)

  return data
    .map((t) => {
      const date = (t.executed_at ?? '').slice(0, 10)
      const verb = t.side === 'sell' ? 'vendió' : 'compró'
      const qty = Number(t.quantity) > 0 ? `${t.quantity} ` : ''
      return `- ${date}: ${verb} ${qty}${t.symbol ?? '(sin símbolo)'} por ${fmt(Number(t.total ?? 0))}`
    })
    .join('\n')
}
