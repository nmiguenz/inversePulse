import { useEffect, useRef, useState } from 'react'

const THRESHOLD = 70
const MAX_PULL = 110

/**
 * Pull-to-refresh para la PWA.
 *
 * El `overscroll-behavior-y: none` del body ya desactiva el pull nativo del
 * browser, así que este gesto no compite con nada. Solo arranca cuando la
 * página está arriba de todo: si estás scrolleando en el medio del dashboard,
 * el gesto es scroll normal.
 */
export function usePullToRefresh(onRefresh: () => Promise<unknown>) {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef<number | null>(null)
  const refreshingRef = useRef(false)
  // El valor del arrastre vive en un ref además del estado: si el efecto
  // dependiera de `pull`, se desmontarían y remontarían los listeners en cada
  // frame del gesto, justo mientras el usuario está arrastrando.
  const pullRef = useRef(0)
  const onRefreshRef = useRef(onRefresh)

  useEffect(() => {
    onRefreshRef.current = onRefresh
  }, [onRefresh])

  useEffect(() => {
    function onTouchStart(e: TouchEvent) {
      // Solo si estamos arriba de todo y no hay un refresh en curso
      if (window.scrollY > 0 || refreshingRef.current) {
        startY.current = null
        return
      }
      startY.current = e.touches[0].clientY
    }

    function onTouchMove(e: TouchEvent) {
      if (startY.current == null) return

      const delta = e.touches[0].clientY - startY.current
      if (delta <= 0) {
        pullRef.current = 0
        setPull(0)
        return
      }

      // Resistencia: el recorrido se hace cada vez más "pesado"
      const damped = Math.min(MAX_PULL, delta * 0.5)
      pullRef.current = damped
      setPull(damped)

      // Evita que el gesto se interprete además como scroll
      if (e.cancelable) e.preventDefault()
    }

    async function onTouchEnd() {
      const shouldRefresh = pullRef.current >= THRESHOLD
      startY.current = null

      if (!shouldRefresh) {
        pullRef.current = 0
        setPull(0)
        return
      }

      refreshingRef.current = true
      setRefreshing(true)
      setPull(THRESHOLD)

      try {
        await onRefreshRef.current()
      } finally {
        refreshingRef.current = false
        setRefreshing(false)
        pullRef.current = 0
        setPull(0)
      }
    }

    // passive: false en touchmove porque necesitamos preventDefault
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd)
    window.addEventListener('touchcancel', onTouchEnd)

    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
    }
    // Sin dependencias: los listeners se registran una sola vez y leen el
    // estado vivo desde los refs.
  }, [])

  return { pull, refreshing, ready: pull >= THRESHOLD }
}
