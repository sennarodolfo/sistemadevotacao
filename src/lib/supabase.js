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

// A partir da versão multiusuário, VITE_ELECTION_ID deixou de ser
// obrigatório: cada usuário cria suas próprias eleições pelo Dashboard
// e o ID efetivo vem do link de votação/administração acessado (ver
// setElectionId abaixo) - não mais de uma variável fixa no deploy.
// Continua funcionando normalmente como "eleição padrão" para quem
// ainda usa o sistema no modo clássico de uma eleição só.
export const ENV_STATUS = {
  url: !!ENV_URL && !PLACEHOLDER_URL,
  key: !!ENV_KEY && !PLACEHOLDER_KEY,
  election: !!ENV_ELECTION && !PLACEHOLDER_ELECTION,
  ready: !!ENV_URL && !!ENV_KEY && !PLACEHOLDER_URL && !PLACEHOLDER_KEY
}

export const CONFIG_ERROR = PLACEHOLDER_URL
  ? 'VITE_SUPABASE_URL ausente ou com valor de exemplo. Defina a URL do seu projeto Supabase (ex: https://abc.supabase.co) na Vercel/Netlify.'
  : PLACEHOLDER_KEY
  ? 'VITE_SUPABASE_ANON_KEY ausente ou com valor de exemplo. Defina a chave anon do seu projeto Supabase na Vercel/Netlify.'
  : ''

// Cliente Supabase: nunca quebra o boot. Se as variáveis estiverem
// inválidas, criamos um cliente "stub" apontando para um host inválido -
// as chamadas vão falhar, mas o módulo não quebra e o sistema mostra
// a tela de erro "Configuração necessária".
// auth.persistSession/autoRefreshToken: true - necessário para as
// CONTAS DE USUÁRIO (Supabase Auth) do Dashboard multiusuário; o
// eleitor comum nunca faz login, então isso não afeta o fluxo dele.
export const supabase = createClient(
  ENV_URL || 'https://invalid.supabase.invalid',
  ENV_KEY || 'invalid-anon-key-for-boot',
  {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
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

// ============== Eleição ativa (dinâmica, multiusuário) ==============
// Antes, ELECTION_ID era uma constante fixa vinda do build. Agora é um
// valor MUTÁVEL, trocado em tempo de execução conforme a URL acessada
// (link de votação de uma eleição específica, painel admin daquela
// eleição, etc - ver App.jsx). ENV_ELECTION continua servindo de valor
// inicial para quem ainda roda no modo clássico de uma eleição só.
//
// Todo o resto do app importa `ELECTION_ID` como se fosse uma constante
// (`import { ELECTION_ID } from '../lib/supabase'`) e lê seu valor
// dentro de funções/handlers - graças ao binding "ao vivo" dos módulos
// ES, essas leituras sempre pegam o valor MAIS RECENTE, então trocar a
// eleição ativa aqui reflete automaticamente em todo o app, sem precisar
// mudar a assinatura de nenhum componente existente.
let activeElectionId = PLACEHOLDER_ELECTION ? '' : ENV_ELECTION

export function setElectionId(id) {
  activeElectionId = id || ''
}

export function getElectionId() {
  return activeElectionId
}

export { activeElectionId as ELECTION_ID }
