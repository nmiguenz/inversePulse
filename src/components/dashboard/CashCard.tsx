import { useState } from 'react'
import { formatARS } from '@/lib/format'
import type { AccountBalance } from '@/lib/types'

/**
 * Traducción de los plazos de liquidación de IOL.
 *
 * La documentación solo confirma "Inmediato"; el resto se mapea por lo que se
 * ve en datos reales, normalizando para tolerar variantes de escritura. Si
 * aparece una etiqueta desconocida se muestra tal cual en vez de esconderla.
 */
function settlementLabel(raw: string): { label: string; hint: string } {
  const key = raw.toLowerCase().replace(/[\s_-]/g, '')

  if (key.includes('inmediat')) {
    return { label: 'Disponible hoy', hint: 'Podés usarlo ahora mismo' }
  }
  if (key.includes('24')) {
    return { label: 'Se acredita en 24 h', hint: 'De una venta que todavía no liquidó' }
  }
  if (key.includes('48')) {
    return { label: 'Se acredita en 48 h', hint: 'De una venta que todavía no liquidó' }
  }
  return { label: raw, hint: 'Plazo informado por IOL' }
}

export function CashCard({ balance }: { balance: AccountBalance | null }) {
  const [open, setOpen] = useState(false)

  const available = balance?.available_ars ?? 0
  const toTrade = balance?.available_to_trade_ars
  const committed = balance?.committed_ars ?? 0
  const breakdown = balance?.settlement_breakdown ?? []

  // Solo tiene sentido desplegar si hay algo que contar
  const hasDetail = breakdown.length > 0 || committed > 0

  return (
    <div className="card p-5">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        className="w-full text-left"
        disabled={!hasDetail}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-secondary text-[12px]">Efectivo</p>
            <p className="font-display tnum text-primary mt-1.5 text-[20px] leading-none font-bold">
              {formatARS(available, true)}
            </p>
          </div>
          {hasDetail && (
            <span className="text-muted mt-1 text-[12px]">{open ? 'Ocultar' : 'Ver detalle'}</span>
          )}
        </div>

        {/* Si lo operable difiere del total, esa es la información importante:
            es lo que realmente podés poner en una orden hoy */}
        {toTrade != null && Math.abs(toTrade - available) > 1 ? (
          <p className="text-muted mt-1.5 text-[12px]">
            {formatARS(toTrade)} listos para operar
          </p>
        ) : (
          <p className="text-muted mt-1.5 text-[12px]">
            {committed > 0 ? `${formatARS(committed)} comprometido en órdenes` : 'sin rendir'}
          </p>
        )}
      </button>

      {open && (
        <div className="border-subtle mt-4 space-y-3 border-t pt-4">
          {breakdown.map((row, i) => {
            const { label, hint } = settlementLabel(row.liquidacion)
            return (
              <div key={`${row.liquidacion}-${i}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-primary text-[13px] font-medium">{label}</span>
                  <span className="tnum text-primary text-[13px] font-semibold">
                    {formatARS(row.disponible ?? 0)}
                  </span>
                </div>
                <p className="text-muted mt-0.5 text-[11px]">{hint}</p>

                {/* disponibleOperar puede ser menor que disponible: parte del
                    saldo puede estar afectado a garantías */}
                {row.disponibleOperar != null &&
                  Math.abs(row.disponibleOperar - (row.disponible ?? 0)) > 1 && (
                    <p className="text-muted mt-0.5 text-[11px]">
                      {formatARS(row.disponibleOperar)} operables
                    </p>
                  )}
              </div>
            )
          })}

          {committed > 0 && (
            <div className="border-subtle border-t pt-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-primary text-[13px] font-medium">Comprometido</span>
                <span className="tnum text-warning text-[13px] font-semibold">
                  {formatARS(committed)}
                </span>
              </div>
              <p className="text-muted mt-0.5 text-[11px]">
                Reservado por órdenes puestas que todavía no se ejecutaron
              </p>
            </div>
          )}

          {balance?.available_usd ? (
            <div className="border-subtle border-t pt-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-primary text-[13px] font-medium">En dólares</span>
                <span className="tnum text-primary text-[13px] font-semibold">
                  US$ {balance.available_usd.toLocaleString('es-AR', { maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
