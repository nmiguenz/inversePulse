/**
 * fetch-portfolio — cada 5 min, lun-vie 10:00-18:00 (pg_cron)
 *
 * 1. Llama a IOL → portafolio + estado de cuenta
 * 2. Actualiza `positions` (upsert por user_id+symbol, borra las cerradas)
 * 3. Actualiza `account_balance`
 * 4. Guarda el cierre del día en `price_history` (para los sparklines)
 * 5. Guarda el snapshot diario en `portfolio_snapshots`
 *
 * Requiere secrets: IOL_USERNAME, IOL_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAccessToken, iol, type IolActivo } from '../_shared/iol.ts'
import { isServiceRole, unauthorized } from '../_shared/auth.ts'
import {
  previousClose,
  toAssetType,
  toCurrency,
  toRescueTime,
  toSector,
  valueInArs,
} from '../_shared/mapping.ts'

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

/** Fecha de hoy en Buenos Aires (el mercado local define el día del snapshot) */
function todayBA(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
}

async function syncUser(userId: string) {
  const token = await getAccessToken(db, userId)
  const [portfolio, estado] = await Promise.all([iol.portfolio(token), iol.estadoCuenta(token)])

  const activos: IolActivo[] = portfolio.activos ?? []
  const symbols = activos.map((a) => a.titulo.simbolo)

  // Sectores/plazos configurables desde asset_metadata
  const { data: metadata } = await db
    .from('asset_metadata')
    .select('symbol, sector, rescue_time, display_name')
    .in('symbol', symbols.length ? symbols : ['__none__'])

  const metaBySymbol = new Map((metadata ?? []).map((m) => [m.symbol, m]))
  const today = todayBA()

  const positions = activos.map((a) => {
    const meta = metaBySymbol.get(a.titulo.simbolo)
    const assetType = toAssetType(a.titulo.tipo)
    return {
      user_id: userId,
      symbol: a.titulo.simbolo,
      description: meta?.display_name ?? a.titulo.descripcion,
      quantity: a.cantidad,
      avg_buy_price: a.ppc,
      current_price: a.ultimoPrecio,
      previous_close: previousClose(a),
      // Valuación y P/L los calcula IOL. No recalcular con quantity * precio:
      // los bonos cotizan por 100 nominales y el resultado sale 100x.
      market_value: valueInArs(a),
      gain_amount: a.gananciaDinero ?? 0,
      gain_pct: a.gananciaPorcentaje ?? 0,
      sector: toSector(a, meta?.sector),
      asset_type: assetType,
      currency: toCurrency(a.titulo.moneda),
      rescue_time: meta?.rescue_time ?? toRescueTime(a.titulo.plazo, assetType),
      updated_at: new Date().toISOString(),
    }
  })

  if (positions.length) {
    const { error } = await db.from('positions').upsert(positions, { onConflict: 'user_id,symbol' })
    if (error) throw error
  }

  // Posiciones que ya no están en el portafolio (vendidas)
  const { data: stored } = await db.from('positions').select('symbol').eq('user_id', userId)
  const closed = (stored ?? []).map((p) => p.symbol).filter((s) => !symbols.includes(s))
  if (closed.length) {
    const { error } = await db.from('positions').delete().eq('user_id', userId).in('symbol', closed)
    if (error) throw error
  }

  // Precio del día para los sparklines
  if (activos.length) {
    const { error } = await db.from('price_history').upsert(
      activos.map((a) => ({
        symbol: a.titulo.simbolo,
        close_price: a.ultimoPrecio,
        recorded_at: today,
      })),
      { onConflict: 'symbol,recorded_at' },
    )
    if (error) throw error
  }

  // Balance — la cuenta en pesos es la de referencia del dashboard
  const cuentaArs = estado.cuentas?.find((c) => c.moneda?.toLowerCase().includes('peso'))
  const cuentaUsd = estado.cuentas?.find((c) => c.moneda?.toLowerCase().includes('dolar'))
  const totalValue = activos.reduce((sum, a) => sum + valueInArs(a), 0)
  const totalGainLoss = activos.reduce((sum, a) => sum + (a.gananciaDinero ?? 0), 0)

  const { data: existingBalance } = await db
    .from('account_balance')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()

  const balance = {
    user_id: userId,
    available_ars: cuentaArs?.disponible ?? 0,
    committed_ars: cuentaArs?.comprometido ?? 0,
    available_usd: cuentaUsd?.disponible ?? 0,
    total_portfolio_value: totalValue,
    total_gain_loss: totalGainLoss,
    updated_at: new Date().toISOString(),
  }

  const { error: balanceError } = existingBalance
    ? await db.from('account_balance').update(balance).eq('id', existingBalance.id)
    : await db.from('account_balance').insert(balance)
  if (balanceError) throw balanceError

  // Snapshot diario (se pisa durante el día, queda el último valor)
  const byType = (type: string) =>
    activos
      .filter((a) => toAssetType(a.titulo.tipo) === type)
      .reduce((sum, a) => sum + valueInArs(a), 0)

  const { error: snapshotError } = await db.from('portfolio_snapshots').upsert(
    {
      user_id: userId,
      total_value: totalValue,
      cedears_value: byType('CEDEAR'),
      fci_value: byType('FCI'),
      bonds_value: byType('BONO'),
      cash_value: cuentaArs?.disponible ?? 0,
      snapshot_date: today,
    },
    { onConflict: 'user_id,snapshot_date' },
  )
  if (snapshotError) throw snapshotError

  await db
    .from('iol_credentials')
    .update({ last_sync_at: new Date().toISOString(), last_sync_error: null })
    .eq('user_id', userId)

  return { symbols: positions.length, totalValue }
}

Deno.serve(async (req) => {
  // Solo se invoca desde pg_cron / manualmente con la service role key
  if (!isServiceRole(req)) return unauthorized()

  const { data: users, error } = await db.from('users').select('id')
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const results: Record<string, unknown> = {}

  for (const user of users ?? []) {
    try {
      results[user.id] = await syncUser(user.id)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      results[user.id] = { error: message }
      await db
        .from('iol_credentials')
        .upsert({ user_id: user.id, last_sync_error: message, updated_at: new Date().toISOString() })
      console.error(`[fetch-portfolio] ${user.id}:`, message)
    }
  }

  // Encadenar la evaluación de alertas con los precios recién actualizados.
  // Si falla, el sync ya está guardado igual: no debe tumbar esta respuesta.
  try {
    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/evaluate-alerts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json',
      },
    })
    results.alerts = await res.json()
  } catch (err) {
    results.alerts = { error: err instanceof Error ? err.message : String(err) }
  }

  return Response.json({ ok: true, results })
})
