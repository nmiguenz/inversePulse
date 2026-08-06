import { useCallback, useEffect, useState } from 'react'
import { AssetLogo } from '@/components/ui/AssetLogo'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { formatARS } from '@/lib/format'
import type { Transaction } from '@/lib/types'

/** Cuántos días hacia atrás mirar. Más que esto deja de ser "reciente". */
const WINDOW_DAYS = 45

/**
 * Compras recientes que todavía no están apartadas para ninguna meta.
 *
 * Cierra el circuito que pediste: comprás en IOL, el sync diario lo trae a
 * `transactions`, y acá lo asignás con un toque. No hay carga manual ni hay que
 * acordarse de la cantidad.
 *
 * Se muestran las compras cuyo símbolo tiene unidades libres — si ya apartaste
 * todo lo que tenés de ese activo, la compra deja de aparecer.
 */
export function UnassignedPurchases({
  assignedBySymbol,
  heldBySymbol,
  onAssign,
}: {
  /** Cuánto hay apartado de cada símbolo, sumando TODAS las metas */
  assignedBySymbol: Map<string, number>
  /** Cuánto tenés de cada símbolo */
  heldBySymbol: Map<string, number>
  onAssign: (symbol: string, quantity: number) => Promise<{ error: string | null }>
}) {
  const { session } = useAuth()
  const [purchases, setPurchases] = useState<Transaction[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!session) return
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString()

    const { data } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', session.user.id)
      .in('kind', ['buy', 'fci_subscription'])
      .gte('executed_at', since)
      .order('executed_at', { ascending: false })
      .limit(20)

    setPurchases((data ?? []) as Transaction[])
  }, [session])

  useEffect(() => {
    void load()
  }, [load])

  // Lo que queda libre de cada símbolo: lo que tenés menos lo ya apartado
  const free = (symbol: string) =>
    Math.max(0, (heldBySymbol.get(symbol) ?? 0) - (assignedBySymbol.get(symbol) ?? 0))

  const pending = purchases.filter((p) => p.symbol && p.quantity > 0 && free(p.symbol) > 0)

  if (!pending.length) return null

  async function assign(t: Transaction) {
    if (!t.symbol) return
    setBusy(t.id)
    setError('')

    // Nunca más de lo que queda libre: si compraste 10 pero ya apartaste 8 en
    // otra meta, se asignan 2 y el trigger de la base no rechaza
    const quantity = Math.min(t.quantity, free(t.symbol))
    const alreadyHere = assignedBySymbol.get(t.symbol) ?? 0

    const { error: assignError } = await onAssign(t.symbol, alreadyHere + quantity)
    if (assignError) setError(assignError)
    setBusy(null)
  }

  return (
    <div className="border-subtle mt-4 border-t pt-4">
      <p className="text-primary text-[13px] font-semibold">Compras recientes sin apartar</p>
      <p className="text-muted mt-0.5 text-[11px] leading-relaxed">
        Vienen del sync con IOL. Tocá para apartarlas a esta meta.
      </p>

      <ul className="mt-2.5 space-y-2">
        {pending.map((t) => (
          <li key={t.id} className="flex items-center gap-2.5">
            <AssetLogo symbol={t.symbol!} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="text-primary truncate text-[13px] font-semibold">{t.symbol}</p>
              <p className="text-muted tnum text-[11px]">
                {t.quantity} × {formatARS(t.price)} ·{' '}
                {new Date(t.executed_at).toLocaleDateString('es-AR', {
                  day: '2-digit',
                  month: '2-digit',
                })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void assign(t)}
              disabled={busy === t.id}
              className="border-accent text-accent shrink-0 rounded-lg border px-3 py-1.5 text-[12px] font-medium disabled:opacity-50"
            >
              {busy === t.id ? '…' : 'Apartar'}
            </button>
          </li>
        ))}
      </ul>

      {error && <p className="text-loss mt-2 text-[12px] leading-relaxed">{error}</p>}
    </div>
  )
}
