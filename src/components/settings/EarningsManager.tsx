import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { usePortfolio } from '@/hooks/usePortfolio'
import { missingEarnings, missingEarningsTitle, reportsEarnings } from '@/lib/earnings'

type Earnings = {
  id: string
  symbol: string
  report_date: string
  time_of_day: string | null
  is_reported: boolean
}

const TIME_LABEL: Record<string, string> = {
  before_open: 'antes de apertura',
  after_close: 'después del cierre',
}

/**
 * Carga manual del calendario de earnings.
 *
 * No hay fuente gratuita confiable de estas fechas, y una fecha inventada
 * dispararía un recordatorio falso sobre una posición real. Se cargan a mano:
 * para 6 CEDEARs son 4 veces al año. Las fechas salen del sitio de investor
 * relations de cada empresa o de la ficha del CEDEAR en la app de IOL.
 */
export function EarningsManager() {
  const { positions } = usePortfolio()
  const [rows, setRows] = useState<Earnings[]>([])
  const [symbol, setSymbol] = useState('')
  const [date, setDate] = useState('')
  const [timeOfDay, setTimeOfDay] = useState('after_close')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Solo tiene sentido cargar earnings de lo que tenés
  const symbols = positions.filter((p) => reportsEarnings(p.asset_type)).map((p) => p.symbol)

  const load = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10)
    const { data } = await supabase
      .from('earnings_calendar')
      .select('id, symbol, report_date, time_of_day, is_reported')
      .gte('report_date', today)
      .order('report_date')
      .limit(30)
    setRows((data ?? []) as Earnings[])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!symbol || !date) return

    setSaving(true)
    setError('')

    const { error: insertError } = await supabase
      .from('earnings_calendar')
      .upsert({ symbol, report_date: date, time_of_day: timeOfDay }, { onConflict: 'symbol,report_date' })

    if (insertError) setError(insertError.message)
    else {
      setDate('')
      await load()
    }
    setSaving(false)
  }

  async function remove(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id))
    await supabase.from('earnings_calendar').delete().eq('id', id)
  }

  // La misma regla que evalúa la alerta, mostrada acá para poder resolverla.
  // `rows` ya viene filtrado a report_date >= hoy.
  const missing = missingEarnings(positions, rows)

  return (
    <div>
      {missing.length > 0 && (
        <div className="bg-warning-soft mb-3 rounded-xl px-3.5 py-3">
          <p className="text-primary text-[13px] font-medium">
            {missingEarningsTitle(missing)}
          </p>
          <p className="text-secondary mt-1 text-[12px] leading-relaxed">
            Sin fecha cargada no hay aviso antes del reporte:{' '}
            <span className="font-mono">{missing.join(', ')}</span>
          </p>
        </div>
      )}

      <form onSubmit={add} className="space-y-2">
        <div className="flex gap-2">
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            required
            className="border-line bg-elevated text-primary flex-1 rounded-xl border px-3 py-2.5 font-mono text-[13px] outline-none"
          >
            <option value="">Activo…</option>
            {symbols.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className="border-line bg-elevated text-primary flex-1 rounded-xl border px-3 py-2.5 text-[13px] outline-none"
          />
        </div>

        <div className="flex gap-2">
          <select
            value={timeOfDay}
            onChange={(e) => setTimeOfDay(e.target.value)}
            className="border-line bg-elevated text-secondary flex-1 rounded-xl border px-3 py-2.5 text-[13px] outline-none"
          >
            <option value="after_close">Después del cierre</option>
            <option value="before_open">Antes de la apertura</option>
          </select>
          <button
            type="submit"
            disabled={saving || !symbol || !date}
            className="gradient-accent rounded-xl px-5 text-[13px] font-medium text-white disabled:opacity-40"
          >
            {saving ? '…' : 'Agregar'}
          </button>
        </div>

        {error && <p className="text-loss text-[12px]">{error}</p>}
      </form>

      {rows.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="border-subtle flex items-center gap-3 border-t pt-2">
              <span className="font-mono text-[13px] font-semibold">{row.symbol}</span>
              <span className="text-secondary tnum font-mono text-[12px]">
                {new Date(`${row.report_date}T12:00:00`).toLocaleDateString('es-AR', {
                  day: '2-digit',
                  month: 'short',
                })}
              </span>
              <span className="text-muted text-[11px]">
                {TIME_LABEL[row.time_of_day ?? ''] ?? ''}
              </span>
              <button
                type="button"
                onClick={() => void remove(row.id)}
                className="text-muted active:text-loss ml-auto px-2 text-[16px] leading-none"
                aria-label={`Borrar ${row.symbol}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted mt-3 text-[12px] leading-relaxed">
          Sin fechas cargadas. Las encontrás en el sitio de investor relations de cada empresa o en
          la ficha del CEDEAR en IOL. El recordatorio te avisa 3 días antes.
        </p>
      )}
    </div>
  )
}
