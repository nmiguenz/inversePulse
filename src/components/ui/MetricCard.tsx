import { toneOf, toneText } from '@/lib/format'

type MetricCardProps = {
  label: string
  value: string
  subLabel?: string
  /** Si se pasa, colorea el valor (verde/rojo) y aplica el glow correspondiente */
  tone?: number | 'gain' | 'loss' | 'neutral'
  /** Valor grande (28px) para la métrica principal */
  size?: 'md' | 'lg'
}

export function MetricCard({ label, value, subLabel, tone, size = 'md' }: MetricCardProps) {
  const resolved = typeof tone === 'number' ? toneOf(tone) : (tone ?? 'neutral')
  const glow = resolved === 'gain' ? 'glow-gain' : resolved === 'loss' ? 'glow-loss' : ''

  return (
    <div className={`card p-5 ${glow}`}>
      <p className="text-secondary text-[12px]">{label}</p>
      <p
        className={`font-display tnum mt-1.5 font-bold ${size === 'lg' ? 'text-[30px]' : 'text-[20px]'} leading-none ${toneText[resolved]} ${resolved === 'neutral' ? 'text-primary' : ''}`}
      >
        {value}
      </p>
      {subLabel && <p className="text-muted mt-1.5 text-[12px]">{subLabel}</p>}
    </div>
  )
}
