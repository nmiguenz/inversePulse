/**
 * fetch-dollar-rates — cada 10 min, lun-vie 10:00-18:00
 * Fuente: dolarapi.com (pública, sin API key)
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isServiceRole, unauthorized } from '../_shared/auth.ts'

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

type DolarApiItem = {
  casa: string // oficial, blue, bolsa, contadoconliqui, cripto, tarjeta, mayorista
  compra: number | null
  venta: number | null
}

/** casa de dolarapi → rate_type del schema */
const TYPES: Record<string, string> = {
  oficial: 'oficial',
  blue: 'blue',
  bolsa: 'mep',
  contadoconliqui: 'ccl',
  cripto: 'cripto',
}

Deno.serve(async (req) => {
  if (!isServiceRole(req)) return unauthorized()

  const res = await fetch('https://dolarapi.com/v1/dolares')
  if (!res.ok) {
    return Response.json({ error: `dolarapi → ${res.status}` }, { status: 502 })
  }

  const items = (await res.json()) as DolarApiItem[]
  const rows = items
    .filter((i) => TYPES[i.casa])
    .map((i) => ({
      rate_type: TYPES[i.casa],
      buy_price: i.compra,
      sell_price: i.venta,
      spread: i.venta != null && i.compra != null ? i.venta - i.compra : null,
      recorded_at: new Date().toISOString(),
    }))

  const { error } = await db.from('dollar_rates').insert(rows)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  // TODO(Fase 3): si la brecha MEP/oficial supera el umbral → alerta
  return Response.json({ ok: true, inserted: rows.length })
})
