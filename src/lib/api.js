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

// ============== VOTOS MANUAIS (mesário, #votacaomanual) ==============
// Cada cédula de papel computada pelo mesário precisa de um voter_token
// PRÓPRIO e único (para reaproveitar a mesma função submit_vote usada
// pelos eleitores digitais, sem violar a regra de "um voto por token por
// sessão"). Este token nunca é salvo em localStorage - existe só na
// memória durante o registro daquela cédula.
export function generateManualBallotToken() {
  const arr = new Uint8Array(16)
  crypto.getRandomValues(arr)
  return 'manual-' + Array.from(arr, b => b.toString(16).padStart(2, '0')).join('')
}
