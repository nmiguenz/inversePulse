import { useCallback, useEffect, useState } from 'react'
import { AssetLogo } from '@/components/ui/AssetLogo'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { formatARS, formatPct, toneOf, toneText } from '@/lib/format'
import type { MarketQuote, Recommendation } from '@/lib/types'

type CashFund = {
  symbol: string
  description: string | null
  current_price: number
  market_value: number | null
}

type Meta = { symbol: string; display_name: string | null; index_membership: string[] | null }

/**
 * Qué hacer con el efectivo parado, dentro de la alerta que lo avisa.
 *
 * ── Qué se muestra y qué NO ──────────────────────────────────────────────
 *
 * Todo lo que aparece acá son HECHOS: precio de hoy, variación del día y de la
 * semana, cuántas unidades comprás con lo que tenés. No hay rendimientos
 * esperados ni rankings de "lo que más va a subir", porque eso no se sabe.
 *
 * La única excepción son las recomendaciones del asesor, que sí son
 * estimaciones — y van marcadas como tales, en su propio bloque.
 *
 * El orden importa: primero lo que no tiene riesgo de precio, después lo que
 * sí. Poner los CEDEARs arriba porque "rinden más" sería sugerir que el
 * rendimiento es comparable, y no lo es.
 */
export function IdleCashOptions() {
  const { session } = useAuth()
  const [funds, setFunds] = useState<CashFund[]>([])
  const [quotes, setQuotes] = useState<MarketQuote[]>([])
  const [meta, setMeta] = useState<Map<string, Meta>>(new Map())
  const [held, setHeld] = useState<Set<string>>(new Set())
  const [recs, setRecs] = useState<Recommendation[]>([])
  const [cash, setCash] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!session) return

    // Los money market de verdad. `is_cash_equivalent` existe justamente
    // porque el plazo de rescate no alcanza para distinguirlos: un fondo de
    // commodities también rescata en el día y no es caja.
    const { data: cashSymbols } = await supabase
      .from('asset_metadata')
      .select('symbol')
      .eq('is_cash_equivalent', true)

    const cashSet = (cashSymbols ?? []).map((c) => c.symbol)

    const [
      { data: positions },
      { data: quoteRows },
      { data: metaRows },
      { data: recRows },
      { data: balance },
    ] = await Promise.all([
        supabase
          .from('positions')
          .select('symbol, description, current_price, market_value')
          .eq('user_id', session.user.id),
        supabase
          .from('market_quotes')
          .select('*')
          .not('daily_change_pct', 'is', null)
          .order('daily_change_pct', { ascending: false })
          .limit(60),
        supabase.from('asset_metadata').select('symbol, display_name, index_membership'),
        supabase
          .from('recommendations')
          .select('*')
          .eq('user_id', session.user.id)
          .eq('is_active', true)
          .in('action', ['buy', 'add'])
          .is('goal_id', null)
          .order('confidence'),
        // El saldo de AHORA, no el que traía el mensaje de la alerta: entre que
        // se creó y la abrís pudo cambiar, y "te alcanza para N unidades" con
        // un saldo viejo es peor que no decir nada
        supabase
          .from('account_balance')
          .select('available_ars, available_to_trade_ars')
          .eq('user_id', session.user.id)
          .maybeSingle(),
    ])

    setCash(balance?.available_to_trade_ars ?? balance?.available_ars ?? 0)

    setFunds(((positions ?? []) as CashFund[]).filter((p) => cashSet.includes(p.symbol)))
    setHeld(new Set((positions ?? []).map((p) => p.symbol)))
    setQuotes((quoteRows ?? []) as MarketQuote[])
    setMeta(new Map((metaRows ?? []).map((m) => [m.symbol, m as Meta])))
    setRecs((recRows ?? []) as Recommendation[])
    setLoading(false)
  }, [session])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) return <div className="bg-elevated mt-3 h-24 animate-pulse rounded-xl" />

  const units = (price: number) => (price > 0 ? Math.floor(cash / price) : 0)
  const affordable = quotes.filter((q) => units(q.price) >= 1).slice(0, 6)

  return (
    <div className="border-subtle mt-4 space-y-4 border-t pt-4">
      <p className="text-muted text-[11px] leading-relaxed">
        Con {formatARS(cash)} disponibles. Los porcentajes son lo que ya pasó, no lo que va a
        pasar.
      </p>

      {/* ── 1. Sin riesgo de precio ───────────────────────────────────── */}
      {funds.length > 0 && (
        <div>
          <p className="text-primary text-[12px] font-semibold">Sin riesgo, rescate el mismo día</p>
          <p className="text-muted mt-0.5 text-[11px] leading-relaxed">
            Deja de estar parado sin dejar de estar disponible. Es lo que conviene si esa plata la
            podés necesitar.
          </p>
          <ul className="mt-2 space-y-2">
            {funds.map((f) => (
              <li key={f.symbol} className="flex items-center gap-2.5">
                <span className="bg-elevated flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px]">
                  💵
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-primary truncate text-[13px] font-semibold">
                    {f.description ?? f.symbol}
                  </p>
                  <p className="text-muted text-[11px]">
                    {f.market_value ? `ya tenés ${formatARS(f.market_value)}` : f.symbol}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── 2. Lo que sugiere el asesor ───────────────────────────────── */}
      <div>
        <p className="text-primary text-[12px] font-semibold">Lo que sugiere el asesor</p>
        {recs.length > 0 ? (
          <ul className="mt-2 space-y-2.5">
            {recs.slice(0, 3).map((r) => (
              <li key={r.id} className="flex items-start gap-2.5">
                <AssetLogo symbol={r.symbol} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-primary text-[13px] font-semibold">
                    {r.symbol}
                    <span className="text-muted ml-2 text-[11px] font-normal">
                      convicción {r.confidence === 'high' ? 'alta' : r.confidence === 'medium' ? 'media' : 'baja'}
                    </span>
                  </p>
                  <p className="text-secondary mt-0.5 text-[11px] leading-relaxed">{r.title}</p>
                  {r.suggested_amount != null && (
                    <p className="text-muted tnum mt-0.5 text-[11px]">
                      sugiere {formatARS(r.suggested_amount)}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted mt-1 text-[11px] leading-relaxed">
            No hay sugerencias vigentes. El asesor analiza dos veces por día y solo guarda algo
            cuando ve fundamento — que no haya nada también es información.
          </p>
        )}
        <p className="text-muted mt-1.5 text-[11px] leading-relaxed">
          Esto sí son estimaciones de una IA, no hechos. Verificá antes de operar.
        </p>
      </div>

      {/* ── 3. Datos del mercado ──────────────────────────────────────── */}
      {affordable.length > 0 && (
        <div>
          <p className="text-primary text-[12px] font-semibold">Los que más subieron hoy</p>
          <p className="text-muted mt-0.5 text-[11px] leading-relaxed">
            Del universo que la app sigue, filtrado por lo que te alcanza a comprar. Que haya
            subido hoy no dice nada de mañana.
          </p>
          <ul className="mt-2 space-y-2">
            {affordable.map((q) => {
              const m = meta.get(q.symbol)
              const inIndex = m?.index_membership?.includes('SP500_TOP50')
              return (
                <li key={q.symbol} className="flex items-center gap-2.5">
                  <AssetLogo symbol={q.symbol} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-primary flex items-center gap-1.5 truncate text-[13px] font-semibold">
                      {q.symbol}
                      {inIndex && (
                        <span
                          className="bg-accent-soft text-accent rounded px-1 text-[9px] font-medium"
                          title="Entre las 50 mayores del S&P 500"
                        >
                          S&P50
                        </span>
                      )}
                      {held.has(q.symbol) && (
                        <span className="text-muted text-[10px] font-normal">ya tenés</span>
                      )}
                    </p>
                    <p className="text-muted tnum text-[11px]">
                      {formatARS(q.price)} · te alcanza para {units(q.price)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`tnum text-[12px] font-medium ${toneText[toneOf(q.daily_change_pct ?? 0)]}`}>
                      {formatPct(q.daily_change_pct ?? 0, 1)}
                    </p>
                    <p className="text-muted text-[10px]">
                      {q.week_change_pct == null
                        ? 'semana s/d'
                        : `${formatPct(q.week_change_pct, 1)} sem`}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
