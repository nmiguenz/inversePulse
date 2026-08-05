/**
 * evaluate-recommendations — diaria
 *
 * Marca el resultado de las recomendaciones que ya cumplieron 30 días,
 * comparando el precio de entonces contra el de hoy. No usa IA: es aritmética
 * sobre `price_history`, así que no cuesta nada.
 *
 * Es lo que evita que el asesor sea una caja negra. Una recomendación de compra
 * cuyo activo subió es correcta; una de venta cuyo activo subió es incorrecta.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isServiceRole, unauthorized } from '../_shared/auth.ts'

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

const HORIZON_DAYS = 30
/** Debajo de este movimiento no se le atribuye acierto ni error a nadie. */
const NOISE_PCT = 3

type Action = 'buy' | 'add' | 'trim' | 'sell' | 'rebalance' | 'hold'

/** Comprar y que suba es acertar; vender y que suba es errar. */
function verdict(action: Action, changePct: number): string {
  if (Math.abs(changePct) < NOISE_PCT) return 'neutral'

  const wantedUp = action === 'buy' || action === 'add'
  const wantedDown = action === 'sell' || action === 'trim'

  if (wantedUp) return changePct > 0 ? 'correcta' : 'incorrecta'
  if (wantedDown) return changePct < 0 ? 'correcta' : 'incorrecta'
  return 'neutral' // rebalance y hold no se juzgan por el precio de un solo activo
}

Deno.serve(async (req) => {
  if (!isServiceRole(req)) return unauthorized()

  const cutoff = new Date(Date.now() - HORIZON_DAYS * 864e5).toISOString()

  const { data: pending } = await db
    .from('recommendations')
    .select('id, action, symbol, price_at_recommendation, created_at')
    .is('evaluated_at', null)
    .lte('created_at', cutoff)
    .limit(100)

  if (!pending?.length) {
    return Response.json({ ok: true, evaluated: 0, note: 'nada cumplió los 30 días todavía' })
  }

  const results: Array<Record<string, unknown>> = []

  for (const rec of pending) {
    if (!rec.price_at_recommendation) {
      // Sin precio de referencia no hay nada que comparar; se cierra para no
      // volver a mirarla en cada corrida
      await db
        .from('recommendations')
        .update({ evaluated_at: new Date().toISOString(), outcome_verdict: 'sin_precio' })
        .eq('id', rec.id)
      continue
    }

    const { data: latest } = await db
      .from('price_history')
      .select('close_price, recorded_at')
      .eq('symbol', rec.symbol)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!latest) continue // todavía no hay precio nuevo del activo

    const before = Number(rec.price_at_recommendation)
    const after = Number(latest.close_price)
    const changePct = ((after - before) / before) * 100
    const outcome = verdict(rec.action as Action, changePct)

    await db
      .from('recommendations')
      .update({
        price_after_30d: after,
        outcome_pct: changePct,
        outcome_verdict: outcome,
        evaluated_at: new Date().toISOString(),
        is_active: false,
      })
      .eq('id', rec.id)

    results.push({ symbol: rec.symbol, action: rec.action, changePct: changePct.toFixed(1), outcome })
  }

  return Response.json({ ok: true, evaluated: results.length, results })
})
