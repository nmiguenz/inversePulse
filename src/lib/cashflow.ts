import { supabase } from '@/lib/supabase'

export type CashFlowKind = 'deposit' | 'withdrawal'

/**
 * Registra un aporte o un retiro.
 *
 * IOL no expone los depósitos ni las extracciones por su API: probamos seis
 * rutas distintas y todas devuelven el mismo error genérico. La app los detecta
 * comparando el efectivo contra lo que explican las operaciones, pero necesita
 * que el usuario confirme qué fueron.
 *
 * Sin este dato el rendimiento sale mal, y mal para el lado que engaña: un
 * aporte sin registrar se ve como ganancia.
 *
 * Vive acá y no dentro de un componente porque hay tres lugares que lo cargan
 * —el header, la alerta y el historial— y son el mismo hecho: no puede haber
 * tres versiones de cómo se guarda.
 */
export async function saveCashFlow(params: {
  userId: string
  kind: CashFlowKind
  /** En pesos, siempre positivo. El signo lo da `kind`. */
  amount: number
  /** YYYY-MM-DD */
  date: string
  note?: string
}): Promise<void> {
  const { userId, kind, amount, date, note } = params

  const { error } = await supabase.from('transactions').insert({
    user_id: userId,
    // Sin external_id de IOL: el índice único es parcial y solo aplica a las
    // filas que vienen del sync, así que estas no chocan entre sí.
    external_id: `manual-${kind}-${date}-${amount}`,
    kind,
    side: kind === 'deposit' ? 'buy' : 'sell',
    symbol: null,
    quantity: 0,
    price: 0,
    total: amount,
    currency: 'ARS',
    description:
      note?.trim() || (kind === 'deposit' ? 'Aporte (carga manual)' : 'Retiro (carga manual)'),
    executed_at: `${date}T12:00:00-03:00`,
  })

  if (error) throw error
}

/** Hoy en formato YYYY-MM-DD, en la zona del dispositivo. */
export function todayISO(): string {
  return new Date().toLocaleDateString('en-CA')
}
