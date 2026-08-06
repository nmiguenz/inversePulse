import type { TypeSlice } from '@/lib/portfolio'
import { useCurrency } from '@/lib/currency'

/**
 * Chips de filtro por tipo de instrumento.
 *
 * Cada uno muestra cuánto pesa, así se elige sabiendo qué hay adentro en vez de
 * tener que entrar para averiguarlo.
 */
export function TypeFilter({
  types,
  active,
  onChange,
  total,
}: {
  types: TypeSlice[]
  active: string | null
  onChange: (type: string | null) => void
  total: number
}) {
  const { format } = useCurrency()

  // Con un solo tipo el filtro no aporta nada
  if (types.length < 2) return null

  return (
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
      <Chip active={active === null} onClick={() => onChange(null)}>
        Todos
        <span className="ml-1.5 opacity-70">{format(total)}</span>
      </Chip>

      {types.map((t) => (
        <Chip key={t.type} active={active === t.type} onClick={() => onChange(t.type)}>
          {t.label}
          <span className="ml-1.5 opacity-70">{t.pct.toFixed(0)}%</span>
        </Chip>
      ))}
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`tnum shrink-0 rounded-full border px-3.5 py-2 text-[13px] whitespace-nowrap transition-colors ${
        active
          ? 'border-accent bg-accent-soft text-accent font-medium'
          : 'border-line bg-elevated text-secondary active:bg-hover'
      }`}
    >
      {children}
    </button>
  )
}
