// ============== IDENTIFICAÇÃO DO ELEITOR ==============
// O eleitor NÃO recebe mais um token aleatório automaticamente ao abrir
// o app. O token só existe depois que o eleitor digita um código de
// votação válido (gerado pelo admin) e o backend o valida/consome via
// a função RPC `redeem_voter_code`. O token retornado é salvo aqui e
// passa a identificar o eleitor em todas as sessões da urna - do mesmo
// jeito que o token aleatório antigo, mas agora amarrado a um código de
// uso único, o que também bloqueia novas tentativas de voto com o
// mesmo código em qualquer outro dispositivo.
const TOKEN_KEY = 'voter_token'

export function getVoterToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || null
  } catch {
    return null
  }
}

export function hasVoterToken() {
  return !!getVoterToken()
}

export function setVoterToken(token) {
  try { localStorage.setItem(TOKEN_KEY, token) } catch (_) { /* ignore */ }
}

export function clearVoterToken() {
  try { localStorage.removeItem(TOKEN_KEY) } catch (_) { /* ignore */ }
}
