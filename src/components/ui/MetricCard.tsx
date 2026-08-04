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
    <div className={`border-subtle bg-surface rounded-2xl border p-4 ${glow}`}>
      <p className="text-muted font-mono text-[11px] tracking-[0.1em] uppercase">{label}</p>
      <p
        className={`font-display tnum mt-1.5 font-bold ${size === 'lg' ? 'text-[28px]' : 'text-[19px]'} leading-none ${toneText[resolved]} ${resolved === 'neutral' ? 'text-primary' : ''}`}
      >
        {value}
      </p>
      {subLabel && <p className="text-secondary mt-1.5 text-[12px]">{subLabel}</p>}
    </div>
  )
}
