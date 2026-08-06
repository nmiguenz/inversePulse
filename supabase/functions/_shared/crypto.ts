/**
 * Cifrado de credenciales ajenas.
 *
 * ── Por qué, y por qué así ───────────────────────────────────────────────
 *
 * Los tokens de IOL y las keys de Anthropic ya son inaccesibles desde el
 * cliente: sus tablas no tienen policy de SELECT y solo las tocan las Edge
 * Functions con la service role key. El cifrado es la capa de más, y con
 * credenciales de OTRAS personas corresponde ponerla — sobre todo cuando el
 * token de IOL puede operar en la cuenta.
 *
 * La clave vive en `CREDENTIALS_ENCRYPTION_KEY`, un secret de las funciones,
 * **fuera de la base**. Es la diferencia que importa: si alguien se lleva un
 * dump de Postgres, no le sirve de nada. Guardarla con pgsodium/Vault dejaría
 * el material de clave en el mismo lugar que los datos que protege.
 *
 * AES-GCM con IV aleatorio por cifrado. El formato es `iv.ciphertext`, ambos
 * en base64url.
 */

const ALGO = 'AES-GCM'
const IV_BYTES = 12

let cached: CryptoKey | null = null

async function getKey(): Promise<CryptoKey> {
  if (cached) return cached

  const raw = Deno.env.get('CREDENTIALS_ENCRYPTION_KEY')
  if (!raw) {
    throw new Error(
      'Falta el secret CREDENTIALS_ENCRYPTION_KEY. Generalo con: openssl rand -base64 32',
    )
  }

  const bytes = base64ToBytes(raw)
  if (bytes.length !== 32) {
    throw new Error(
      `CREDENTIALS_ENCRYPTION_KEY tiene ${bytes.length} bytes y AES-256 necesita 32. ` +
        'Generala con: openssl rand -base64 32',
    )
  }

  cached = await crypto.subtle.importKey('raw', bytes, ALGO, false, ['encrypt', 'decrypt'])
  return cached
}

function base64ToBytes(b64: string): Uint8Array {
  const normalized = b64.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normalized)
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function encrypt(plaintext: string): Promise<string> {
  const key = await getKey()
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGO, iv },
    key,
    new TextEncoder().encode(plaintext),
  )

  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(ciphertext))}`
}

export async function decrypt(payload: string): Promise<string> {
  const [ivPart, dataPart] = payload.split('.')
  if (!ivPart || !dataPart) {
    throw new Error('El valor cifrado no tiene el formato iv.ciphertext')
  }

  const key = await getKey()
  const plaintext = await crypto.subtle.decrypt(
    { name: ALGO, iv: base64ToBytes(ivPart) },
    key,
    base64ToBytes(dataPart),
  )

  return new TextDecoder().decode(plaintext)
}

/**
 * Descifra tolerando el valor en claro.
 *
 * Existe solo para la transición: las filas anteriores a la 0019 tienen el
 * token sin cifrar. Se detecta por el formato —un valor cifrado siempre tiene
 * un punto separando dos bloques base64url— y se devuelve tal cual. En cuanto
 * el sync reescribe la fila, queda cifrada.
 */
export async function decryptOrPlain(value: string | null): Promise<string | null> {
  if (!value) return null
  if (!value.includes('.')) return value

  try {
    return await decrypt(value)
  } catch {
    // Un JWT también tiene puntos: si no descifra, era texto plano
    return value
  }
}
