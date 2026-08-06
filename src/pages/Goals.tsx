import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Card, EmptyState, SectionTitle } from '@/components/ui/Card'
import { AssetLogo } from '@/components/ui/AssetLogo'
import { GoalDifficulty } from '@/components/goals/GoalDifficulty'
import { GoalPlan } from '@/components/goals/GoalPlan'
import { UnassignedPurchases } from '@/components/goals/UnassignedPurchases'
import { useGoals } from '@/hooks/useGoals'
import { usePortfolio } from '@/hooks/usePortfolio'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { formatARS, formatPct, toneOf, toneText } from '@/lib/format'
import { analyzeGoal, scenarios, type RiskProfile, type ScenarioSet } from '@/lib/goals'
import type { Goal } from '@/lib/types'

type GoalInput = {
  name: string
  description?: string | null
  target_date?: string | null
  target_amount?: number | null
  cash_ars?: number | null
  emoji?: string
}

/**
 * Cuánto falta para la fecha objetivo.
 *
 * Ambas fechas se anclan al mediodía local antes de restar. Comparar contra
 * `Date.now()` metía la hora del día en la cuenta: a la mañana faltaba medio
 * día de más y a la tarde medio de menos, y el redondeo daba "faltan 0 días"
 * para una fecha futura o "falta 1 día" para hoy.
 */
function timeLeft(date: string | null): string | null {
  if (!date) return null

  const target = new Date(`${date}T12:00:00`).getTime()
  if (Number.isNaN(target)) return null

  const now = new Date()
  const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime()
  const days = Math.round((target - todayNoon) / 864e5)
  if (days < 0) return 'fecha cumplida'
  if (days === 0) return 'es hoy'
  if (days === 1) return 'falta 1 día'
  if (days < 60) return `faltan ${days} días`

  const months = Math.round(days / 30)
  if (months < 24) return `faltan ${months} meses`

  const years = days / 365
  const rounded = Math.round(years * 10) / 10
  return `faltan ${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} años`
}

export function Goals() {
  const { goals, holdings, loading, createGoal, updateGoal, assign, unassign, removeGoal, reload } =
    useGoals()
  const { positions } = usePortfolio()
  const { session } = useAuth()
  const [creating, setCreating] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [profile, setProfile] = useState<RiskProfile>('agresivo')

  // El rango de escenarios sale del perfil de riesgo elegido en Config
  useEffect(() => {
    if (!session) return
    void supabase
      .from('users')
      .select('settings')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        const p = (data?.settings as Record<string, unknown>)?.risk_profile
        if (p === 'moderado' || p === 'agresivo') setProfile(p)
      })
  }, [session])

  const set: ScenarioSet = useMemo(() => scenarios(profile), [profile])

  const totalAssigned = useMemo(
    () => goals.reduce((s, g) => s + Number(g.current_value), 0),
    [goals],
  )
  const totalCost = useMemo(() => goals.reduce((s, g) => s + Number(g.cost_basis), 0), [goals])
  const portfolioTotal = useMemo(() => positions.reduce((s, p) => s + p.value, 0), [positions])

  // Cuánto hay apartado de cada símbolo en TODAS las metas, para saber qué
  // queda libre al asignar una compra
  const assignedBySymbol = useMemo(() => {
    const map = new Map<string, number>()
    for (const h of holdings) map.set(h.symbol, (map.get(h.symbol) ?? 0) + Number(h.quantity))
    return map
  }, [holdings])

  const heldBySymbol = useMemo(
    () => new Map(positions.map((p) => [p.symbol, p.quantity])),
    [positions],
  )

  if (loading) return <div className="card h-40 animate-pulse" />

  const totalGain = totalAssigned - totalCost

  return (
    <div className="animate-fade-up space-y-4">
      {goals.length > 0 && (
        <Card>
          <p className="text-secondary text-[13px]">Comprometido en metas</p>
          <p className="font-display tnum text-primary mt-1.5 text-[26px] leading-none font-bold">
            {formatARS(totalAssigned)}
          </p>
          {totalCost > 0 && (
            <p className={`tnum mt-2 text-[13px] font-medium ${toneText[toneOf(totalGain)]}`}>
              {formatPct((totalGain / totalCost) * 100, 1)} desde que lo apartaste
            </p>
          )}
          {portfolioTotal > 0 && (
            <p className="text-muted mt-1 text-[12px]">
              {((totalAssigned / portfolioTotal) * 100).toFixed(1)}% de tu cartera · el resto queda
              libre
            </p>
          )}
        </Card>
      )}

      {goals.length === 0 && !creating ? (
        <EmptyState
          icon="🎯"
          title="Sin metas todavía"
          description="Una meta aparta parte de lo que ya tenés para un objetivo puntual — el ahorro de tu hijo, un viaje. No es plata nueva ni una cartera aparte: es tu cartera, vista por objetivo."
        />
      ) : (
        <ul className="space-y-3">
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              set={set}
              holdings={holdings.filter((h) => h.goal_id === goal.id)}
              positions={positions}
              assignedBySymbol={assignedBySymbol}
              heldBySymbol={heldBySymbol}
              expanded={expanded === goal.id}
              onToggle={() => setExpanded(expanded === goal.id ? null : goal.id)}
              onUpdate={updateGoal}
              onAssign={assign}
              onUnassign={unassign}
              onRemove={removeGoal}
              onReload={reload}
            />
          ))}
        </ul>
      )}

      {creating ? (
        <Card>
          <SectionTitle>Nueva meta</SectionTitle>
          <GoalForm
            set={set}
            onCancel={() => setCreating(false)}
            onSubmit={async (input) => {
              const result = await createGoal(input)
              if (!result.error) setCreating(false)
              return result
            }}
          />
        </Card>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="gradient-accent w-full rounded-xl py-3 text-[14px] font-semibold text-white"
        >
          Nueva meta
        </button>
      )}
    </div>
  )
}

function GoalCard({
  goal,
  set,
  holdings,
  positions,
  assignedBySymbol,
  heldBySymbol,
  expanded,
  onToggle,
  onUpdate,
  onAssign,
  onUnassign,
  onRemove,
  onReload,
}: {
  goal: Goal
  set: ScenarioSet
  holdings: Array<{ id: string; symbol: string; quantity: number }>
  positions: ReturnType<typeof usePortfolio>['positions']
  assignedBySymbol: Map<string, number>
  heldBySymbol: Map<string, number>
  expanded: boolean
  onToggle: () => void
  onUpdate: (id: string, input: GoalInput) => Promise<{ error: string | null }>
  onAssign: (goalId: string, symbol: string, quantity: number) => Promise<{ error: string | null }>
  onUnassign: (id: string) => Promise<void>
  onRemove: (id: string) => Promise<void>
  onReload: () => Promise<void>
}) {
  const [symbol, setSymbol] = useState('')
  const [quantity, setQuantity] = useState('')
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)

  const value = Number(goal.current_value)
  const cost = Number(goal.cost_basis)
  const gain = value - cost
  const gainPct = cost > 0 ? (gain / cost) * 100 : 0
  const target = goal.target_amount ? Number(goal.target_amount) : null
  const progress = target && target > 0 ? Math.min(100, (value / target) * 100) : null
  const remaining = timeLeft(goal.target_date)

  const analysis = useMemo(() => analyzeGoal(goal, value, set), [goal, value, set])

  const assignToGoal = useCallback(
    async (sym: string, qty: number) => {
      const result = await onAssign(goal.id, sym, qty)
      if (!result.error) await onReload()
      return result
    },
    [goal.id, onAssign, onReload],
  )

  async function add(e: FormEvent) {
    e.preventDefault()
    setError('')
    const qty = Number(quantity)
    if (!symbol || !qty) return
    const { error: assignError } = await onAssign(goal.id, symbol, qty)
    if (assignError) setError(assignError)
    else {
      setSymbol('')
      setQuantity('')
    }
  }

  if (editing) {
    return (
      <li className="card p-5">
        <SectionTitle>Editar meta</SectionTitle>
        <GoalForm
          initial={goal}
          set={set}
          onCancel={() => setEditing(false)}
          onSubmit={async (input) => {
            const result = await onUpdate(goal.id, input)
            if (!result.error) setEditing(false)
            return result
          }}
        />
      </li>
    )
  }

  return (
    <li className="card p-5">
      <button type="button" onClick={onToggle} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          {/* min-w-0 + truncate: sin el truncate, un nombre largo empuja el
              monto fuera de la pantalla */}
          <div className="min-w-0 flex-1">
            <p className="text-primary flex items-center gap-2 text-[15px] font-semibold">
              <span className="shrink-0" aria-hidden>
                {goal.emoji ?? '🎯'}
              </span>
              <span className="truncate">{goal.name}</span>
            </p>
            {goal.description && (
              <p className="text-muted mt-0.5 truncate text-[12px]">{goal.description}</p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <p className="font-display tnum text-primary text-[19px] leading-none font-bold">
              {formatARS(value)}
            </p>
            {cost > 0 && (
              <p className={`tnum mt-1 text-[12px] ${toneText[toneOf(gain)]}`}>
                {formatPct(gainPct, 1)}
              </p>
            )}
          </div>
        </div>

        {/* Con meta de dinero: barra de progreso. Sin meta: solo lo acumulado,
            que para un ahorro a largo plazo es igual de informativo. */}
        {progress != null ? (
          <div className="mt-3">
            <div className="bg-elevated h-1.5 overflow-hidden rounded-full">
              <div
                className="gradient-accent h-full rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-muted mt-1.5 text-[12px]">
              {progress.toFixed(0)}% de {formatARS(target!)}
              {remaining ? ` · ${remaining}` : ''}
            </p>
          </div>
        ) : (
          (remaining || cost > 0) && (
            <p className="text-muted mt-2 text-[12px]">
              {cost > 0 ? `${formatARS(gain)} ganados` : ''}
              {cost > 0 && remaining ? ' · ' : ''}
              {remaining ?? ''}
            </p>
          )
        )}
      </button>

      <GoalDifficulty analysis={analysis} />

      {goal.reached_at && (
        <p className="text-muted mt-2 text-[11px]">
          Objetivo alcanzado el{' '}
          {new Date(goal.reached_at).toLocaleDateString('es-AR', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit',
          })}
          . La meta sigue sumando.
        </p>
      )}

      {goal.over_allocated && (
        <p className="bg-warning-soft text-warning mt-3 rounded-xl px-3 py-2 text-[12px] leading-relaxed">
          Vendiste parte de un activo asignado a esta meta. Ajustá las cantidades para que el valor
          vuelva a ser real.
        </p>
      )}

      {expanded && (
        <div className="border-subtle mt-4 border-t pt-4">
          {Number(goal.cash_ars) > 0 && (
            <p className="text-secondary mb-3 text-[12px]">
              {formatARS(Number(goal.cash_ars))} en efectivo, todavía sin invertir
            </p>
          )}

          {holdings.length > 0 ? (
            <ul className="space-y-2.5">
              {holdings.map((h) => {
                const position = positions.find((p) => p.symbol === h.symbol)
                return (
                  <li key={h.id} className="flex items-center gap-2.5">
                    <AssetLogo symbol={h.symbol} sector={position?.sector} size="sm" />
                    <span className="text-primary shrink-0 text-[13px] font-semibold">
                      {h.symbol}
                    </span>
                    <span className="text-muted tnum min-w-0 truncate text-[12px]">
                      {h.quantity}
                      {position ? ` de ${position.quantity}` : ''}
                    </span>
                    <span className="tnum text-secondary ml-auto shrink-0 text-[12px]">
                      {position ? formatARS(h.quantity * position.current_price) : '—'}
                    </span>
                    <button
                      type="button"
                      onClick={() => void onUnassign(h.id)}
                      className="text-muted active:text-loss shrink-0 px-1 text-[16px] leading-none"
                      aria-label={`Quitar ${h.symbol}`}
                    >
                      ×
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-muted text-[12px]">Todavía no asignaste activos a esta meta.</p>
          )}

          {/* Dos filas: el select toma su ancho mínimo del option más largo
              ("PRMCAPB (837)") y no entra en la misma línea que la cantidad y
              el botón */}
          <form onSubmit={add} className="mt-3 space-y-2">
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              required
              className="border-line bg-elevated text-primary w-full min-w-0 rounded-xl border px-3 py-2.5 text-[13px] outline-none"
            >
              <option value="">Activo…</option>
              {positions.map((p) => (
                <option key={p.symbol} value={p.symbol}>
                  {p.symbol} ({p.quantity})
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <input
                type="number"
                step="any"
                min="0"
                placeholder="Cantidad"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
                className="border-line bg-elevated text-primary min-w-0 flex-1 rounded-xl border px-3 py-2.5 text-[13px] outline-none"
              />
              <button
                type="submit"
                className="border-accent text-accent shrink-0 rounded-xl border px-4 text-[13px] font-medium"
              >
                Asignar
              </button>
            </div>
          </form>

          {error && <p className="text-loss mt-2 text-[12px] leading-relaxed">{error}</p>}

          <UnassignedPurchases
            assignedBySymbol={assignedBySymbol}
            heldBySymbol={heldBySymbol}
            onAssign={assignToGoal}
          />

          <GoalPlan
            goalId={goal.id}
            planGeneratedAt={goal.plan_generated_at}
            onGenerated={() => void onReload()}
          />

          <div className="mt-4 flex gap-4">
            <button type="button" onClick={() => setEditing(true)} className="text-accent text-[12px]">
              Editar meta
            </button>
            <button
              type="button"
              onClick={() => void onRemove(goal.id)}
              className="text-muted active:text-loss text-[12px]"
            >
              Eliminar
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

/** Mismo formulario para crear y para editar: una sola forma de escribir una meta */
function GoalForm({
  initial,
  set,
  onCancel,
  onSubmit,
}: {
  initial?: Goal
  set: ScenarioSet
  onCancel: () => void
  onSubmit: (input: GoalInput) => Promise<{ error: string | null }>
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [targetDate, setTargetDate] = useState(initial?.target_date ?? '')
  const [targetAmount, setTargetAmount] = useState(
    initial?.target_amount ? String(initial.target_amount) : '',
  )
  const [cash, setCash] = useState(initial?.cash_ars ? String(initial.cash_ars) : '')
  const [emoji, setEmoji] = useState(initial?.emoji ?? '🎯')
  const [error, setError] = useState('')

  // Vista previa de la dificultad mientras escribís, sin ida y vuelta al
  // servidor: es la información que evita cargar un objetivo imposible sin
  // enterarse
  const preview = useMemo(() => {
    const current = Number(initial?.current_value ?? 0) || Number(cash) || 0
    if (!targetAmount || !targetDate || current <= 0) return null
    return analyzeGoal(
      { target_amount: Number(targetAmount), target_date: targetDate },
      current,
      set,
    )
  }, [initial, cash, targetAmount, targetDate, set])

  async function submit(e: FormEvent) {
    e.preventDefault()
    // Vacío se guarda como null y no como undefined: al editar, undefined
    // dejaría el valor viejo en vez de borrarlo
    const { error: submitError } = await onSubmit({
      name,
      description: description || null,
      target_date: targetDate || null,
      target_amount: targetAmount ? Number(targetAmount) : null,
      cash_ars: cash ? Number(cash) : 0,
      emoji,
    })
    if (submitError) setError(submitError)
  }

  return (
    <form onSubmit={submit} className="space-y-2.5">
      <div className="flex gap-2">
        <input
          value={emoji}
          onChange={(e) => setEmoji(e.target.value.slice(0, 2))}
          className="border-line bg-elevated w-14 shrink-0 rounded-xl border px-3 py-2.5 text-center text-[16px] outline-none"
          aria-label="Emoji"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="Ahorro de Tomás"
          className="border-line bg-elevated text-primary min-w-0 flex-1 rounded-xl border px-3 py-2.5 text-[14px] outline-none"
        />
      </div>

      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Para el viaje de egresados"
        className="border-line bg-elevated text-primary w-full rounded-xl border px-3 py-2.5 text-[13px] outline-none"
      />

      {/* Apilados: un input[type=date] tiene un ancho intrínseco grande y dos
          campos en la misma fila se salían de la pantalla */}
      <input
        type="date"
        value={targetDate}
        onChange={(e) => setTargetDate(e.target.value)}
        className="border-line bg-elevated text-primary w-full rounded-xl border px-3 py-2.5 text-[13px] outline-none"
        aria-label="Fecha objetivo"
      />
      <input
        type="number"
        inputMode="decimal"
        value={targetAmount}
        onChange={(e) => setTargetAmount(e.target.value)}
        placeholder="Objetivo en $"
        className="border-line bg-elevated text-primary w-full rounded-xl border px-3 py-2.5 text-[13px] outline-none"
      />
      <input
        type="number"
        inputMode="decimal"
        min="0"
        value={cash}
        onChange={(e) => setCash(e.target.value)}
        placeholder="Efectivo a apartar en $"
        className="border-line bg-elevated text-primary w-full rounded-xl border px-3 py-2.5 text-[13px] outline-none"
      />

      {preview && <GoalDifficulty analysis={preview} />}

      <p className="text-muted text-[11px] leading-relaxed">
        La fecha y el objetivo son opcionales. Sin objetivo, la meta muestra cuánto acumulaste y
        cuánto ganaste — que para un ahorro largo suele ser lo que importa. El efectivo que apartes
        sale de tu saldo disponible: es una etiqueta, no una cuenta aparte.
      </p>

      {error && <p className="text-loss text-[12px] leading-relaxed">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="border-line text-secondary flex-1 rounded-xl border py-2.5 text-[13px]"
        >
          Cancelar
        </button>
        <button
          type="submit"
          className="gradient-accent flex-1 rounded-xl py-2.5 text-[13px] font-semibold text-white"
        >
          {initial ? 'Guardar' : 'Crear'}
        </button>
      </div>
    </form>
  )
}
