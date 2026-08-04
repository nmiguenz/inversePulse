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

  // Si ya hay una suscripción activa la reusamos; re-suscribir invalida la anterior
  const existing = await registration.pushManager.getSubscription()
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBuffer(VAPID_PUBLIC_KEY),
    }))

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
