import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

/**
 * Sin esto, cualquier excepción en el render desmonta TODA la app y deja la
 * pantalla en negro, sin bottom nav — es decir, sin forma de volver.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[app] error no capturado:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="bg-base flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <span className="text-3xl" aria-hidden>
          ⚠️
        </span>
        <h1 className="font-display text-primary text-[17px] font-semibold">Algo se rompió</h1>
        <p className="text-secondary max-w-[34ch] text-[13px] leading-relaxed">
          La pantalla no se pudo dibujar. El detalle está abajo y también en la consola.
        </p>
        <pre className="border-line bg-surface text-loss max-w-full overflow-x-auto rounded-xl border p-3 text-left font-mono text-[11px]">
          {error.message}
        </pre>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="border-line text-secondary rounded-full border px-4 py-2 text-[13px]"
          >
            Reintentar
          </button>
          <button
            type="button"
            onClick={() => {
              window.location.href = '/'
            }}
            className="gradient-accent rounded-full px-4 py-2 text-[13px] font-medium text-white"
          >
            Volver al inicio
          </button>
        </div>
      </div>
    )
  }
}
