import { useState } from 'react'
import { sectorColor } from '@/lib/sectors'

/**
 * Logo de la empresa, con cadena de respaldo.
 *
 * parqet devuelve SVG (escala perfecto y sirve igual en claro y oscuro) y cubre
 * 22 de los 23 tickers de la cartera y el universo. FMP entra como segundo
 * intento en PNG. Si ninguno responde, quedan las iniciales sobre el color del
 * sector — nunca un ícono roto.
 */
const SOURCES = [
  (symbol: string) => `https://assets.parqet.com/logos/symbol/${symbol}`,
  (symbol: string) => `https://financialmodelingprep.com/image-stock/${symbol}.png`,
]

const SIZES = { sm: 'h-6 w-6 text-[9px]', md: 'h-8 w-8 text-[11px]', lg: 'h-10 w-10 text-[13px]' }

export function AssetLogo({
  symbol,
  sector = 'Otros',
  size = 'md',
}: {
  symbol: string
  sector?: string
  size?: keyof typeof SIZES
}) {
  const [attempt, setAttempt] = useState(0)
  const exhausted = attempt >= SOURCES.length

  const shell = `${SIZES[size]} shrink-0 overflow-hidden rounded-full`

  if (exhausted) {
    return (
      <span
        className={`${shell} flex items-center justify-center font-mono font-semibold text-white`}
        style={{ background: sectorColor(sector) }}
        aria-hidden
      >
        {symbol.slice(0, 2)}
      </span>
    )
  }

  return (
    <span className={`${shell} bg-elevated flex items-center justify-center`}>
      <img
        // key fuerza el remonte al cambiar de fuente; sin esto el browser puede
        // no reintentar la carga con el src nuevo
        key={attempt}
        src={SOURCES[attempt](symbol)}
        alt=""
        loading="lazy"
        onError={() => setAttempt((a) => a + 1)}
        className="h-full w-full object-contain"
      />
    </span>
  )
}
