import { useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'

/**
 * Carga manual de aportes y retiros.
 *
 * IOL no expone los depósitos ni las extracciones por su API: probamos seis
 * rutas distintas y todas devuelven el mismo error genérico. La app los detecta
 * comparando el efectivo contra lo que explican las operaciones, pero necesita
 * que le confirmes qué fueron.
 *
 * Sin este dato el rendimiento del período sale mal, y mal para el lado que
 * engaña: un aporte sin registrar se ve como ganancia.
 */
export function CashFlowForm({ onSaved }: { onSaved: () => void }) {
  const { session } = useAuth()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<'deposit' | 'withdrawal'>('deposit')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(() => new Date().toLocaleDateString('en-CA'))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    const value = Number(amount)
    if (!session || !value || value <= 0) {
      setError('Poné un monto mayor a cero')
      return
    }

    setSaving(true)
    setError('')

    const { error: insertError } = await supabase.from('transactions').insert({
      user_id: session.user.id,
      // Sin external_id de IOL: el índice único es parcial y solo aplica a las
      // filas que vienen del sync, así que estas no chocan entre sí.
      external_id: `manual-${kind}-${date}-${value}`,
      kind,
      side: kind === 'deposit' ? 'buy' : 'sell',
      symbol: null,
      quantity: 0,
      price: 0,
      total: value,
      currency: 'ARS',
      description: kind === 'deposit' ? 'Aporte (carga manual)' : 'Retiro (carga manual)',
      executed_at: `${date}T12:00:00-03:00`,
    })

    if (insertError) {
      setError(insertError.message)
    } else {
      setAmount('')
      setOpen(false)
      onSaved()
    }
    setSaving(false)
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-line text-secondary active:bg-hover w-full rounded-xl border py-2.5 text-[13px]"
      >
        Registrar un aporte o retiro
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="card space-y-2.5 p-4">
      <p className="text-secondary text-[12px] leading-relaxed">
        IOL no publica los movimientos de dinero por API. Registrarlos acá es lo que permite que el
        rendimiento no cuente tus aportes como ganancia.
      </p>

      <div className="grid grid-cols-2 gap-2">
        {(['deposit', 'withdrawal'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`rounded-xl border py-2.5 text-[13px] transition-colors ${
              kind === k
                ? 'border-accent text-primary bg-accent-soft font-medium'
                : 'border-line text-secondary'
            }`}
          >
            {k === 'deposit' ? 'Aporte' : 'Retiro'}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Monto en pesos"
          required
          className="border-line bg-elevated text-primary tnum flex-1 rounded-xl border px-3 py-2.5 text-[13px] outline-none"
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
          className="border-line bg-elevated text-primary rounded-xl border px-3 py-2.5 text-[13px] outline-none"
        />
      </div>

      {error && <p className="text-loss text-[12px]">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="bg-accent flex-1 rounded-xl py-2.5 text-[13px] font-medium text-white disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="border-line text-secondary rounded-xl border px-4 py-2.5 text-[13px]"
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}
