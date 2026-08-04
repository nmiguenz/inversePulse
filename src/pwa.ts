import { registerSW } from 'virtual:pwa-register'

/**
 * Registra el service worker. Con `registerType: 'autoUpdate'` el SW nuevo
 * toma control solo; acá solo logueamos el estado para debug.
 */
export function setupPWA() {
  if (import.meta.env.SSR) return

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      // Con autoUpdate esto casi nunca dispara; refrescamos igual.
      void updateSW(true)
    },
    onOfflineReady() {
      console.info('[pwa] listo para funcionar offline')
    },
    onRegisterError(error) {
      console.error('[pwa] error registrando el service worker', error)
    },
  })
}
