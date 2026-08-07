import { useEffect, useState } from 'react'
import { ADVISOR_HOURS_UTC } from '@/lib/schedule'

/**
 * Los horarios en que corre el asesor, en la hora del dispositivo.
 *
 * ── Por qué se convierte desde UTC ───────────────────────────────────────
 *
 * El cron de pg_cron trabaja en UTC. Antes la app mostraba "11:00 y 16:00"
 * hardcodeado, que es correcto solo para alguien en Buenos Aires. Ahora se
 * parte de la hora UTC real del cron y la convierte el navegador, así que quien
 * esté en otro huso ve la suya.
 *
 * ── Verde y gris ─────────────────────────────────────────────────────────
 *
 * Verde el que todavía no pasó hoy, gris el que ya corrió. De un vistazo se
 * sabe si lo que estás viendo es el análisis de hoy o falta uno.
 */
export function ScheduleStrip() {
  // Se recalcula cada minuto: si no, un horario que pasa mientras la pantalla
  // está abierta se quedaría en verde hasta recargar
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const slots = ADVISOR_HOURS_UTC.map((utcHour) => {
    // Se arma la hora de HOY en UTC y se deja que el navegador la muestre en
    // local, sin hacer aritmética de husos a mano
    const at = new Date(now)
    at.setUTCHours(utcHour, 0, 0, 0)
    return {
      label: at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
      done: at.getTime() <= now.getTime(),
    }
  })

  const isWeekend = now.getDay() === 0 || now.getDay() === 6

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
      <span className="text-muted text-[11px]">Analiza a las</span>
      {slots.map((s, i) => (
        <span key={i} className="flex items-center gap-1">
          <span
            className={`h-1.5 w-1.5 rounded-full ${s.done ? 'bg-muted' : 'bg-gain'}`}
            aria-hidden
          />
          <span
            className={`tnum text-[11px] font-medium ${s.done ? 'text-muted' : 'text-gain'}`}
            title={s.done ? 'Ya corrió hoy' : 'Todavía no corrió hoy'}
          >
            {s.label}
          </span>
        </span>
      ))}
      <span className="text-muted text-[11px]">
        {isWeekend ? '· solo días hábiles, hoy no corre' : '· de lunes a viernes'}
      </span>
    </div>
  )
}
