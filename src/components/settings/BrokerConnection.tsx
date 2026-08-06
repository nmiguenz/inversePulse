import { useState, type FormEvent } from 'react'
import { usePortfolio } from '@/hooks/usePortfolio'
import { invokeFunction } from '@/lib/functions'

/**
 * Conectar la cuenta de IOL.
 *
 * La API de IOL solo tiene login por usuario y contraseña: no hay OAuth ni
 * tokens de solo lectura. Así que la contraseña tiene que pasar una vez por el
 * servidor, y la pantalla lo dice con todas las letras en vez de esconderlo —
 * el token que se obtiene puede operar en la cuenta, y eso amerita que quien lo
 * entrega sepa qué está entregando.
 */
export function BrokerConnection() {
  const { iolStatus, reload } = usePortfolio()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)

  const connected = iolStatus?.is_connected

  async function connect(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await invokeFunction('connect-broker', { username, password })
      // La contraseña se limpia del estado apenas se usa
      setPassword('')
      setUsername('')
      setOpen(false)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo conectar')
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    setBusy(true)
    setError('')
    try {
      await invokeFunction('connect-broker', { action: 'disconnect' })
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo desconectar')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-primary text-[13px] font-medium">
            {connected ? 'Cuenta de IOL conectada' : 'Cuenta de IOL sin conectar'}
          </p>
          <p className="text-muted mt-0.5 text-[11px] leading-relaxed">
            {connected
              ? iolStatus?.account_label
                ? `${iolStatus.account_label} · sincroniza cada 5 minutos en horario de mercado.`
                : 'La app sincroniza tus posiciones y movimientos cada 5 minutos en horario de mercado.'
              : 'Sin conectar, el dashboard queda vacío: los datos salen de tu cuenta.'}
          </p>
        </div>
        <span
          className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${connected ? 'bg-gain' : 'bg-muted'}`}
          aria-hidden
        />
      </div>

      {iolStatus?.last_sync_error && (
        <p className="bg-warning-soft text-warning mt-3 rounded-xl px-3 py-2 text-[12px] leading-relaxed">
          {iolStatus.last_sync_error}
        </p>
      )}

      {connected && !open && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="border-line text-secondary flex-1 rounded-xl border py-2.5 text-[13px]"
          >
            Reconectar
          </button>
          <button
            type="button"
            onClick={() => void disconnect()}
            disabled={busy}
            className="border-line text-muted active:text-loss rounded-xl border px-4 py-2.5 text-[13px] disabled:opacity-50"
          >
            Desconectar
          </button>
        </div>
      )}

      {!connected && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="gradient-accent mt-3 w-full rounded-xl py-2.5 text-[13px] font-semibold text-white"
        >
          Conectar mi cuenta de IOL
        </button>
      )}

      {open && (
        <form onSubmit={connect} className="mt-3 space-y-2.5">
          <div className="bg-elevated rounded-xl px-3.5 py-3">
            <p className="text-secondary text-[12px] leading-relaxed">
              <strong className="text-primary">Tu contraseña no se guarda.</strong> Se usa una sola
              vez para pedirle un token a IOL y se descarta: en la base queda solo ese token,
              cifrado.
            </p>
            <p className="text-muted mt-2 text-[11px] leading-relaxed">
              Aun así, tenelo presente: ese token permite operar en tu cuenta, porque la API de IOL
              no ofrece uno de solo lectura. Podés desconectarla cuando quieras.
            </p>
          </div>

          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Usuario de IOL"
            autoComplete="username"
            required
            className="border-line bg-elevated text-primary w-full rounded-xl border px-3 py-2.5 text-[13px] outline-none"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Contraseña"
            autoComplete="current-password"
            required
            className="border-line bg-elevated text-primary w-full rounded-xl border px-3 py-2.5 text-[13px] outline-none"
          />

          {error && <p className="text-loss text-[12px] leading-relaxed">{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setPassword('')
                setError('')
              }}
              className="border-line text-secondary flex-1 rounded-xl border py-2.5 text-[13px]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="gradient-accent flex-1 rounded-xl py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Conectando…' : 'Conectar'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
