import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, EmptyState, SectionTitle } from '@/components/ui/Card'
import { AssetLogo } from '@/components/ui/AssetLogo'
import { PerformanceCard } from '@/components/history/PerformanceCard'
import { CashFlowForm } from '@/components/history/CashFlowForm'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { formatARS, formatSignedARS, toneOf, toneText } from '@/lib/format'
import type { PerformanceReview, Transaction } from '@/lib/types'

const KIND_LABEL: Record<string, { label: string; tone: string }> = {
  buy: { label: 'Compra', tone: 'text-gain' },
  sell: { label: 'Venta', tone: 'text-loss' },
  fci_subscription: { label: 'Suscripción', tone: 'text-gain' },
  fci_redemption: { label: 'Rescate', tone: 'text-loss' },
  dividend: { label: 'Dividendo', tone: 'text-accent' },
  deposit: { label: 'Aporte', tone: 'text-info' },
  withdrawal: { label: 'Retiro', tone: 'text-warning' },
}

/** Los que mueven plata pero no son operaciones de mercado */
const CASH_KINDS = new Set(['deposit', 'withdrawal'])

/**
 * Historial y rendimiento.
 *
 * Las operaciones vienen del endpoint `/operaciones` de IOL, que sí expone el
 * histórico (compras, ventas, FCI y dividendos). Lo que NO expone son los
 * depósitos y las extracciones: esos se cargan a mano, y son justamente los que
 * hacen que el rendimiento se pueda calcular sin mentir.
 */
export function History() {
  const { session } = useAuth()
  const [rows, setRows] = useState<Transaction[]>([])
  const [review, setReview] = useState<PerformanceReview | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!session) return

    const [{ data: transactions }, { data: reviews }] = await Promise.all([
      supabase
        .from('transactions')
        .select('*')
        .eq('user_id', session.user.id)
        .order('executed_at', { ascending: false })
        .limit(200),
      supabase
        .from('performance_reviews')
        .select('*')
        .eq('user_id', session.user.id)
        .order('period_end', { ascending: false })
        .limit(1),
    ])

    setRows((transactions ?? []) as Transaction[])
    setReview((reviews?.[0] ?? null) as PerformanceReview | null)
    setLoading(false)
  }, [session])

  useEffect(() => {
    void load()
  }, [load])

  const totals = useMemo(() => {
    // Los aportes y retiros quedan afuera: no son compras ni ventas, y
    // mezclarlos haría que "Neto" no signifique nada
    const trades = rows.filter((r) => !CASH_KINDS.has(r.kind ?? ''))
    const buys = trades.filter((r) => r.side === 'buy').reduce((s, r) => s + Number(r.total), 0)
    const sells = trades.filter((r) => r.side === 'sell').reduce((s, r) => s + Number(r.total), 0)
    return { buys, sells, net: sells - buys }
  }, [rows])

  function exportCsv() {
    const header = 'fecha,tipo,simbolo,cantidad,precio,total,moneda,descripcion'
    const lines = rows.map((r) =>
      [
        r.executed_at,
        r.kind ?? r.side,
        r.symbol ?? '',
        r.quantity,
        r.price,
        r.total,
        r.currency ?? 'ARS',
        // Las comillas se escapan duplicándolas, como manda CSV
        `"${(r.description ?? r.notes ?? '').replace(/"/g, '""')}"`,
      ].join(','),
    )
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `operaciones-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <div className="card h-40 animate-pulse" />

  return (
    <div className="animate-fade-up space-y-4">
      {review ? (
        <div>
          <SectionTitle icon="📊">¿Está funcionando?</SectionTitle>
          <PerformanceCard review={review} />
        </div>
      ) : (
        <Card>
          <p className="text-primary text-[14px] font-semibold">Todavía sin revisión</p>
          <p className="text-secondary mt-1.5 text-[12px] leading-relaxed">
            La revisión de rendimiento compara tu cartera contra el dólar MEP y contra no haber
            hecho nada. Necesita al menos dos días de snapshots para tener contra qué comparar.
          </p>
        </Card>
      )}

      {rows.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <p className="text-secondary text-[12px]">Compras</p>
            <p className="font-display tnum text-primary mt-1 text-[16px] font-semibold">
              {formatARS(totals.buys)}
            </p>
          </Card>
          <Card>
            <p className="text-secondary text-[12px]">Ventas</p>
            <p className="font-display tnum text-primary mt-1 text-[16px] font-semibold">
              {formatARS(totals.sells)}
            </p>
          </Card>
          <Card>
            <p className="text-secondary text-[12px]">Neto</p>
            <p
              className={`font-display tnum mt-1 text-[16px] font-semibold ${toneText[toneOf(totals.net)]}`}
            >
              {formatSignedARS(totals.net)}
            </p>
          </Card>
        </div>
      )}

      <CashFlowForm onSaved={() => void load()} />

      {rows.length === 0 ? (
        <EmptyState
          icon="🧾"
          title="Sin operaciones registradas"
          description="Tus compras y ventas se traen de IOL una vez por día, al cierre. Si acabás de conectar la cuenta, mañana las vas a ver acá."
        />
      ) : (
        <div>
          <SectionTitle icon="🧾">Movimientos</SectionTitle>
          <Card className="p-0">
            <ul>
              {rows.map((row) => {
                const kind = KIND_LABEL[row.kind ?? row.side] ?? {
                  label: row.kind ?? row.side,
                  tone: 'text-secondary',
                }
                const isCash = CASH_KINDS.has(row.kind ?? '')

                return (
                  <li
                    key={row.id}
                    className="border-subtle flex items-center gap-3 border-b px-4 py-3.5 last:border-b-0"
                  >
                    {isCash || !row.symbol ? (
                      <span className="bg-elevated flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px]">
                        {row.kind === 'deposit' ? '↓' : row.kind === 'withdrawal' ? '↑' : '•'}
                      </span>
                    ) : (
                      <AssetLogo symbol={row.symbol} />
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="text-primary flex items-center gap-2 text-[14px] font-semibold">
                        <span className={kind.tone}>{kind.label}</span>
                        {row.symbol}
                      </p>
                      <p className="text-muted tnum mt-0.5 truncate text-[12px]">
                        {row.quantity > 0 && `${row.quantity} × ${formatARS(row.price)} · `}
                        {new Date(row.executed_at).toLocaleDateString('es-AR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: '2-digit',
                        })}
                      </p>
                    </div>

                    <span className="tnum text-primary shrink-0 text-[13px] font-semibold">
                      {row.currency === 'USD'
                        ? `US$ ${Number(row.total).toFixed(2)}`
                        : formatARS(Number(row.total))}
                    </span>
                  </li>
                )
              })}
            </ul>
          </Card>
        </div>
      )}

      {rows.length > 0 && (
        <button
          type="button"
          onClick={exportCsv}
          className="border-line text-secondary active:bg-hover w-full rounded-xl border py-2.5 text-[13px]"
        >
          Exportar a CSV
        </button>
      )}
    </div>
  )
}
