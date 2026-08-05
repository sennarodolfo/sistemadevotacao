import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { supabase, setElectionId } from '../lib/supabase'
import { setVoterToken, getVoterToken, clearVoterToken } from '../lib/api'
import CodeEntryScreen from './CodeEntryScreen'
import VotingScreen from './VotingScreen'
import SessionDoneScreen from './SessionDoneScreen'
import SessionReceiptScreen from './SessionReceiptScreen'
import FinalScreen from './FinalScreen'

// ============================================================
// Fluxo de votação a partir do LINK PRÓPRIO de uma sessão
// (ex: https://seuprojeto.vercel.app/nome-da-sessao).
//
// Diferente do fluxo clássico (App.jsx), esta tela NUNCA reaproveita
// um voter_token guardado no navegador: cada janela aberta com o link
// de uma sessão SEMPRE exige que o código seja digitado de novo. Como
// o token é determinístico (derivado do código, ver migração 0002/0010),
// digitar o mesmo código em janelas diferentes identifica o MESMO
// eleitor - e o banco (unique voter_token+session_id) garante que ele
// só pode votar UMA VEZ nesta sessão especificamente, mesmo que o
// código continue válido para outras sessões em outras janelas/links.
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
  const [electionMeta, setElectionMeta] = useState(null) // { id, name, code_digits, totalActiveSessions }
  const [session, setSession] = useState(null)
  const [lastResult, setLastResult] = useState(null)
  const [isLastPending, setIsLastPending] = useState(false)
  const [finalReceipt, setFinalReceipt] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    resolveLink()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  // "Modo urna" para esta janela: evita sair sem querer pelo botão
  // Voltar do navegador e avisa antes de fechar/atualizar a aba,
  // igual ao fluxo clássico (ver App.jsx).
  useEffect(() => {
    if (!['code', 'voting', 'done', 'sessionReceipt'].includes(phase)) return
    function trapBack() { window.history.pushState(null, '', window.location.href) }
    window.history.pushState(null, '', window.location.href)
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
        code_digits: data.code_digits,
        totalActiveSessions: data.total_active_sessions
      })
      setSession(data.session)
      // Sempre exige o código de novo nesta janela - nunca reaproveita
      // um token de uma sessão votada em outra aba/link.
      clearVoterToken()
      setPhase('code')
    } catch (e) {
      setError(e.message || 'Erro ao carregar o link de votação')
      setPhase('error')
    }
  }

  // Depois que o código é validado, confere se ESTA sessão específica
  // já foi votada com ele (o eleitor pode ter recarregado a página ou
  // reaberto o link por engano) - se sim, mostra o resultado já
  // registrado em vez de deixar votar de novo.
  async function handleCodeValidated() {
    setError('')
    try {
      const token = getVoterToken()
      const { data: status, error: statusErr } = await supabase.rpc('get_voter_status', {
        p_election_id: electionMeta.id,
        p_voter_token: token
      })
      if (statusErr) throw statusErr
      const completed = status?.completed || []
      const already = completed.find(c => c.session_id === session.id)
      const allDone = electionMeta.totalActiveSessions != null && completed.length >= electionMeta.totalActiveSessions
      if (already) {
        setLastResult({
          voted_candidates: already.voted_candidates,
          blank_count: already.blank_count,
          session_receipt: already.receipt_code
        })
        setIsLastPending(allDone)
        setPhase('done')
        return
      }
      setPhase('voting')
    } catch (e) {
      setError(e.message || 'Erro ao verificar seu status de votação')
      setPhase('error')
    }
  }

  async function handleVoted({ result }) {
    setLastResult(result)
    try {
      const token = getVoterToken()
      const { data: status } = await supabase.rpc('get_voter_status', {
        p_election_id: electionMeta.id,
        p_voter_token: token
      })
      const completedCount = (status?.completed || []).length
      setIsLastPending(electionMeta.totalActiveSessions != null && completedCount >= electionMeta.totalActiveSessions)
    } catch (_) {
      setIsLastPending(false)
    }
    setPhase('done')
  }

  async function handleFinalize() {
    setError('')
    try {
      const token = getVoterToken()
      const { data, error: rpcErr } = await supabase.rpc('finalize_election', {
        p_election_id: electionMeta.id,
        p_voter_token: token
      })
      if (rpcErr) throw rpcErr
      if (data?.error) {
        // Ainda há outras sessões pendentes (votadas em outras janelas
        // que ainda não foram concluídas) - não é um erro real, só
        // significa que este código ainda não pode ser bloqueado.
        setPhase('done')
        return
      }
      setFinalReceipt(data)
      setPhase('final')
    } catch (e) {
      setError(e.message || 'Erro ao finalizar a votação')
      setPhase('error')
    }
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
        infoText={<>Este link vale só para <b>{session.title}</b>. O código pode ser usado em outras sessões desta eleição (cada uma com seu próprio link), mas apenas <b>uma vez em cada uma</b>.</>}
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

  if (phase === 'done') {
    return (
      <SessionDoneScreen
        session={session}
        result={lastResult}
        isLast={isLastPending}
        standalone
        onFinalize={handleFinalize}
        onViewReceipt={() => setPhase('sessionReceipt')}
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

  if (phase === 'final' && finalReceipt) {
    return (
      <FinalScreen
        election={{ name: electionMeta.name }}
        receipt={finalReceipt}
        standalone
      />
    )
  }

  return null
}
