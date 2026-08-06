import { createContext, createElement, useContext, useMemo, useState, type ReactNode } from 'react'

export type Currency = 'ARS' | 'USD'

const STORAGE_KEY = 'iol-currency'

type CurrencyState = {
  currency: Currency
  setCurrency: (c: Currency) => void
  /** Cotización MEP de venta, o null si todavía no sincronizó */
  mep: number | null
  /** Convierte un monto en pesos a la moneda elegida */
  convert: (ars: number) => number
  /** Formatea ya convertido, con el símbolo que corresponda */
  format: (ars: number, withCents?: boolean) => string
  /** false cuando no hay cotización: el toggle se deshabilita en vez de mentir */
  canSwitch: boolean
}

const CurrencyContext = createContext<CurrencyState | null>(null)

const arsFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})
const arsCents = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const usdFmt = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function CurrencyProvider({ mep, children }: { mep: number | null; children: ReactNode }) {
  const [currency, setCurrencyState] = useState<Currency>(() =>
    localStorage.getItem(STORAGE_KEY) === 'USD' ? 'USD' : 'ARS',
  )

  const value = useMemo<CurrencyState>(() => {
    // Sin cotización no se puede convertir. Antes que inventar un tipo de
    // cambio o dividir por cero, se fuerza pesos y se apaga el toggle.
    const canSwitch = mep != null && mep > 0
    const active: Currency = canSwitch ? currency : 'ARS'

    const convert = (ars: number) => (active === 'USD' && canSwitch ? ars / mep! : ars)

    return {
      currency: active,
      canSwitch,
      mep,
      convert,
      setCurrency: (c) => {
        localStorage.setItem(STORAGE_KEY, c)
        setCurrencyState(c)
      },
      format: (ars, withCents = false) => {
        if (active === 'USD' && canSwitch) return `US$ ${usdFmt.format(ars / mep!)}`
        return (withCents ? arsCents : arsFmt).format(ars)
      },
    }
  }, [currency, mep])

  return createElement(CurrencyContext.Provider, { value }, children)
}

export function useCurrency(): CurrencyState {
  const ctx = useContext(CurrencyContext)
  if (!ctx) throw new Error('useCurrency debe usarse dentro de <CurrencyProvider>')
  return ctx
}
