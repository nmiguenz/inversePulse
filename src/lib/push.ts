import { supabase } from './supabase'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export const pushSupported =
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window

/** base64url → ArrayBuffer, que es lo que espera applicationServerKey */
function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes.buffer
}

/** ¿Los dos buffers tienen exactamente los mismos bytes? */
function sameKey(a: ArrayBuffer | null | undefined, b: ArrayBuffer): boolean {
  if (!a || a.byteLength !== b.byteLength) return false
  const x = new Uint8Array(a)
  const y = new Uint8Array(b)
  return x.every((byte, i) => byte === y[i])
}

/**
 * Traduce el error crudo del navegador a algo accionable.
 *
 * "Registration failed - push service error" es literal del push service y no
 * le dice nada a nadie. Verifiqué que la clave VAPID del build desplegado es
 * válida y coincide con la local, así que cuando aparece, el problema está del
 * lado del navegador o de la red — no de la app.
 */
function explain(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err)

  if (/push service error|Registration failed/i.test(raw)) {
    return new Error(
      'El navegador no pudo registrarse en su servicio de notificaciones. ' +
        'Suele pasar en Brave (hay que activar "Use Google services for push messaging" en ' +
        'Configuración → Privacidad y reiniciar), o cuando una red corporativa o VPN bloquea ' +
        'los servidores de Google. Probá desde otro navegador o red para confirmarlo.',
    )
  }

  if (/permission/i.test(raw)) {
    return new Error('El navegador bloqueó las notificaciones para este sitio.')
  }

  return err instanceof Error ? err : new Error(raw)
}

/**
 * Pide permiso, se suscribe al push service y guarda la suscripción en
 * `users.push_subscription`, que es de donde la lee la Edge Function.
 */
export async function subscribeToPush(userId: string): Promise<PushSubscription> {
  if (!pushSupported) throw new Error('Este dispositivo no soporta push notifications')
  if (!VAPID_PUBLIC_KEY) throw new Error('Falta VITE_VAPID_PUBLIC_KEY en el .env.local')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Permiso de notificaciones denegado')

  const registration = await navigator.serviceWorker.ready
  const key = urlBase64ToBuffer(VAPID_PUBLIC_KEY)

  let existing = await registration.pushManager.getSubscription()

  // Una suscripción vieja puede estar atada a OTRA clave VAPID.
  //
  // Antes se reusaba sin mirar. El problema es silencioso y por eso peor: el
  // navegador la da por buena, la app dice "activadas", y los envíos fallan
  // para siempre porque el servidor firma con una clave que esa suscripción no
  // reconoce. Si no coincide, se da de baja y se pide una nueva.
  if (existing && !sameKey(existing.options?.applicationServerKey, key)) {
    await existing.unsubscribe().catch(() => undefined)
    existing = null
  }

  let subscription = existing

  if (!subscription) {
    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      })
    } catch (err) {
      // Un registro local corrupto hace fallar el subscribe aunque no haya
      // ninguna suscripción "visible". Darlo de baja y reintentar una vez
      // resuelve ese caso; si vuelve a fallar, el problema es del navegador o
      // de la red y hay que decirlo con todas las letras.
      const stale = await registration.pushManager.getSubscription()
      if (!stale) throw explain(err)

      await stale.unsubscribe().catch(() => undefined)
      try {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        })
      } catch (retryErr) {
        throw explain(retryErr)
      }
    }
  }

  const { error } = await supabase
    .from('users')
    .update({ push_subscription: subscription.toJSON() })
    .eq('id', userId)

  if (error) throw error
  return subscription
}

export async function unsubscribeFromPush(userId: string): Promise<void> {
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  await subscription?.unsubscribe()
  await supabase.from('users').update({ push_subscription: null }).eq('id', userId)
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported) return null
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}
