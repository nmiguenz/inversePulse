/**
 * fetch-portfolio — cada 5 min, lun-vie 10:00-18:00 (pg_cron)
 *
 * 1. Llama a IOL → portafolio + estado de cuenta
 * 2. Actualiza `positions` (upsert por user_id+symbol, borra las cerradas)
 * 3. Actualiza `account_balance`
 * 4. Guarda el cierre del día en `price_history` (para los sparklines)
 * 5. Guarda el snapshot diario en `portfolio_snapshots`
 *
 * Cada usuario sincroniza con SU propia conexión de IOL. Quien no tenga una
 * conectada se saltea: no hay credenciales globales de respaldo.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  getAccessToken,
  iol,
  NoConnectionError,
  PUBLIC_API,
  type IolActivo,
} from '../_shared/iol.ts'
import { computeImpliedFx, saveImpliedFx } from '../_shared/impliedFx.ts'
import { isServiceRole, unauthorized, userIdFromJwt } from '../_shared/auth.ts'
import { jsonWithCors, preflight } from '../_shared/cors.ts'
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

/**
 * Prima cambiaria de lo que tenés en cartera.
 *
 * La lógica vive en `_shared/impliedFx.ts` porque `fetch-market-quotes` la
 * necesita también, para el universo sugerible. Acá va solo lo que tenés: es
 * lo que el asesor necesita fresco, porque el implícito se mueve durante la
 * rueda.
 */
async function syncImpliedFx(token: string, activos: IolActivo[]) {
  const rows = await computeImpliedFx(
    db,
    token,
    activos.map((a) => ({
      symbol: a.titulo.simbolo,
      arsPrice: a.ultimoPrecio,
      assetType: toAssetType(a.titulo.tipo),
    })),
    'fetch-portfolio',
  )
  await saveImpliedFx(db, rows, 'fetch-portfolio')
}

/**
 * Sondeo de stop loss / take profit. NO escribe nada.
 *
 * El conector MCP de IOL expone `get_stop_loss_and_take_profit` y funciona
 * —devolvió `{"result":[]}`—, pero pega contra `gateway-api-internal`, que
 * NO EXISTE en DNS público: el nombre no resuelve en 1.1.1.1 ni en 8.8.8.8
 * (solo matchea con `.com.ar` agregado, que es un catch-all de typosquatting).
 * O sea que ese host es alcanzable desde adentro de la red de IOL y no desde
 * una Edge Function, así que ni se intenta: sondearlo solo colgaba la función
 * hasta agotar el presupuesto de cómputo.
 *
 * Queda una sola pregunta: si la API PÚBLICA expone stop loss / take profit
 * con alguno de estos nombres. Si todo da 404, la funcionalidad no se puede
 * construir sobre esta conexión y hay que decirlo, no dejar UI colgada de una
 * ruta que no responde.
 *
 * Solo lista: ningún candidato crea ni borra órdenes. En paralelo y con
 * timeout corto porque una Edge Function tiene presupuesto de wall-clock.
 */
const PROBE_TIMEOUT_MS = 6000

async function probeStopLoss(token: string) {
  const paths = [
    '/api/v2/Alertas',
    '/api/v2/alertas',
    '/api/v2/StopLoss',
    '/api/v2/TakeProfit',
    '/api/v2/operar/StopLoss',
    '/api/v2/MiCuenta/Alertas',
  ]

  return await Promise.all(
    paths.map(async (path) => {
      try {
        const res = await fetch(`${PUBLIC_API}${path}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        })
        // El cuerpo se recorta: un 404 de ASP.NET devuelve una página entera
        // de HTML y no aporta nada al sondeo.
        const body = (await res.text().catch(() => '')).slice(0, 300)
        return { path, status: res.status, ok: res.ok, body }
      } catch (err) {
        return { path, status: 'sin respuesta', ok: false, body: String(err).slice(0, 200) }
      }
    }),
  )
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
      // La descripción de IOL manda. `display_name` solo entra si IOL no
      // manda nada: hasta la 0017 el orden estaba al revés y un nombre
      // curado a mano —sacado de un mockup— le ganaba al nombre real del
      // fondo. Así fue como un fondo de commodities se mostró durante
      // semanas como "Pellegrini Money Market".
      description: a.titulo.descripcion || meta?.display_name,
      quantity: a.cantidad,
      // Unidades reservadas por órdenes puestas: quantity menos esto es lo que
      // realmente podés vender hoy
      committed_quantity: a.comprometido ?? 0,
      avg_buy_price: a.ppc,
      current_price: a.ultimoPrecio,
      // La variación diaria se guarda tal como la manda IOL. previous_close se
      // sigue guardando como respaldo para las filas viejas.
      daily_change_pct: a.variacionDiaria ?? 0,
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

  // Prima cambiaria de los CEDEARs. Va acá y no en fetch-market-quotes porque
  // el asesor la necesita fresca: el implícito se mueve durante la rueda.
  await syncImpliedFx(token, activos)

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

  // El desglose por plazo de liquidación se guarda crudo: las etiquetas de
  // `liquidacion` las traduce el frontend, así una etiqueta nueva de IOL no
  // rompe nada acá.
  const saldos = cuentaArs?.saldos ?? []

  // `disponibleOperar` NO es aditivo: cada fila repite el mismo saldo operable
  // visto desde su plazo ("si operás a 24h, podés usar esto"). Sumarlo lo
  // multiplicaba por la cantidad de plazos — con datos reales daba $22.074
  // cuando lo operable eran $5.518.
  //
  // El que vale es el del plazo inmediato; si no viene, el mayor de todos.
  const immediate = saldos.find((s) => s.liquidacion?.toLowerCase().includes('inmediat'))
  const availableToTrade = immediate
    ? immediate.disponibleOperar
    : saldos.length
      ? Math.max(...saldos.map((s) => s.disponibleOperar ?? 0))
      : (cuentaArs?.disponible ?? 0)

  /**
   * El efectivo disponible sale de la SUMA de `disponible` por plazo, no de
   * `cuenta.disponible`.
   *
   * `cuenta.disponible` resta lo comprometido de TODOS los plazos contra el
   * saldo de contado inmediato, y da negativo apenas hay órdenes puestas a 24h.
   * Con datos reales: saldo t0 $374.518,56 menos $479.369,12 comprometidos
   * (de los cuales $231.250,72 son a t1) daba **−$104.850,56**, un número que
   * la propia app de IOL no muestra en ninguna pantalla — ahí dice
   * "Tu disponible total: $126.400,16", que es la suma de los `disponible`.
   *
   * Ojo con la diferencia: `disponible` SÍ es aditivo entre plazos (cada fila
   * trae lo suyo), a diferencia de `disponibleOperar`, que repite el mismo
   * monto en todas las filas.
   */
  const available = saldos.length
    ? saldos.reduce((sum, s) => sum + (s.disponible ?? 0), 0)
    : (cuentaArs?.disponible ?? 0)

  const balance = {
    user_id: userId,
    available_ars: available,
    available_to_trade_ars: availableToTrade,
    settlement_breakdown: saldos.length ? saldos : null,
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

  // ── El resultado del día ──────────────────────────────────────────────
  //
  // Es la suma de cuánto se movió CADA producto en el día, no la diferencia
  // entre el valor total de hoy y el de ayer.
  //
  // La versión anterior restaba los totales y descontaba aportes y retiros. Se
  // veía razonable y estaba mal: `total_value` son las POSICIONES, sin el
  // efectivo. Vender un CEDEAR o rescatar un FCI saca plata de las posiciones y
  // la pone en la cuenta, así que el total caía por el monto de la venta y eso
  // figuraba como pérdida del día. Un rescate de $754.000 aparecía como una
  // pérdida de $754.000 sin que el mercado se hubiera movido.
  //
  // Medido así, comprar, vender, rescatar, ingresar o retirar plata no mueven
  // el número: solo lo mueve el precio. Que es lo que se quiere leer.
  //
  // Se trabaja desde el PORCENTAJE y no desde el precio anterior para no tener
  // que convertir monedas: `valorizado` ya viene en pesos, así que
  // `valorizado / (1 + pct/100)` da el valor de ayer en pesos, sea el activo en
  // dólares o en pesos.
  const dailyPnl = activos.reduce((sum, a) => {
    const pct = a.variacionDiaria ?? 0
    // −100% dejaría el valor de ayer en cero: no se puede derivar, se saltea
    if (pct <= -100) return sum
    const value = valueInArs(a)
    return sum + (value - value / (1 + pct / 100))
  }, 0)

  // Los movimientos de dinero ya NO entran en el resultado, pero se siguen
  // guardando: el rendimiento del período los necesita para no contar un
  // aporte como ganancia.
  const { data: flows } = await db
    .from('transactions')
    .select('kind, total')
    .eq('user_id', userId)
    .in('kind', ['deposit', 'withdrawal'])
    .gte('executed_at', `${today}T00:00:00-03:00`)
    .lte('executed_at', `${today}T23:59:59-03:00`)

  const netCashFlow = (flows ?? []).reduce(
    (sum, f) => sum + (f.kind === 'deposit' ? Number(f.total) : -Number(f.total)),
    0,
  )

  const snapshot = {
    user_id: userId,
    total_value: totalValue,
    daily_pnl: dailyPnl,
    net_cash_flow: netCashFlow,
      cedears_value: byType('CEDEAR'),
      fci_value: byType('FCI'),
      bonds_value: byType('BONO'),
      // El mismo `available` de arriba, no `cuenta.disponible`: un efectivo
      // negativo acá se propaga al rendimiento del período (que lo suma al
      // valor de la cartera) y a la detección de aportes por diferencia de
      // saldo, que lo compara contra el día anterior.
    cash_value: available,
    snapshot_date: today,
  }

  let { error: snapshotError } = await db
    .from('portfolio_snapshots')
    .upsert(snapshot, { onConflict: 'user_id,snapshot_date' })

  // Sin la 0027 no existen las columnas nuevas y PostgREST rechaza el upsert
  // entero. Perder el snapshot del día sería perder un punto del historial
  // para siempre, así que se guarda lo que sí entra.
  if (snapshotError) {
    const { daily_pnl: _p, net_cash_flow: _c, ...legacy } = snapshot
    const retry = await db
      .from('portfolio_snapshots')
      .upsert(legacy, { onConflict: 'user_id,snapshot_date' })
    snapshotError = retry.error
  }

  if (snapshotError) throw snapshotError

  await db
    .from('iol_credentials')
    .update({ last_sync_at: new Date().toISOString(), last_sync_error: null })
    .eq('user_id', userId)

  return { symbols: positions.length, totalValue }
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre

  // Dos caminos: el cron con la service role key sincroniza a todos, y el
  // pulldown de la app —con el JWT del usuario— sincroniza SOLO al que tira.
  // Sin el segundo, "deslizá para actualizar" solo releía la base: los datos
  // frescos de IOL llegaban recién con el próximo cron, hasta 5 minutos
  // después, y el gesto parecía no hacer nada.
  const fromCron = isServiceRole(req)
  const callerId = fromCron ? null : userIdFromJwt(req)
  if (!fromCron && !callerId) return unauthorized()

  const usersQuery = db.from('users').select('id')
  const { data: users, error } = await (callerId ? usersQuery.eq('id', callerId) : usersQuery)
  if (error) return jsonWithCors({ error: error.message }, { status: 500 })

  // Sondeo de stop loss / take profit: solo lectura, y contra la conexión de
  // quien llama. Corta antes de sincronizar porque no es una sincronización.
  if (new URL(req.url).searchParams.get('probe') === 'sltp') {
    // NO `users[0]`: con varios usuarios, el primero puede ser alguien que
    // nunca conectó IOL y el sondeo muere antes de probar nada. Es la misma
    // trampa que ya documenta fetch-market-quotes. Se busca por la columna
    // cifrada además de la vieja, que desde la 0019 queda en NULL.
    const { data: connected } = await db
      .from('iol_credentials')
      .select('user_id')
      .or('refresh_token_enc.not.is.null,refresh_token.not.is.null')
      .order('last_sync_at', { ascending: false, nullsFirst: false })
      .limit(1)

    const probeUserId = callerId ?? connected?.[0]?.user_id
    if (!probeUserId) {
      return jsonWithCors({ error: 'ninguna cuenta de IOL conectada' }, { status: 404 })
    }
    try {
      const token = await getAccessToken(db, probeUserId)
      return jsonWithCors({ ok: true, stopLoss: await probeStopLoss(token) })
    } catch (err) {
      return jsonWithCors(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 502 },
      )
    }
  }

  const results: Record<string, unknown> = {}

  for (const user of users ?? []) {
    try {
      results[user.id] = await syncUser(user.id)
    } catch (err) {
      // Todavía no conectó su cuenta: no es un error del sistema, es alguien a
      // mitad de la configuración. Se saltea sin ensuciar los logs.
      if (err instanceof NoConnectionError) {
        results[user.id] = { skipped: 'sin cuenta de IOL conectada' }
        continue
      }
      const message = err instanceof Error ? err.message : String(err)
      results[user.id] = { error: message }
      await db
        .from('iol_credentials')
        .upsert({ user_id: user.id, last_sync_error: message, updated_at: new Date().toISOString() })
      console.error(`[fetch-portfolio] ${user.id}:`, message)
    }
  }

  // El pulldown corta acá: lo que el usuario espera del gesto son SUS
  // posiciones y saldos frescos, y ya los tiene. Operaciones y alertas siguen
  // llegando por el cron, que corre a los pocos minutos.
  if (callerId) return jsonWithCors({ ok: true, results })

  // Encadenar el sync de operaciones con ventana corta. Es lo que hace que una
  // sugerencia cumplida desaparezca en minutos: si esperara a la corrida
  // diaria, el Dashboard seguiría diciéndote que compres algo que ya compraste.
  try {
    const res = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/fetch-transactions?recent=1`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          'Content-Type': 'application/json',
        },
      },
    )
    results.transactions = await res.json()
  } catch (err) {
    results.transactions = { error: err instanceof Error ? err.message : String(err) }
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

  return jsonWithCors({ ok: true, results })
})
