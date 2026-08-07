import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { setAmountsHidden } from '@/lib/format'

const STORAGE_KEY = 'inversepulse:amounts-hidden'

type PrivacyState = {
  hidden: boolean
  toggle: () => void
}

const PrivacyContext = createContext<PrivacyState>({ hidden: false, toggle: () => {} })

/**
 * Modo privado: oculta todos los montos detrás de ***.
 *
 * Sirve para mirar la app en el colectivo o compartir pantalla sin exponer
 * cuánta plata tenés. La preferencia se guarda en localStorage, así que
 * sobrevive al refresh — si al volver a abrir la app los números aparecieran
 * de nuevo, la función no serviría para nada.
 *
 * El estado real vive en `format.ts` a nivel de módulo, porque las funciones de
 * formato son puras y se usan desde todos lados. Este provider lo sincroniza y
 * fuerza el re-render.
 */
export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      // Modo incógnito o storage bloqueado: arranca visible
      return false
    }
  })

  // Se aplica ANTES del primer render de los hijos para que no lleguen a
  // mostrarse los montos por un frame
  setAmountsHidden(hidden)

  useEffect(() => {
    setAmountsHidden(hidden)
    try {
      localStorage.setItem(STORAGE_KEY, hidden ? '1' : '0')
    } catch {
      // Sin storage la preferencia dura lo que dure la sesión
    }
  }, [hidden])

  const toggle = useCallback(() => setHidden((v) => !v), [])
  const value = useMemo(() => ({ hidden, toggle }), [hidden, toggle])

  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>
}

export function usePrivacy(): PrivacyState {
  return useContext(PrivacyContext)
}
