/**
 * Nombres de canal únicos por suscripción.
 *
 * supabase-js indexa los canales por nombre: si dos componentes montan un hook
 * que abre `mi-canal`, el segundo recibe el canal ya suscripto del primero y
 * falla con "cannot add postgres_changes callbacks after subscribe()". Ese bug
 * apareció dos veces en este proyecto (useAlerts y usePortfolio).
 *
 * Para datos compartidos entre pantallas la solución correcta es un provider
 * único. Este helper es para el otro caso: hooks de una sola pantalla, donde
 * un nombre único evita que un remonte o un segundo uso futuro rompa nada.
 */
let counter = 0

export function uniqueChannelName(prefix: string): string {
  counter += 1
  return `${prefix}:${counter}`
}
