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
/** Un hueco es un día sin rueda o todavía por venir: no es un cero. */
type Slot = { key: string; value: number | null }

const MODES: Array<{ id: Mode; label: string }> = [
  { id: 'today', label: 'Día' },
  { id: 'weekly', label: 'Semana' },
  { id: 'monthly', label: 'Mes' },
]

/**
 * Cuánto se ganó o se perdió: hoy, en la semana en curso, o por mes.
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
 * Una barra por día, sobre todo el histórico, llenaba el celular de tiras de
 * pocos píxeles imposibles de tocar y de leer. La rueda de hoy es UN número,
 * así que se muestra como un número.
 *
 * La serie recién sirve cuando hay algo que comparar, y son cinco ranuras
 * fijas: la semana en curso, de lunes a viernes.
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

  /**
   * Lunes a viernes de la semana EN CURSO.
   *
   * Antes esto era una barra por semana, y con dos semanas de historia el
   * gráfico eran dos manchas sin nada que mirar. La semana que importa es la
   * que estás viviendo: el marco es fijo de lunes a viernes, y los días sin
   * rueda —feriados— o todavía por venir quedan vacíos en vez de dibujar un
   * cero, que afirmaría que no se movió nada.
   */
  const currentWeek = useMemo<Slot[]>(() => {
    const byDate = new Map(sessions.map((s) => [s.key, s.value]))
    const monday = weekKey(todayInBA())
    return Array.from({ length: 5 }, (_, i) => {
      const d = new Date(`${monday}T12:00:00Z`)
      d.setUTCDate(d.getUTCDate() + i)
      const key = d.toISOString().slice(0, 10)
      return { key, value: byDate.get(key) ?? null }
    })
  }, [sessions])
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
        <Heading mode={mode} sessions={sessions} week={currentWeek} monthly={monthly} />

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
        <Chart data={mode === 'weekly' ? currentWeek : monthly} mode={mode} />
      )}
    </div>
  )
}

function Heading({
  mode,
  sessions,
  week,
  monthly,
}: {
  mode: Mode
  sessions: Point[]
  week: Slot[]
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

  // Los huecos no cuentan: una semana con tres ruedas es "1 de 3", no "1 de 5"
  const values = (mode === 'weekly' ? week : monthly)
    .map((d) => d.value)
    .filter((v): v is number => v !== null)
  const total = values.reduce((sum, v) => sum + v, 0)
  const wins = values.filter((v) => v > 0).length
  const tone = toneOf(total)

  return (
    <div className="min-w-0">
      <p className={`tnum font-mono text-[15px] font-semibold ${toneText[tone]}`}>
        {sign(total)}
        {formatCompactARS(Math.abs(total))}
      </p>
      <p className="text-muted text-[11px]">
        {mode === 'weekly'
          ? `${wins} de ${values.length} ${values.length === 1 ? 'rueda' : 'ruedas'} esta semana`
          : `${wins} de ${values.length} ${values.length === 1 ? 'mes' : 'meses'} en positivo`}
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

function Chart({ data, mode }: { data: Slot[]; mode: Mode }) {
  // Simétrico alrededor del cero: si no, el lado más chico se ve exagerado y
  // una pérdida menor parece del tamaño de una ganancia grande.
  const peak = Math.max(...data.map((d) => Math.abs(d.value ?? 0)), 1)

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
              <Cell key={d.key} fill={(d.value ?? 0) >= 0 ? 'var(--color-gain)' : 'var(--color-loss)'} />
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

/** Hoy en Buenos Aires: el mercado local define de qué semana estamos hablando. */
function todayInBA(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
}

function shortLabel(key: string, mode: Mode): string {
  // Con cinco ranuras fijas el día de la semana se lee mejor que la fecha, y
  // además deja claro que el marco es lunes a viernes
  return mode === 'weekly'
    ? new Date(`${key}T12:00:00Z`).toLocaleDateString('es-AR', {
        weekday: 'short',
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
  return longDate(key)
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
 *
 * ── Ojo con el signo de `height` ─────────────────────────────────────────
 *
 * Para las barras bajo cero Recharts manda `height` NEGATIVO, con `y` en la
 * línea del cero. La versión anterior lo usaba tal cual, así que el radio
 * salía negativo y las curvas de las esquinas se abrían hacia afuera: las
 * barras rojas se ensanchaban en la base como un embudo, mientras las verdes
 * se veían bien. Por eso acá se normaliza todo a valores positivos antes de
 * dibujar, en vez de confiar en la convención de signos.
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

  const w = Math.abs(width)
  const h = Math.abs(height)
  if (!w || !h) return null

  // Esquina superior izquierda real, venga el alto en el signo que venga
  const left = width < 0 ? x + width : x
  const top = height < 0 ? y + height : y

  const r = Math.max(0, Math.min(4, w / 2, h))
  const up = value >= 0

  // Un path en vez de <rect>: rect no sabe redondear dos esquinas de un lado
  const path = up
    ? `M${left},${top + h} L${left},${top + r} Q${left},${top} ${left + r},${top} L${left + w - r},${top} Q${left + w},${top} ${left + w},${top + r} L${left + w},${top + h} Z`
    : `M${left},${top} L${left},${top + h - r} Q${left},${top + h} ${left + r},${top + h} L${left + w - r},${top + h} Q${left + w},${top + h} ${left + w},${top + h - r} L${left + w},${top} Z`

  return <path d={path} fill={fill} />
}
