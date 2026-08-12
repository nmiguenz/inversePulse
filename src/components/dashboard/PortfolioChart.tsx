import { useMemo, useState } from 'react'
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatARS, formatCompactARS, toneOf, toneText } from '@/lib/format'

export type Snapshot = {
  snapshot_date: string
  total_value: number
  /**
   * Resultado del día por movimiento de PRECIOS (0028).
   *
   * No lo afectan compras, ventas, rescates, aportes ni retiros: vender no es
   * perder, es cambiar de forma la misma plata.
   */
  daily_pnl?: number | null
}

type Mode = 'daily' | 'monthly'

/**
 * Cuánto se ganó o se perdió, por día o por mes.
 *
 * Antes esto graficaba el VALOR total de la cartera. Ese gráfico responde
 * "cuánto tengo", que ya está arriba en letras grandes, y esconde lo que
 * importa: con variaciones de 1-2% diario la línea sale casi plana y no se
 * distingue un día bueno de uno malo.
 *
 * ── Por qué barras divergentes ───────────────────────────────────────────
 *
 * El dato tiene POLARIDAD —arriba o abajo de cero— y esa es la forma que le
 * corresponde. El signo queda codificado dos veces: por posición respecto del
 * cero y por color. Nunca por color solo, que es lo que rompería para quien no
 * distingue rojo de verde.
 *
 * El eje Y va oculto pero SIMÉTRICO alrededor del cero, para que una barra del
 * doble de alto sea el doble de plata. Un eje automático exageraría el lado con
 * el máximo más chico.
 */
export function PortfolioChart({ snapshots }: { snapshots: Snapshot[] }) {
  const [mode, setMode] = useState<Mode>('daily')

  const daily = useMemo(
    () =>
      [...snapshots]
        .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
        // El primer día no tiene contra qué comparar, así que su resultado es
        // NULL, no cero: un cero dibujaría "no ganaste ni perdiste", que es
        // una afirmación distinta de "no se sabe".
        .filter((s) => s.daily_pnl !== null && s.daily_pnl !== undefined)
        .map((s) => ({ key: s.snapshot_date, value: Number(s.daily_pnl) })),
    [snapshots],
  )

  const monthly = useMemo(() => {
    const byMonth = new Map<string, number>()
    for (const d of daily) {
      const month = d.key.slice(0, 7)
      byMonth.set(month, (byMonth.get(month) ?? 0) + d.value)
    }
    return [...byMonth.entries()].map(([key, value]) => ({ key, value }))
  }, [daily])

  const data = mode === 'daily' ? daily : monthly

  if (!daily.length) {
    return (
      <p className="text-muted text-[12px] leading-relaxed">
        Todavía no hay resultados guardados. Se registra cuánto se movió tu cartera cada día, así
        que en la próxima sincronización ya vas a ver la primera barra.
      </p>
    )
  }

  const total = data.reduce((sum, d) => sum + d.value, 0)
  const wins = data.filter((d) => d.value > 0).length
  const tone = toneOf(total)

  // Simétrico alrededor del cero: si no, el lado más chico se ve exagerado y
  // una pérdida menor parece del tamaño de una ganancia grande.
  const peak = Math.max(...data.map((d) => Math.abs(d.value)), 1)

  const label = (key: string) =>
    mode === 'daily'
      ? new Date(`${key}T12:00:00`).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
      : new Date(`${key}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'short', year: '2-digit' })

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={`tnum font-mono text-[15px] font-semibold ${toneText[tone]}`}>
            {total > 0 ? '+' : total < 0 ? '−' : ''}
            {formatCompactARS(Math.abs(total))}
          </p>
          <p className="text-muted text-[11px]">
            {mode === 'daily'
              ? `${wins} de ${data.length} días en positivo`
              : `${wins} de ${data.length} meses en positivo`}
          </p>
        </div>

        {/* El filtro va en una fila sobre el gráfico, no adentro */}
        <div className="border-line flex shrink-0 rounded-lg border p-0.5">
          {(['daily', 'monthly'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                mode === m ? 'bg-elevated text-primary font-medium' : 'text-muted'
              }`}
            >
              {m === 'daily' ? 'Día' : 'Mes'}
            </button>
          ))}
        </div>
      </div>

      <div className="h-[150px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }} barCategoryGap="18%">
            <XAxis
              dataKey="key"
              tick={{ fill: 'var(--color-muted)', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              tickFormatter={label}
              axisLine={false}
              tickLine={false}
              minTickGap={mode === 'daily' ? 28 : 8}
            />
            <YAxis hide domain={[-peak, peak]} />

            {/* La línea del cero es la referencia que hace legible el signo */}
            <ReferenceLine y={0} stroke="var(--color-strong)" strokeWidth={1} />

            <Tooltip
              cursor={{ fill: 'var(--color-hover)' }}
              contentStyle={{
                background: 'var(--color-elevated)',
                border: '1px solid var(--color-strong)',
                borderRadius: 12,
                fontSize: 12,
                padding: '8px 10px',
              }}
              itemStyle={{ color: 'var(--color-primary)' }}
              labelFormatter={(key: string) =>
                mode === 'daily'
                  ? new Date(`${key}T12:00:00`).toLocaleDateString('es-AR', {
                      day: '2-digit',
                      month: 'short',
                    })
                  : new Date(`${key}-01T12:00:00`).toLocaleDateString('es-AR', {
                      month: 'long',
                      year: 'numeric',
                    })
              }
              // El signo va escrito, no solo pintado
              formatter={(value: number) => [
                `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatARS(Math.abs(value))}`,
                value >= 0 ? 'Ganancia' : 'Pérdida',
              ]}
            />

            <Bar dataKey="value" maxBarSize={24} isAnimationActive={false} shape={<DivergingBar />}>
              {data.map((d) => (
                <Cell
                  key={d.key}
                  fill={d.value >= 0 ? 'var(--color-gain)' : 'var(--color-loss)'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/**
 * Barra con la punta redondeada y la base cuadrada.
 *
 * Recharts solo acepta un `radius` fijo para toda la serie, y acá la punta
 * cambia de lado según el signo: arriba en las ganancias, abajo en las
 * pérdidas. Con un radius fijo, las barras negativas quedarían redondeadas
 * contra la línea del cero, que es justo el borde que tiene que leerse recto.
 */
function DivergingBar(props: {
  x?: number
  y?: number
  width?: number
  height?: number
  fill?: string
  value?: number
}) {
  const { x = 0, y = 0, width = 0, height = 0, fill, value = 0 } = props
  if (!width || !height) return null

  const r = Math.min(4, width / 2, height)
  const up = value >= 0

  // Un path en vez de <rect>: rect no sabe redondear dos esquinas de un lado
  const path = up
    ? `M${x},${y + height} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + height} Z`
    : `M${x},${y} L${x},${y + height - r} Q${x},${y + height} ${x + r},${y + height} L${x + width - r},${y + height} Q${x + width},${y + height} ${x + width},${y + height - r} L${x + width},${y} Z`

  return <path d={path} fill={fill} />
}
