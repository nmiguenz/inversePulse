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
   *
   * NULL en los días sin rueda y en el primero de la serie: "no se sabe" no es
   * lo mismo que "no se movió".
   */
  daily_pnl?: number | null
}

type Mode = 'today' | 'weekly' | 'monthly'
type Point = { key: string; value: number }

const MODES: Array<{ id: Mode; label: string }> = [
  { id: 'today', label: 'Día' },
  { id: 'weekly', label: 'Semana' },
  { id: 'monthly', label: 'Mes' },
]

/**
 * Cuánto se ganó o se perdió: hoy, por semana o por mes.
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
 *
 * ── Por qué "Día" no es una serie ────────────────────────────────────────
 *
 * Una barra por día llenaba el celular de tiras de pocos píxeles, imposibles
 * de tocar y de leer. La rueda de hoy es UN número, así que se muestra como un
 * número: la forma de serie recién sirve cuando hay algo que comparar, y eso
 * empieza en la semana.
 */
export function PortfolioChart({ snapshots }: { snapshots: Snapshot[] }) {
  const [mode, setMode] = useState<Mode>('weekly')

  /** Ruedas reales, ordenadas. Lo demás no existe para este gráfico. */
  const sessions = useMemo(
    () =>
      [...snapshots]
        .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
        // NULL es "no se sabe" y ya cubre los días sin rueda, que el backend
        // deja vacíos desde la 0034. El filtro de fin de semana queda como
        // defensa: si alguna fila vieja se escapó, un sábado con resultado es
        // siempre un dato inventado.
        .filter((s) => s.daily_pnl !== null && s.daily_pnl !== undefined)
        .filter((s) => !isWeekend(s.snapshot_date))
        .map((s) => ({ key: s.snapshot_date, value: Number(s.daily_pnl) })),
    [snapshots],
  )

  const weekly = useMemo(() => groupBy(sessions, weekKey), [sessions])
  const monthly = useMemo(() => groupBy(sessions, (k) => k.slice(0, 7)), [sessions])

  if (!sessions.length) {
    return (
      <p className="text-muted text-[12px] leading-relaxed">
        Todavía no hay resultados guardados. Se registra cuánto se movió tu cartera cada día de
        rueda, así que en la próxima sincronización ya vas a ver el primero.
      </p>
    )
  }

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-3">
        <Heading mode={mode} sessions={sessions} weekly={weekly} monthly={monthly} />

        {/* El filtro va en una fila sobre el gráfico, no adentro */}
        <div className="border-line flex shrink-0 rounded-lg border p-0.5">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`rounded-md px-2 py-1 text-[11px] transition-colors ${
                mode === m.id ? 'bg-elevated text-primary font-medium' : 'text-muted'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'today' ? (
        <TodayPanel last={sessions[sessions.length - 1]} />
      ) : (
        <Chart data={mode === 'weekly' ? weekly : monthly} mode={mode} />
      )}
    </div>
  )
}

function Heading({
  mode,
  sessions,
  weekly,
  monthly,
}: {
  mode: Mode
  sessions: Point[]
  weekly: Point[]
  monthly: Point[]
}) {
  if (mode === 'today') {
    return (
      <div className="min-w-0">
        <p className="text-muted text-[11px]">Última rueda</p>
        <p className="text-secondary mt-0.5 text-[11px]">
          {longDate(sessions[sessions.length - 1].key)}
        </p>
      </div>
    )
  }

  const data = mode === 'weekly' ? weekly : monthly
  const total = data.reduce((sum, d) => sum + d.value, 0)
  const wins = data.filter((d) => d.value > 0).length
  const tone = toneOf(total)

  return (
    <div className="min-w-0">
      <p className={`tnum font-mono text-[15px] font-semibold ${toneText[tone]}`}>
        {sign(total)}
        {formatCompactARS(Math.abs(total))}
      </p>
      <p className="text-muted text-[11px]">
        {wins} de {data.length} {mode === 'weekly' ? 'semanas' : 'meses'} en positivo
      </p>
    </div>
  )
}

/**
 * La rueda de hoy, en grande.
 *
 * Sin barras: un solo valor no se compara con nada, y dibujarlo como gráfico
 * era lo que llenaba la tarjeta de ruido en el celular.
 */
function TodayPanel({ last }: { last: Point }) {
  const tone = toneOf(last.value)
  return (
    <div className="flex h-[150px] flex-col items-center justify-center">
      <p className={`font-display tnum text-[34px] leading-none font-bold ${toneText[tone]}`}>
        {sign(last.value)}
        {formatARS(Math.abs(last.value))}
      </p>
      <p className="text-muted mt-2 text-[12px]">
        {last.value > 0 ? 'ganaste' : last.value < 0 ? 'perdiste' : 'quedó igual'} por movimiento de
        precios
      </p>
    </div>
  )
}

function Chart({ data, mode }: { data: Point[]; mode: Mode }) {
  // Simétrico alrededor del cero: si no, el lado más chico se ve exagerado y
  // una pérdida menor parece del tamaño de una ganancia grande.
  const peak = Math.max(...data.map((d) => Math.abs(d.value)), 1)

  return (
    <div className="h-[150px]">
      <ResponsiveContainer width="100%" height="100%">
        {/* Separación generosa: con pocas barras anchas el celular las puede
            tocar, y la forma se lee de un vistazo en vez de parecer un bloque */}
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }} barCategoryGap="35%">
          <XAxis
            dataKey="key"
            tick={{ fill: 'var(--color-muted)', fontSize: 10, fontFamily: 'JetBrains Mono' }}
            tickFormatter={(key: string) => shortLabel(key, mode)}
            axisLine={false}
            tickLine={false}
            minTickGap={4}
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
            labelFormatter={(key: string) => longLabel(key, mode)}
            // El signo va escrito, no solo pintado
            formatter={(value: number) => [
              `${sign(value)}${formatARS(Math.abs(value))}`,
              value >= 0 ? 'Ganancia' : 'Pérdida',
            ]}
          />

          <Bar dataKey="value" maxBarSize={34} isAnimationActive={false} shape={<DivergingBar />}>
            {data.map((d) => (
              <Cell key={d.key} fill={d.value >= 0 ? 'var(--color-gain)' : 'var(--color-loss)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ---------- Fechas ----------
// Todo se lee a mediodía UTC: para un valor que es solo fecha, evita que el
// huso lo corra al día anterior o al siguiente.

function isWeekend(iso: string): boolean {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay()
  return dow === 0 || dow === 6
}

/**
 * Lunes de la semana a la que pertenece la fecha.
 *
 * Se agrupa por el lunes y no por número de semana para no tener que resolver
 * el borde de fin de año, donde la semana 1 puede arrancar en diciembre.
 */
function weekKey(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  // getUTCDay da 0 para domingo; el ajuste lleva el lunes a 0.
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

function groupBy(points: Point[], keyOf: (iso: string) => string): Point[] {
  const acc = new Map<string, number>()
  for (const p of points) {
    const k = keyOf(p.key)
    acc.set(k, (acc.get(k) ?? 0) + p.value)
  }
  return [...acc.entries()].map(([key, value]) => ({ key, value }))
}

function shortLabel(key: string, mode: Mode): string {
  return mode === 'weekly'
    ? new Date(`${key}T12:00:00Z`).toLocaleDateString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        timeZone: 'UTC',
      })
    : new Date(`${key}-01T12:00:00Z`).toLocaleDateString('es-AR', {
        month: 'short',
        timeZone: 'UTC',
      })
}

function longLabel(key: string, mode: Mode): string {
  if (mode === 'monthly') {
    return new Date(`${key}-01T12:00:00Z`).toLocaleDateString('es-AR', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    })
  }
  const start = new Date(`${key}T12:00:00Z`)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 4) // lunes a viernes
  const fmt = (d: Date) =>
    d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
  return `Semana del ${fmt(start)} al ${fmt(end)}`
}

function longDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-AR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    timeZone: 'UTC',
  })
}

function sign(value: number): string {
  return value > 0 ? '+' : value < 0 ? '−' : ''
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
