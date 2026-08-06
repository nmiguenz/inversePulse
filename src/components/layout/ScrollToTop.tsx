import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Lleva el scroll al inicio al cambiar de pantalla.
 *
 * Sin esto, entrar a una pestaña desde el fondo del Dashboard te deja a mitad
 * de la pantalla nueva: el navegador conserva la posición porque es la misma
 * página, solo cambia el contenido.
 *
 * `behavior: 'instant'` a propósito — una animación de scroll al abrir una
 * pantalla se siente como un salto, no como una transición.
 */
export function ScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname])

  return null
}
