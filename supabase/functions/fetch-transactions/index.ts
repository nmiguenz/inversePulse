/**
 * fetch-transactions — diaria
 *
 * Registra en `transactions` lo que pasó en la cuenta: compras, ventas,
 * suscripciones y rescates de FCI, y dividendos. Hasta ahora la tabla existía
 * desde 0001 y nunca se había escrito, por eso la pantalla de Historial estaba
 * vacía.
 *
 * ── Por qué los aportes y retiros van por otro lado ──────────────────────
 *
 * `/api/v2/operaciones` trae las operaciones, pero NO los depósitos ni las
 * extracciones. Probé seis rutas distintas para los movimientos de dinero
 * (`/cuentas-bancarias/movimientos` en GET y POST con cuatro bodies,
 * `/estadocuenta/movimientos`, `/micuenta/movimientos`, `/Cuenta/Movimientos`)
 * y todas devuelven el mismo "Runtime Error" 500 de ASP.NET — el mismo que
 * devuelve una ruta inventada, así que no es un problema de parámetros: esos
 * endpoints no están en esta API.
 *
 * Sin aportes ni retiros el rendimiento es indefendible: un depósito de
 * $1.400.000 se ve igual que haber ganado $1.400.000. La solución es
 * DETECTARLOS y PREGUNTAR, no inventarlos: se compara el efectivo de hoy
 * contra el de ayer descontando lo que explican las operaciones, y si queda un
 * resto grande se crea una alerta para que lo clasifiques. Inferirlo en
 * silencio sería meter un número inventado en el cálculo que justamente
 * intenta ser honesto.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAccessToken, iol, type IolOperacion } from '../_shared/iol.ts'
import { isServiceRole, unauthorized } from '../_shared/auth.ts'

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

/** Cuántos días hacia atrás mirar en cada corrida. */
const LOOKBACK_DAYS = 120

/**
 * Debajo de esto, un descalce de efectivo se explica por comisiones y
 * derechos de mercado, no por un aporte. En la compra de GOOGL la diferencia
 * entre el monto operado ($9.825) y lo que salió de la cuenta ($9.890,39) fue
 * de $65 — el umbral tiene que dejar pasar eso sin llamarlo movimiento.
 */
const CASH_NOISE_THRESHOLD = 5000

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
}

function todayBA(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
}

/**
 * Traduce el tipo de operación de IOL a nuestro `kind`.
 * Lo que no se sabe clasificar queda con `kind` en null y el texto original en
 * `description`, en vez de forzarlo a una categoría equivocada.
 */
function toKind(tipo: string | undefined): string | null {
  const t = (tipo ?? '').toLowerCase()
  if (t.includes('compra')) return 'buy'
  if (t.includes('venta')) return 'sell'
  if (t.includes('suscrip')) return 'fci_subscription'
  if (t.includes('rescate')) return 'fci_redemption'
  if (t.includes('dividendo')) return 'dividend'
  return null
}

/** Solo lo efectivamente ejecutado. Una orden cancelada no movió plata. */
function isSettled(estado: string | undefined): boolean {
  return (estado ?? '').toLowerCase().includes('termin')
}

/**
 * Mapea una operación de IOL.
 *
 * Cuidado con los campos: verifiqué contra datos reales que en una orden a
 * precio de mercado `cantidad` trae el MONTO en pesos (10813) y no la cantidad
 * de papeles. La cantidad real está en `cantidadOperada` (1). Por eso se leen
 * primero los campos "Operada", que son los de la ejecución.
 */
function mapOperacion(userId: string, op: IolOperacion) {
  const kind = toKind(op.tipo)
  const quantity = op.cantidadOperada ?? 0
  const price = op.precioOperado ?? 0
  const total = op.montoOperado ?? quantity * price

  return {
    user_id: userId,
    external_id: String(op.numero),
    kind,
    // `side` se mantiene por la pantalla de Historial, que ya lo usaba
    side: kind === 'sell' || kind === 'fci_redemption' ? 'sell' : 'buy',
    symbol: op.simbolo ?? null,
    quantity,
    price,
    // No incluye comisiones ni derechos de mercado: IOL no los desglosa acá.
    total,
    currency: op.moneda?.toLowerCase().includes('dolar') ? 'USD' : 'ARS',
    description: op.descripcion ?? op.tipo ?? null,
    executed_at: op.fechaOperada ?? op.fechaOrden ?? new Date().toISOString(),
  }
}

/**
 * Busca movimientos de dinero sin explicar.
 *
 * efectivo_hoy − efectivo_ayer debería ser igual a lo que aportaron las
 * operaciones del día. Lo que sobra es un depósito o una extracción.
 *
 * Devuelve el resto para que se pregunte, no para darlo por hecho.
 */
async function detectUnexplainedCash(userId: string): Promise<number | null> {
  const { data: snapshots } = await db
    .from('portfolio_snapshots')
    .select('cash_value, snapshot_date')
    .eq('user_id', userId)
    .order('snapshot_date', { ascending: false })
    .limit(2)

  // Con un solo snapshot no hay contra qué comparar
  if (!snapshots || snapshots.length < 2) return null

  const [today, yesterday] = snapshots
  const cashDelta = (today.cash_value ?? 0) - (yesterday.cash_value ?? 0)

  const { data: trades } = await db
    .from('transactions')
    .select('kind, total')
    .eq('user_id', userId)
    .eq('currency', 'ARS')
    .gt('executed_at', `${yesterday.snapshot_date}T00:00:00-03:00`)
    .lte('executed_at', `${today.snapshot_date}T23:59:59-03:00`)

  // Las compras y suscripciones sacan efectivo; las ventas, rescates y
  // dividendos lo agregan.
  const explained = (trades ?? []).reduce((sum, t) => {
    const amount = t.total ?? 0
    if (t.kind === 'buy' || t.kind === 'fci_subscription') return sum - amount
    if (t.kind === 'sell' || t.kind === 'fci_redemption' || t.kind === 'dividend') {
      return sum + amount
    }
    return sum
  }, 0)

  const residual = cashDelta - explained
  return Math.abs(residual) > CASH_NOISE_THRESHOLD ? residual : null
}

async function syncUser(userId: string) {
  const token = await getAccessToken(db, userId)
  const operaciones = await iol.operaciones(token, daysAgo(LOOKBACK_DAYS), todayBA())

  const rows = (operaciones ?? [])
    .filter((op) => isSettled(op.estado) && op.numero != null)
    .map((op) => mapOperacion(userId, op))

  if (rows.length) {
    // onConflict sobre (user_id, external_id): re-sincronizar actualiza en vez
    // de duplicar. Es lo que permite correr esto todos los días.
    const { error } = await db
      .from('transactions')
      .upsert(rows, { onConflict: 'user_id,external_id' })
    if (error) throw error
  }

  // ── Movimiento de dinero sin explicar ────────────────────────────────
  const residual = await detectUnexplainedCash(userId)
  let asked = false

  if (residual !== null) {
    const isDeposit = residual > 0
    const amount = Math.abs(residual).toLocaleString('es-AR', { maximumFractionDigits: 0 })
    const today = todayBA()

    // Una por día: si ya se preguntó, no se vuelve a preguntar
    const { data: existing } = await db
      .from('alerts')
      .select('id')
      .eq('user_id', userId)
      .eq('alert_type', 'cash_flow_review')
      .gte('created_at', `${today}T00:00:00-03:00`)
      .limit(1)

    if (!(existing ?? []).length) {
      await db.from('alerts').insert({
        user_id: userId,
        alert_type: 'cash_flow_review',
        title: isDeposit ? `¿Ingresaste $${amount}?` : `¿Retiraste $${amount}?`,
        message:
          `El efectivo de la cuenta cambió $${amount} más de lo que explican tus operaciones. ` +
          `IOL no publica los depósitos y extracciones por API, así que necesito que lo ` +
          `confirmes: sin este dato el rendimiento del período sale mal, porque un aporte ` +
          `parece una ganancia.`,
        severity: 'info',
        action_suggested: 'Registrarlo en Historial',
      })
      asked = true
    }
  }

  return { operations: rows.length, unexplainedCash: residual, asked }
}

Deno.serve(async (req) => {
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
      console.error(`[fetch-transactions] ${user.id}:`, message)
    }
  }

  return Response.json({ ok: true, results })
})
