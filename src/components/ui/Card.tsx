import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return <section className={`card p-5 ${className}`}>{children}</section>
}

/**
 * Título de sección. Antes era mono en mayúsculas con tracking ancho — muy
 * "terminal". Ahora es texto normal con peso, que respira mejor y no compite
 * con los números, que son lo que importa.
 */
export function SectionTitle({
  icon,
  action,
  children,
}: {
  icon?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-3 px-1">
      <h2 className="text-primary flex items-center gap-2 text-[15px] font-semibold">
        {icon && (
          <span className="text-[13px]" aria-hidden>
            {icon}
          </span>
        )}
        {children}
      </h2>
      {action}
    </div>
  )
}

/**
 * Pantalla vacía.
 *
 * `action` es opcional pero cuando la pantalla está vacía porque falta hacer
 * algo, conviene ponerla: decirle a alguien "conectá tu cuenta" y dejarlo
 * buscando dónde es media explicación.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: string
  title: string
  description: string
  action?: { label: string; to: string }
}) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-14 text-center">
      <span className="text-3xl opacity-60" aria-hidden>
        {icon}
      </span>
      <p className="font-display text-primary text-[16px] font-semibold">{title}</p>
      <p className="text-secondary max-w-[30ch] text-[13px] leading-relaxed">{description}</p>
      {action && (
        <Link
          to={action.to}
          className="gradient-accent mt-3 rounded-xl px-5 py-2.5 text-[13px] font-semibold text-white"
        >
          {action.label}
        </Link>
      )}
    </div>
  )
}
