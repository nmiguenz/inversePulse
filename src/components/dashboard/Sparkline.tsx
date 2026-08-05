import { Line, LineChart, ResponsiveContainer, YAxis } from 'recharts'

/**
 * Sparkline de cierres de los últimos 30 días.
 *
 * Sin tooltip a propósito: es un mark de apoyo dentro de una fila densa, y los
 * números que importan (variación del día y P/L) están etiquetados al lado, en
 * la misma fila. El detalle interactivo va en la pantalla de la posición.
 */
export function Sparkline({ data, tone }: { data: number[]; tone: 'gain' | 'loss' | 'neutral' }) {
  if (data.length < 2) {
    return <div className="h-7 w-16" aria-hidden />
  }

  // SVG resuelve var() en runtime, así que el color sigue al tema sin JS
  const color =
    tone === 'gain'
      ? 'var(--color-gain)'
      : tone === 'loss'
        ? 'var(--color-loss)'
        : 'var(--color-muted)'
  const points = data.map((close, i) => ({ i, close }))

  return (
    <div className="h-7 w-16" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 3, right: 1, bottom: 3, left: 1 }}>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Line
            type="monotone"
            dataKey="close"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
