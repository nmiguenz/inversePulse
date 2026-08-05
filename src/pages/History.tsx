import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, EmptyState, SectionTitle } from '@/components/ui/Card'
import { AssetLogo } from '@/components/ui/AssetLogo'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { formatARS, formatSignedARS, toneOf, toneText } from '@/lib/format'

type Transaction = {
  id: string
  symbol: string
  side: string
  quantity: number
  price: number
  total: number
  notes: string | null
  executed_at: string
}

/**
 * Historial de operaciones.
 *
 * IOL no expone las operaciones históricas por la API que usamos, así que esta
 * tabla se llena con lo que cargues a mano o con lo que registremos cuando se
 * opere desde la app. Es la base para calcular resultados realizados.
 */
export function History() {
  const { session } = useAuth()
  const [rows, setRows] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!session) return
    const { data } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', session.user.id)
      .order('executed_at', { ascending: false })
      .limit(200)
    setRows((data ?? []) as Transaction[])
    setLoading(false)
  }, [session])

  useEffect(() => {
    void load()
  }, [load])

  const totals = useMemo(() => {
    const buys = rows.filter((r) => r.side === 'buy').reduce((s, r) => s + Number(r.total), 0)
    const sells = rows.filter((r) => r.side === 'sell').reduce((s, r) => s + Number(r.total), 0)
    return { buys, sells, net: sells - buys }
  }, [rows])

  function exportCsv() {
    const header = 'fecha,simbolo,operacion,cantidad,precio,total,notas'
    const lines = rows.map((r) =>
      [
        r.executed_at,
        r.symbol,
        r.side,
        r.quantity,
        r.price,
        r.total,
        // Las comillas del campo notas se escapan duplicándolas, como manda CSV
        `"${(r.notes ?? '').replace(/"/g, '""')}"`,
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

  if (loading) {
    return <div className="card h-40 animate-pulse" />
  }

  if (!rows.length) {
    return (
      <div className="animate-fade-up">
        <EmptyState
          icon="🧾"
          title="Sin operaciones registradas"
          description="La API de IOL que usamos no expone el histórico de operaciones. Esta pantalla se llena con lo que cargues a mano o con lo que se registre al operar desde la app."
        />
      </div>
    )
  }

  return (
    <div className="animate-fade-up space-y-4">
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
          <p className={`font-display tnum mt-1 text-[16px] font-semibold ${toneText[toneOf(totals.net)]}`}>
            {formatSignedARS(totals.net)}
          </p>
        </Card>
      </div>

      <div>
        <SectionTitle icon="🧾">Operaciones</SectionTitle>
        <Card className="p-0">
          <ul>
            {rows.map((row) => (
              <li
                key={row.id}
                className="border-subtle flex items-center gap-3 border-b px-5 py-3.5 last:border-b-0"
              >
                <AssetLogo symbol={row.symbol} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-primary flex items-center gap-2 text-[14px] font-semibold">
                    <span className={row.side === 'buy' ? 'text-gain' : 'text-loss'}>
                      {row.side === 'buy' ? 'Compra' : 'Venta'}
                    </span>
                    {row.symbol}
                  </p>
                  <p className="text-muted tnum mt-0.5 text-[12px]">
                    {row.quantity} × {formatARS(row.price)} ·{' '}
                    {new Date(row.executed_at).toLocaleDateString('es-AR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: '2-digit',
                    })}
                  </p>
                </div>
                <span className="tnum text-primary text-[13px] font-semibold">
                  {formatARS(Number(row.total))}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <button
        type="button"
        onClick={exportCsv}
        className="border-line text-secondary active:bg-hover w-full rounded-xl border py-2.5 text-[13px]"
      >
        Exportar a CSV
      </button>
    </div>
  )
}
