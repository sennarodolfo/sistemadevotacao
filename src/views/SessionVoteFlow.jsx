import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { supabase, setElectionId } from '../lib/supabase'
import { getVoterToken, clearVoterToken } from '../lib/api'
import CodeEntryScreen from './CodeEntryScreen'
import VotingScreen from './VotingScreen'
import SessionReceiptScreen from './SessionReceiptScreen'

// ============================================================
// Fluxo de votação a partir do LINK PRÓPRIO de uma sessão
// (ex: https://seuprojeto.vercel.app/nome-da-sessao).
//
// Cada sessão é INDEPENDENTE: tem seu próprio código de acesso, seu
// próprio comprovante (código VS-...) e sua própria tela de encerramento
// - nada aqui faz referência a outras sessões da eleição. Esta janela
// NUNCA reaproveita um voter_token guardado no navegador: sempre exige
// que o código seja digitado de novo. O banco garante (unique
// voter_token+session_id) que o mesmo código só pode ser usado uma
// única vez nesta sessão.
// ============================================================

const RESOLVE_ERROR_MESSAGES = {
  not_found: 'Link inválido ou sessão não encontrada. Confira o endereço com quem organizou a votação.'
}

function CenteredMessage({ icon, title, children, tone = 'neutral' }) {
  const iconBg = tone === 'error' ? 'bg-red-100 text-red-600' : 'bg-indigo-100 text-indigo-600'
  return (
    <div className="min-h-screen gradient-bg flex items-center justify-center p-4">
      <div className="glass card-shadow rounded-2xl p-8 max-w-md w-full text-center fade-in">
        <div className={`w-16 h-16 ${iconBg} rounded-full flex items-center justify-center mx-auto mb-4`}>
          <Icon name={icon} className="w-8 h-8" />
        </div>
        <h1 className="text-xl font-bold text-slate-800 mb-2">{title}</h1>
        <div className="text-slate-600 text-sm">{children}</div>
      </div>
    </div>
  )
}

function LoadingBlock() {
  return (
    <div className="min-h-screen gradient-bg flex items-center justify-center">
      <div className="text-white text-center">
        <div className="animate-spin w-12 h-12 border-4 border-white/30 border-t-white rounded-full mx-auto mb-4" />
        <p>Carregando sessão...</p>
      </div>
    </div>
  )
}

export default function SessionVoteFlow({ slug }) {
  const [phase, setPhase] = useState('resolving')
  const [electionMeta, setElectionMeta] = useState(null) // { id, name, code_digits }
  const [session, setSession] = useState(null)
  const [lastResult, setLastResult] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    resolveLink()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  // "Modo urna" só enquanto o voto ainda não foi confirmado - evita
  // sair sem querer pelo botão Voltar do navegador ou fechar a aba no
  // meio da votação. Empurra UMA entrada de histórico só na primeira
  // vez (nunca a cada troca de tela), pra não acumular histórico e
  // atrapalhar o fechamento automático da aba depois, no comprovante.
  const historyGuardedRef = useRef(false)
  useEffect(() => {
    if (!['code', 'voting'].includes(phase)) return
    if (!historyGuardedRef.current) {
      window.history.pushState(null, '', window.location.href)
      historyGuardedRef.current = true
    }
    function trapBack() { window.history.pushState(null, '', window.location.href) }
    window.addEventListener('popstate', trapBack)
    function warnBeforeUnload(e) { e.preventDefault(); e.returnValue = ''; return '' }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => {
      window.removeEventListener('popstate', trapBack)
      window.removeEventListener('beforeunload', warnBeforeUnload)
    }
  }, [phase])

  async function resolveLink() {
    setPhase('resolving')
    setError('')
    try {
      const { data, error: rpcErr } = await supabase.rpc('resolve_session_link', { p_slug: slug })
      if (rpcErr) throw rpcErr
      if (!data || data.error) {
        setPhase('notfound')
        return
      }
      setElectionId(data.election_id)
      setElectionMeta({
        id: data.election_id,
        name: data.election_name,
        code_digits: data.code_digits
      })
      setSession(data.session)
      // Sempre exige o código de novo nesta janela.
      clearVoterToken()
      setPhase('code')
    } catch (e) {
      setError(e.message || 'Erro ao carregar o link de votação')
      setPhase('error')
    }
  }

  // Depois que o código é validado, confere se ESTA sessão já foi
  // votada com ele (recarregou a página, reabriu o link) - se sim,
  // mostra direto o comprovante já emitido em vez de deixar votar de novo.
  async function handleCodeValidated() {
    setError('')
    try {
      const token = getVoterToken()
      const { data: status, error: statusErr } = await supabase.rpc('get_voter_status', {
        p_election_id: electionMeta.id,
        p_voter_token: token
      })
      if (statusErr) throw statusErr
      const already = (status?.completed || []).find(c => c.session_id === session.id)
      if (already) {
        setLastResult({
          voted_candidates: already.voted_candidates,
          blank_count: already.blank_count,
          session_receipt: already.receipt_code
        })
        setPhase('sessionReceipt')
        return
      }
      setPhase('voting')
    } catch (e) {
      setError(e.message || 'Erro ao verificar seu status de votação')
      setPhase('error')
    }
  }

  function handleVoted({ result }) {
    setLastResult(result)
    setPhase('sessionReceipt')
  }

  if (phase === 'resolving') return <LoadingBlock />

  if (phase === 'notfound') {
    return (
      <CenteredMessage icon="x" title="Sessão não encontrada" tone="error">
        {RESOLVE_ERROR_MESSAGES.not_found}
      </CenteredMessage>
    )
  }

  if (phase === 'error') {
    return (
      <CenteredMessage icon="x" title="Erro ao carregar" tone="error">
        <p className="mb-4">{error}</p>
        <button onClick={resolveLink} className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700">
          Tentar novamente
        </button>
      </CenteredMessage>
    )
  }

  if (phase === 'code') {
    return (
      <CodeEntryScreen
        election={{ name: electionMeta.name, code_digits: electionMeta.code_digits }}
        onValidated={handleCodeValidated}
        hideBack
        subtitle={<>Digite o código de {Math.min(8, Math.max(4, electionMeta.code_digits || 4))} dígitos fornecido pela mesa para votar em <b>{session.title}</b> ({electionMeta.name}).</>}
        infoText={<>O código dá acesso à votação de <b>{session.title}</b> e só pode ser usado <b>uma única vez</b> nesta sessão.</>}
      />
    )
  }

  if (phase === 'voting') {
    return (
      <VotingScreen
        election={{ name: electionMeta.name }}
        session={session}
        onVoted={handleVoted}
      />
    )
  }

  if (phase === 'sessionReceipt') {
    return (
      <SessionReceiptScreen
        electionName={electionMeta.name}
        session={session}
        result={lastResult}
        standalone
      />
    )
  }

  return null
}
