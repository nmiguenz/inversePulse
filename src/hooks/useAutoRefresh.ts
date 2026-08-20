import { useEffect, useRef } from 'react'
import { isMarketOpenNow } from '@/lib/schedule'

/** Cada cuánto se relee la base mientras la rueda está abierta. */
const POLL_MS = 60_000

/**
 * Relectura de respaldo. Realtime es el camino rápido, no el único.
 *
 * La 0035 publicó las tablas y los eventos empezaron a llegar, pero seguir
 * dependiendo SOLO del websocket deja dos agujeros que desde el celular se ven
 * exactamente igual que un cron roto — números congelados sin un solo error:
 *
 * 1. **La PWA en segundo plano.** Android suspende la conexión y al volver
 *    supabase-js reconecta, pero los eventos de ese rato NO se reenvían: no hay
 *    replay. Abrís la app y ves la cartera de hace una hora hasta que hacés
 *    pull-to-refresh.
 * 2. **Lo que no viaja por realtime.** `iol_status` es una VISTA, y una vista no
 *    se puede agregar a una publicación. Todo lo que se lea de ahí solo se
 *    refresca de rebote, cuando algún otro evento dispara la relectura.
 *
 * El poll es contra la base, no contra IOL: es la misma relectura que hace el
 * provider al montarse, no gasta el token del broker ni dispara un sync.
 */
export function useAutoRefresh(reload: () => void | Promise<void>, enabled = true) {
  // El callback va en un ref para que el timer no se reinicie cuando cambia su
  // identidad. Si el efecto dependiera de `reload`, cada render del provider
  // volvería a montar un intervalo de 60s que nunca llegaría a cumplirse.
  const latest = useRef(reload)
  useEffect(() => {
    latest.current = reload
  }, [reload])

  useEffect(() => {
    if (!enabled) return

    const refresh = () => void latest.current()

    // El tick corre siempre y decide adentro. Si el intervalo se creara solo
    // con el mercado abierto, una pestaña abierta desde antes de la apertura no
    // arrancaría nunca: `isMarketOpenNow()` se habría evaluado una sola vez, al
    // montar, y ahí daba false.
    const id = setInterval(() => {
      if (document.visibilityState === 'visible' && isMarketOpenNow()) refresh()
    }, POLL_MS)

    // Volver al foreground releé siempre, aunque el mercado esté cerrado: es una
    // sola lectura por vez que abrís la app y es la que trae el último sync de
    // la rueda si la cerraste antes del cierre.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled])
}
