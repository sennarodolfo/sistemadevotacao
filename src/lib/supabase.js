import { createClient } from '@supabase/supabase-js'

// Lê as variáveis de ambiente do Vite. Em produção (Vercel/Netlify) elas
// DEVEM estar configuradas no painel da plataforma, senão o sistema
// mostra uma tela de erro amigável.
const ENV_URL = (import.meta.env.VITE_SUPABASE_URL || '').trim()
const ENV_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()
const ENV_ELECTION = (import.meta.env.VITE_ELECTION_ID || '').trim()

// Detecta se o usuário esqueceu de trocar o valor placeholder.
const PLACEHOLDER_URL = !ENV_URL || ENV_URL.includes('SEU_PROJETO') || ENV_URL === 'http://localhost:8000'
const PLACEHOLDER_KEY = !ENV_KEY || ENV_KEY.includes('SEU_JWT') || ENV_KEY.includes('SEU_JWT_AQUI')
const PLACEHOLDER_ELECTION = !ENV_ELECTION || ENV_ELECTION === '00000000-0000-0000-0000-000000000000'

export const ENV_STATUS = {
  url: !!ENV_URL && !PLACEHOLDER_URL,
  key: !!ENV_KEY && !PLACEHOLDER_KEY,
  election: !!ENV_ELECTION && !PLACEHOLDER_ELECTION,
  ready: !!ENV_URL && !!ENV_KEY && !!ENV_ELECTION
    && !PLACEHOLDER_URL && !PLACEHOLDER_KEY && !PLACEHOLDER_ELECTION
}

export const CONFIG_ERROR = PLACEHOLDER_URL
  ? 'VITE_SUPABASE_URL ausente ou com valor de exemplo. Defina a URL do seu projeto Supabase (ex: https://abc.supabase.co) na Vercel/Netlify.'
  : PLACEHOLDER_KEY
  ? 'VITE_SUPABASE_ANON_KEY ausente ou com valor de exemplo. Defina a chave anon do seu projeto Supabase na Vercel/Netlify.'
  : PLACEHOLDER_ELECTION
  ? 'VITE_ELECTION_ID ausente ou igual ao placeholder. Rode o seed no Supabase, copie o UUID da eleição e defina na Vercel/Netlify.'
  : ''

// Cliente Supabase: nunca quebra o boot. Se as variáveis estiverem
// inválidas, criamos um cliente "stub" apontando para um host inválido -
// as chamadas vão falhar, mas o módulo não quebra e o sistema mostra
// a tela de erro "Configuração necessária".
export const supabase = createClient(
  ENV_URL || 'https://invalid.supabase.invalid',
  ENV_KEY || 'invalid-anon-key-for-boot',
  {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers: { 'x-application-name': 'votacao-eletronica' },
      fetch: (...args) => {
        // Timeout de 8s para evitar loading infinito quando o Supabase não responde.
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 8000)
        return fetch(args[0], { ...args[1], signal: controller.signal })
          .finally(() => clearTimeout(timeout))
      }
    }
  }
)

export const ELECTION_ID = ENV_ELECTION
