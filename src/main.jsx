import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { ENV_STATUS, CONFIG_ERROR } from './lib/supabase.js'
import './index.css'

// Log de diagnóstico (útil para debug no console do navegador)
console.log('%c[Urna Eletrônica]', 'color:#4f46e5;font-weight:bold', {
  env: {
    url: ENV_STATUS.url ? 'OK' : 'AUSENTE',
    key: ENV_STATUS.key ? 'OK' : 'AUSENTE',
    election: ENV_STATUS.election ? 'OK' : 'AUSENTE',
    ready: ENV_STATUS.ready
  },
  configError: CONFIG_ERROR || null
})

// Captura erros de execução e mostra na tela (defesa em profundidade)
window.addEventListener('error', (event) => {
  console.error('[Erro capturado]', event.error || event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Promise rejeitada]', event.reason)
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
