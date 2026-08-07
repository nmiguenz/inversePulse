/**
 * Modo privado: los montos se muestran como ***
 *
 * El estado vive acá, a nivel de módulo, y no en un contexto de React, para
 * que TODOS los montos se oculten con un solo cambio. Un ojo que tapa el total
 * pero deja ver las posiciones no oculta nada — y estas funciones son puras y
 * se usan desde ~30 lugares, así que pasarles una prop por todos lados era
 * garantía de olvidarse alguno.
 *
 * `PrivacyProvider` es el que fuerza el re-render cuando esto cambia.
 */
const MASK = '***'
let amountsHidden = false

export function setAmountsHidden(value: boolean) {
  amountsHidden = value
}

export function areAmountsHidden(): boolean {
  return amountsHidden
}

const ars = new Intl.NumberFormat('es-AR', {
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

const compact = new Intl.NumberFormat('es-AR', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

/** $7.296.070 */
export function formatARS(value: number, withCents = false): string {
  if (amountsHidden) return MASK
  return (withCents ? arsCents : ars).format(value)
}

/** +$46.244 / -$86.000 — siempre con signo */
export function formatSignedARS(value: number, withCents = false): string {
  if (amountsHidden) return MASK
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${formatARS(Math.abs(value), withCents)}`
}

/** $1,6M — para tablas densas */
export function formatCompactARS(value: number): string {
  if (amountsHidden) return MASK
  return `$${compact.format(value)}`
}

/** +0,65% */
export function formatPct(value: number, digits = 2): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${Math.abs(value).toFixed(digits).replace('.', ',')}%`
}

const relative = new Intl.RelativeTimeFormat('es-AR', { numeric: 'auto' })

/** "hace 5 minutos", "ayer" */
export function formatRelativeTime(iso: string): string {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60000)
  if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute')

  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return relative.format(hours, 'hour')

  return relative.format(Math.round(hours / 24), 'day')
}

/** Clase de color según el signo (positivo = verde, negativo = rojo, 0 = neutro) */
export function toneOf(value: number): 'gain' | 'loss' | 'neutral' {
  if (value > 0) return 'gain'
  if (value < 0) return 'loss'
  return 'neutral'
}

export const toneText: Record<'gain' | 'loss' | 'neutral', string> = {
  gain: 'text-gain',
  loss: 'text-loss',
  neutral: 'text-secondary',
}
