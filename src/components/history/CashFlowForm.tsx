import { useState } from 'react'
import { CashFlowModal } from '@/components/cashflow/CashFlowModal'

/**
 * Botón de carga manual de aportes y retiros en el Historial.
 *
 * El formulario en sí vive en `CashFlowModal`, compartido con los botones del
 * header y con la alerta "¿Ingresaste $X?". Antes esto tenía su propio
 * formulario y su propio INSERT: dos copias del mismo hecho que se iban a
 * desincronizar en cuanto una cambiara.
 */
export function CashFlowForm({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-line text-secondary active:bg-hover w-full rounded-xl border py-2.5 text-[13px]"
      >
        Registrar un aporte o retiro
      </button>

      <CashFlowModal open={open} onClose={() => setOpen(false)} onSaved={onSaved} />
    </>
  )
}
