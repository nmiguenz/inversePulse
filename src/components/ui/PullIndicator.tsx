/** Indicador del pull-to-refresh: gira cuando está refrescando, y antes rota según el arrastre. */
export function PullIndicator({
  pull,
  refreshing,
  ready,
}: {
  pull: number
  refreshing: boolean
  ready: boolean
}) {
  if (pull <= 0 && !refreshing) return null

  return (
    <div
      className="pointer-events-none flex items-center justify-center overflow-hidden transition-[height]"
      style={{ height: pull, transitionDuration: refreshing ? '0ms' : '150ms' }}
    >
      <span
        className={`h-5 w-5 rounded-full border-2 ${
          refreshing
            ? 'border-strong border-t-accent animate-spin'
            : ready
              ? 'border-accent border-t-transparent'
              : 'border-strong border-t-transparent'
        }`}
        style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }}
      />
    </div>
  )
}
