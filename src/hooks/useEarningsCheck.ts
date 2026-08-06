import { useEffect, useRef } from 'react'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { usePortfolio } from '@/hooks/usePortfolio'
import { missingEarnings, missingEarningsTitle } from '@/lib/earnings'

/**
 * Crea la alerta de fechas de resultados faltantes al abrir la app.
 *
 * El cron diario ya manda el push a las 9:00, pero solo si la app estaba
 * cerrada no lo ves hasta que entrás. Este chequeo hace que la alerta esté ahí
 * en el momento en que abrís, que es cuando podés hacer algo al respecto.
 *
 * Una por día: si abrís la app diez veces se crea una sola. Insiste todos los
 * días hasta que cargues la fecha.
 *
 * No manda push — el push es cosa del cron. Acá solo se crea la alerta in-app.
 */
export function useEarningsCheck() {
  const { session } = useAuth()
  const { positions, loading } = usePortfolio()
  // Un chequeo por sesión de la app: sin esto, cada cambio de posiciones por
  // realtime volvería a disparar la consulta
  const checked = useRef(false)

  useEffect(() => {
    if (!isSupabaseConfigured || !session || loading || checked.current) return
    // Sin posiciones sincronizadas todavía no hay nada que evaluar, y marcar
    // el chequeo como hecho perdería el aviso de esta sesión
    if (!positions.length) return

    checked.current = true
    void run()

    async function run() {
      const userId = session!.user.id
      // Fecha local: el calendario se carga con fechas de mercado, no UTC
      const today = new Date().toLocaleDateString('en-CA')

      const [{ data: calendar, error: calendarError }, { data: existing, error: alertError }] =
        await Promise.all([
          supabase
            .from('earnings_calendar')
            .select('symbol, is_reported')
            .gte('report_date', today),
          supabase
            .from('alerts')
            .select('id')
            .eq('user_id', userId)
            .eq('alert_type', 'earnings_missing')
            .gte('created_at', `${today}T00:00:00-03:00`)
            .limit(1),
        ])

      // Si alguna consulta falla no se inserta nada: crear la alerta con un
      // calendario que no se pudo leer avisaría de fechas que sí están
      // cargadas, y saltear el chequeo de duplicados la repetiría en cada
      // apertura.
      if (calendarError || alertError) {
        console.error(
          '[useEarningsCheck] no se pudo verificar:',
          calendarError?.message ?? alertError?.message,
        )
        return
      }

      if ((existing ?? []).length) return

      const missing = missingEarnings(positions, calendar ?? [])
      if (!missing.length) return

      const list = missing.join(', ')
      await supabase.from('alerts').insert({
        user_id: userId,
        alert_type: 'earnings_missing',
        symbol: missing.length === 1 ? missing[0] : null,
        title: missingEarningsTitle(missing),
        message:
          `Sin fecha cargada no hay aviso previo al reporte, y los earnings suelen mover ` +
          `el precio con fuerza. Cargalas en Config → Earnings: ${list}.`,
        severity: 'info',
        action_suggested: `Cargar fecha de resultados: ${list}`,
      })
    }
  }, [session, positions, loading])
}
