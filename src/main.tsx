import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { setupPWA } from './pwa'
import { applyTheme, loadTheme } from './lib/theme'
import './index.css'

// Antes del primer render: si el tema guardado difiere del sistema, aplicarlo
// después haría un flash del tema equivocado
applyTheme(loadTheme())
setupPWA()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
