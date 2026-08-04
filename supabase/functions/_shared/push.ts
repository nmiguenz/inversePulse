/**
 * Envío de Web Push (RFC 8291 / 8292) con VAPID.
 *
 * Secrets: VAPID_KEYS_B64 (JSON base64 con {publicKey, privateKey} en JWK) y
 * VAPID_CONTACT_EMAIL. Las keys se generan una sola vez; si se rotan, todas las
 * suscripciones existentes dejan de servir y hay que re-suscribir a los usuarios.
 */
import * as webpush from 'jsr:@negrel/webpush@0.3'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type PushPayload = {
  title: string
  body: string
  tag?: string
  url?: string
  alertId?: string
  severity?: 'critical' | 'warning' | 'info' | 'opportunity'
}

let serverPromise: Promise<webpush.ApplicationServer> | null = null

function getServer(): Promise<webpush.ApplicationServer> {
  if (!serverPromise) {
    serverPromise = (async () => {
      const raw = Deno.env.get('VAPID_KEYS_B64')
      if (!raw) throw new Error('Falta el secret VAPID_KEYS_B64')

      const exported = JSON.parse(atob(raw))
      const vapidKeys = await webpush.importVapidKeys(exported, { extractable: false })

      return await webpush.ApplicationServer.new({
        contactInformation: `mailto:${Deno.env.get('VAPID_CONTACT_EMAIL') ?? 'admin@example.com'}`,
        vapidKeys,
      })
    })()
  }
  return serverPromise
}

/**
 * Manda una notificación. Si la suscripción ya no existe (410/404 del push
 * service), la borra de `users` para no reintentar para siempre.
 */
export async function sendPush(
  db: SupabaseClient,
  userId: string,
  subscription: unknown,
  payload: PushPayload,
): Promise<boolean> {
  if (!subscription) return false

  try {
    const server = await getServer()
    const subscriber = server.subscribe(subscription as webpush.PushSubscription)
    await subscriber.pushTextMessage(JSON.stringify(payload), {})
    return true
  } catch (err) {
    if (err instanceof webpush.PushMessageError && err.isGone()) {
      await db.from('users').update({ push_subscription: null }).eq('id', userId)
      console.warn(`[push] suscripción vencida para ${userId}, se borró`)
      return false
    }
    console.error('[push] error enviando:', err instanceof Error ? err.message : err)
    return false
  }
}
