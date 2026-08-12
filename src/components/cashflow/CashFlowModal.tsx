import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '@/lib/auth'
import { saveCashFlow, todayISO, type CashFlowKind } from '@/lib/cashflow'

/**
 * Alta de un aporte o retiro, en un modal.
 *
 * Se abre desde tres lugares —los botones del header, la alerta "¿Ingresaste
 * $X?" y el Historial— porque son el mismo hecho visto desde distintos
 * momentos. Los tres comparten este componente para que no haya tres
 * formularios que se desincronicen.
 */
export function CashFlowModal({
  open,
  onClose,
  onSaved,
  initialKind = 'deposit',
  initialAmount,
}: {
  open: boolean
  onClose: () => void
  onSaved?: () => void
  initialKind?: CashFlowKind
  /** Prellenado cuando viene de la alerta, que ya detectó el monto. */
  initialAmount?: number | null
}) {
  const { session } = useAuth()
  const [kind, setKind] = useState<CashFlowKind>(initialKind)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const amountRef = useRef<HTMLInputElement>(null)

  // Al abrir se reinicia con lo que venga de afuera: si no, el modal recuerda
  // lo que se tipeó la vez anterior y un retiro se carga como aporte.
  useEffect(() => {
    if (!open) return
    setKind(initialKind)
    setAmount(initialAmount ? String(Math.round(initialAmount)) : '')
    setDate(todayISO())
    setNote('')
    setError('')
    // Sin foco automático en el monto hay que tocar dos veces para escribir
    const id = setTimeout(() => amountRef.current?.focus(), 60)
    return () => clearTimeout(id)
  }, [open, initialKind, initialAmount])

  // Escape cierra, como en cualquier modal. Sin esto la única salida en
  // escritorio es apuntar al botón.
  //
  // Y se traba el scroll del fondo: si no, deslizar dentro del modal arrastra
  // la página de atrás y el modal parece irse solo.
  useEffect(() => {
    if (!open) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)

    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open, onClose])

  if (!open) return null

  async function submit(e: FormEvent) {
    e.preventDefault()
    const value = Number(amount)

    if (!session || !value || value <= 0) {
      setError('Poné un monto mayor a cero')
      return
    }

    setSaving(true)
    setError('')

    try {
      await saveCashFlow({ userId: session.user.id, kind, amount: value, date, note })
      onSaved?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  /**
   * Va por portal a <body>, y no es un detalle estético.
   *
   * `position: fixed` se resuelve contra la pantalla SALVO que algún ancestro
   * tenga `transform`, `filter` o `backdrop-filter` distinto de `none`: ese
   * ancestro pasa a ser el bloque contenedor. Los dos lugares que abren este
   * modal caen justo ahí — el header tiene `backdrop-blur-xl` y la tarjeta de
   * alerta tiene un `translateX` para el gesto de deslizar. El modal quedaba
   * anclado a la barra de 56px y se iba de la pantalla.
   *
   * Sacándolo del árbol el problema no puede volver, venga de donde venga.
   */
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center overflow-y-auto bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Registrar aporte o retiro"
      // React propaga los eventos por el árbol de COMPONENTES, no por el DOM,
      // así que un portal no corta el burbujeo: sin esto, cerrar tocando el
      // fondo también dispara el onClick de la tarjeta de alerta que lo abrió.
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
    >
      {/* Hoja desde abajo en celular, caja centrada en escritorio: el pulgar
          llega al borde inferior, el mouse al centro.

          `max-h` + scroll propio para cuando el teclado del celular se come
          media pantalla: sin eso, el botón de Guardar queda tapado y no hay
          forma de llegar a él. */}
      <div
        className="bg-surface border-line my-auto max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border p-5 sm:rounded-2xl"
        style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-primary text-[15px] font-semibold">
              {kind === 'deposit' ? 'Registrar un aporte' : 'Registrar un retiro'}
            </h2>
            <p className="text-muted mt-0.5 text-[11px] leading-relaxed">
              IOL no publica los movimientos de dinero. Registrarlos es lo que evita que un aporte
              se cuente como ganancia.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="text-muted active:text-primary -mt-1 shrink-0 px-1 text-[18px] leading-none"
          >
            ×
          </button>
        </header>

        <form onSubmit={submit} className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            {(['deposit', 'withdrawal'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`rounded-xl border py-2.5 text-[13px] transition-colors ${
                  kind === k
                    ? k === 'deposit'
                      ? 'border-gain-line bg-gain-soft text-gain font-medium'
                      : 'border-loss-line bg-loss-soft text-loss font-medium'
                    : 'border-line text-secondary'
                }`}
              >
                {k === 'deposit' ? 'Ingresé plata' : 'Retiré plata'}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              ref={amountRef}
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

          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Nota (opcional)"
            className="border-line bg-elevated text-primary w-full rounded-xl border px-3 py-2.5 text-[13px] outline-none"
          />

          {error && <p className="text-loss text-[12px]">{error}</p>}

          <button
            type="submit"
            disabled={saving}
            className="gradient-accent w-full rounded-xl py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </form>
      </div>
    </div>,
    document.body,
  )
}
