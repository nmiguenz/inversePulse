import { useMemo } from 'react'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatARS, formatCompactARS, formatPct, toneOf, toneText } from '@/lib/format'

export type Snapshot = { snapshot_date: string; total_value: number }

/**
 * Evolución del valor de la cartera.
 *
 * Una sola serie, así que no lleva leyenda: el título ya dice qué es. El eje Y
 * arranca en el mínimo de la serie y no en cero — con variaciones del 1-2%
 * diario, anclarlo en cero aplasta la curva contra el techo y no se lee nada.
 * Por eso el delta del período va escrito arriba: la forma muestra la
 * tendencia, el número da la magnitud.
 */
export function PortfolioChart({ snapshots }: { snapshots: Snapshot[] }) {
  const data = useMemo(
    () =>
      [...snapshots]
        .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
        .map((s) => ({ date: s.snapshot_date, value: Number(s.total_value) })),
    [snapshots],
  )

  if (data.length < 2) {
    return (
      <p className="text-muted text-[12px] leading-relaxed">
        El gráfico necesita al menos dos días de historial. Se guarda un snapshot por día, así que
        mañana ya vas a ver la primera línea.
      </p>
    )
  }

  const first = data[0].value
  const last = data[data.length - 1].value
  const change = last - first
  const changePct = first > 0 ? (change / first) * 100 : 0
  const tone = toneOf(change)
  const color = tone === 'gain' ? 'var(--color-gain)' : tone === 'loss' ? 'var(--color-loss)' : 'var(--color-secondary)'

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-muted font-mono text-[10px] tracking-wider uppercase">
          {data.length} días
        </p>
        <p className={`tnum font-mono text-[12px] ${toneText[tone]}`}>
          {change > 0 ? '+' : ''}
          {formatCompactARS(Math.abs(change))} · {formatPct(changePct)}
        </p>
      </div>

      <div className="h-[150px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id="portfolioFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>

            <XAxis
              dataKey="date"
              tick={{ fill: 'var(--color-muted)', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              tickFormatter={(d: string) =>
                new Date(`${d}T12:00:00`).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
              }
              axisLine={false}
              tickLine={false}
              minTickGap={28}
            />
            <YAxis hide domain={['dataMin', 'dataMax']} />

            <Tooltip
              cursor={{ stroke: 'var(--color-strong)' }}
              contentStyle={{
                background: 'var(--color-elevated)',
                border: '1px solid var(--color-strong)',
                borderRadius: 12,
                fontSize: 12,
                padding: '8px 10px',
              }}
              itemStyle={{ color: 'var(--color-primary)' }}
              labelFormatter={(d: string) =>
                new Date(`${d}T12:00:00`).toLocaleDateString('es-AR', {
                  day: '2-digit',
                  month: 'short',
                })
              }
              formatter={(value: number) => [formatARS(value), 'Total']}
            />

            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              fill="url(#portfolioFill)"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-surface)' }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
