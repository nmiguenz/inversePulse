export type ThemeChoice = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'iol-theme'

/**
 * El tema se aplica poniendo `data-theme` en el <html>, que a su vez fija
 * `color-scheme`. Todos los tokens usan light-dark(), así que con eso alcanza:
 * no hay que reemplazar clases ni recalcular nada en JS.
 *
 * 'system' borra el atributo y deja que mande la preferencia del sistema.
 */
export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement
  if (choice === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', choice)

  // El color de la barra del sistema en la PWA tiene que seguir al fondo real
  const dark =
    choice === 'dark' ||
    (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#06060A' : '#F4F5F7')
}

export function loadTheme(): ThemeChoice {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

export function saveTheme(choice: ThemeChoice) {
  if (choice === 'system') localStorage.removeItem(STORAGE_KEY)
  else localStorage.setItem(STORAGE_KEY, choice)
  applyTheme(choice)
}
