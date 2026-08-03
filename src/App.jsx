import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase, ELECTION_ID, ENV_STATUS, CONFIG_ERROR } from './lib/supabase'
import { getVoterToken, clearVoterToken } from './lib/api'
import { Icon } from './components/Icon'
import WelcomeScreen from './views/WelcomeScreen'
import CodeEntryScreen from './views/CodeEntryScreen'
import VotingScreen from './views/VotingScreen'
import SessionDoneScreen from './views/SessionDoneScreen'
import FinalScreen from './views/FinalScreen'
import AdminLogin from './views/AdminLogin'
import AdminPanel from './views/AdminPanel'
import ManualVotingScreen from './views/ManualVotingScreen'
import PublicResultsScreen from './views/PublicResultsScreen'

function ConfigError({ message }) {
  return (
    <div className="min-h-screen gradient-bg flex items-center justify-center p-4">
      <div className="glass card-shadow rounded-2xl p-8 max-w-xl w-full fade-in">
        <div className="flex items-center gap-3 mb-4">
          <div className="bg-amber-100 p-3 rounded-xl">
            <Icon name="settings" className="w-6 h-6 text-amber-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Configuração necessária</h1>
            <p className="text-sm text-slate-500">O sistema ainda não foi configurado para produção</p>
          </div>
        </div>
        <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-lg text-sm mb-4">
          <p className="font-semibold mb-2">{message}</p>
          <p className="mt-3">Para hospedar este sistema na Vercel ou Netlify você precisa definir 3 variáveis de ambiente no painel da plataforma:</p>
          <ul className="list-disc ml-5 mt-2 space-y-1 font-mono text-xs">
            <li>VITE_SUPABASE_URL</li>
            <li>VITE_SUPABASE_ANON_KEY</li>
            <li>VITE_ELECTION_ID</li>
          </ul>
          <p className="mt-3">Consulte o <b>GUIA_INSTALACAO.pdf</b> (na pasta <code>docs/</code>) ou o README para o passo a passo completo.</p>
        </div>
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer font-medium">Diagnóstico técnico</summary>
          <div className="mt-2 space-y-1 font-mono bg-slate-100 p-3 rounded">
            <div>VITE_SUPABASE_URL: {ENV_STATUS.url ? '✅ configurado' : '❌ ausente'}</div>
            <div>VITE_SUPABASE_ANON_KEY: {ENV_STATUS.key ? '✅ configurado' : '❌ ausente'}</div>
            <div>VITE_ELECTION_ID: {ENV_STATUS.election ? '✅ configurado' : '❌ ausente'}</div>
          </div>
        </details>
      </div>
    </div>
  )
}

function LoadingScreen() {
  return (
    <div className="min-h-screen gradient-bg flex items-center justify-center">
      <div className="text-white text-center">
        <div className="animate-spin w-12 h-12 border-4 border-white/30 border-t-white rounded-full mx-auto mb-4" />
        <p>Carregando...</p>
      </div>
    </div>
  )
}

function ErrorScreen({ error, onRetry }) {
  return (
    <div className="min-h-screen gradient-bg flex items-center justify-center p-4">
      <div className="glass card-shadow rounded-2xl p-8 max-w-md w-full text-center fade-in">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Icon name="x" className="w-8 h-8 text-red-600" />
        </div>
        <h1 className="text-xl font-bold text-slate-800 mb-2">Erro ao carregar</h1>
        <p className="text-slate-600 mb-4 text-sm">{error}</p>
        <button onClick={onRetry} className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700">
          Tentar novamente
        </button>
      </div>
    </div>
  )
}

// Telas do fluxo do ELEITOR (não inclui admin/adminLogin/loading/error) onde
// o "modo urna" (bloqueio de voltar + aviso de atualização) fica ativo.
const KIOSK_LOCK_SCREENS = ['welcome', 'codeEntry', 'voting', 'sessionDone', 'final']

const PUBLIC_RESULTS_HASH_PREFIX = '#resultadospublicos:'

export default function App() {
  const [screen, setScreen] = useState('loading')
  const [election, setElection] = useState(null)
  const [error, setError] = useState('')
  const [voterStatus, setVoterStatus] = useState({ completed: [], final_receipt: null })
  const [currentSessionIdx, setCurrentSessionIdx] = useState(0)
  const [lastVotedSessionId, setLastVotedSessionId] = useState(null)
  const [lastVotedResult, setLastVotedResult] = useState(null)
  const [finalReceipt, setFinalReceipt] = useState(null)
  const [publicResultsSessionId, setPublicResultsSessionId] = useState('')
  const [adminAuthOk, setAdminAuthOk] = useState(() => sessionStorage.getItem('admin_auth') === '1')
  const [manualAuthOk, setManualAuthOk] = useState(() => sessionStorage.getItem('manual_auth') === '1')
  const tapCount = useRef(0)
  const tapTimer = useRef(null)

  // Sincroniza tela com o hash da URL (#admin, #votacaomanual ou #resultadospublicos:<sessionId>)
  useEffect(() => {
    function syncHash() {
      const hash = window.location.hash
      if (hash === '#admin') {
        setScreen(adminAuthOk ? 'admin' : 'adminLogin')
      } else if (hash === '#votacaomanual') {
        setScreen(manualAuthOk ? 'manualVoting' : 'manualVotingLogin')
      } else if (hash.startsWith(PUBLIC_RESULTS_HASH_PREFIX)) {
        setPublicResultsSessionId(hash.slice(PUBLIC_RESULTS_HASH_PREFIX.length))
        setScreen('publicResults')
      }
    }
    syncHash()
    window.addEventListener('hashchange', syncHash)
    return () => window.removeEventListener('hashchange', syncHash)
  }, [adminAuthOk, manualAuthOk])

  // Verificação inicial (uma única vez)
  useEffect(() => {
    if (!ENV_STATUS.ready) {
      setError(CONFIG_ERROR)
      setScreen('configError')
      return
    }
    loadElection()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ===== "Modo urna": impede que o eleitor saia da votação sem querer =====
  // 1) Botão Voltar do navegador: como é um SPA (nunca troca de página de
  //    verdade), reempurramos o mesmo estado no histórico sempre que o
  //    evento popstate dispara. O eleitor simplesmente permanece na MESMA
  //    tela em que estava.
  // 2) Atualizar (F5) ou fechar a aba: navegadores não permitem que uma
  //    página bloqueie isso de forma programática (por segurança do
  //    usuário) - o máximo possível é acionar o diálogo nativo de
  //    confirmação "Sair do site?" via beforeunload, que é o que fazemos.
  // Fica ativo só nas telas do eleitor, nunca durante a administração.
  useEffect(() => {
    if (!KIOSK_LOCK_SCREENS.includes(screen)) return

    function trapBack() {
      window.history.pushState(null, '', window.location.href)
    }
    window.history.pushState(null, '', window.location.href)
    window.addEventListener('popstate', trapBack)

    function warnBeforeUnload(e) {
      e.preventDefault()
      e.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)

    return () => {
      window.removeEventListener('popstate', trapBack)
      window.removeEventListener('beforeunload', warnBeforeUnload)
    }
  }, [screen])

  async function loadElection() {
    try {
      setError('')
      setScreen('loading')
      const { data, error: rpcErr } = await supabase.rpc('get_public_election', {
        p_election_id: ELECTION_ID
      })
      if (rpcErr) throw rpcErr
      if (!data) throw new Error('Eleição não encontrada. Verifique se o seed foi executado no Supabase e se o VITE_ELECTION_ID está correto.')
      setElection(data)

      // Rotas administrativas/de apoio têm prioridade sobre o fluxo do
      // eleitor: mesmo que este navegador tenha um voter_token guardado
      // (ex: quem administra também já votou nele antes), essas telas
      // nunca devem ser desviadas para o comprovante do eleitor.
      if (window.location.hash === '#admin') {
        setScreen(adminAuthOk ? 'admin' : 'adminLogin')
        return
      }
      if (window.location.hash === '#votacaomanual') {
        setScreen(manualAuthOk ? 'manualVoting' : 'manualVotingLogin')
        return
      }
      if (window.location.hash.startsWith(PUBLIC_RESULTS_HASH_PREFIX)) {
        setPublicResultsSessionId(window.location.hash.slice(PUBLIC_RESULTS_HASH_PREFIX.length))
        setScreen('publicResults')
        return
      }

      // Só existe voter_token depois que o eleitor digita um código de
      // votação válido (ver CodeEntryScreen). Antes disso não há status
      // a consultar - o eleitor começa do zero.
      const token = getVoterToken()
      if (token) {
        const { data: status, error: statusErr } = await supabase.rpc('get_voter_status', {
          p_election_id: ELECTION_ID,
          p_voter_token: token
        })
        if (statusErr) throw statusErr
        setVoterStatus(status || { completed: [], final_receipt: null })

        if (status?.final_receipt) {
          setFinalReceipt(status.final_receipt)
          setScreen('final')
          return
        }
      } else {
        setVoterStatus({ completed: [], final_receipt: null })
      }
      setScreen('welcome')
    } catch (e) {
      const msg = e?.message || 'Erro ao carregar a eleição'
      if (/fetch|network|failed|abort|invalid|timeout|invalid_api_key/i.test(msg)) {
        setError('Não foi possível conectar ao Supabase. Verifique se o VITE_SUPABASE_URL está correto, se o projeto Supabase está ativo e se a chave anon é válida.')
      } else {
        setError(msg)
      }
      setScreen('error')
    }
  }

  function handleSecretTap() {
    tapCount.current += 1
    if (tapTimer.current) clearTimeout(tapTimer.current)
    tapTimer.current = setTimeout(() => { tapCount.current = 0 }, 2500)
    if (tapCount.current >= 5) {
      tapCount.current = 0
      if (tapTimer.current) clearTimeout(tapTimer.current)
      openAdmin()
    }
  }

  function openAdmin() {
    if (adminAuthOk) setScreen('admin')
    else setScreen('adminLogin')
  }

  function handleAdminLogin(password) {
    setAdminAuthOk(true)
    sessionStorage.setItem('admin_auth', '1')
    if (password) sessionStorage.setItem('admin_pwd', password)
    setScreen('admin')
  }

  function handleAdminLogout() {
    setAdminAuthOk(false)
    sessionStorage.removeItem('admin_auth')
    sessionStorage.removeItem('admin_pwd')
    // Limpa o hash para não voltar a exigir senha por causa do hashchange
    if (window.location.hash === '#admin') {
      try { history.replaceState(null, '', window.location.pathname + window.location.search) } catch (_) {}
    }
    setScreen('welcome')
  }

  // A votação manual tem senha PRÓPRIA, independente da senha de admin
  // (ver aba "Segurança" no painel admin para trocá-la).
  function handleManualLogin(password) {
    setManualAuthOk(true)
    sessionStorage.setItem('manual_auth', '1')
    if (password) sessionStorage.setItem('manual_pwd', password)
    setScreen('manualVoting')
  }

  function handleManualLogout() {
    setManualAuthOk(false)
    sessionStorage.removeItem('manual_auth')
    sessionStorage.removeItem('manual_pwd')
    if (window.location.hash === '#votacaomanual') {
      try { history.replaceState(null, '', window.location.pathname + window.location.search) } catch (_) {}
    }
    setScreen('welcome')
  }

  // "Concluir e Liberar Sistema" na página do mesário: encerra a sessão
  // da votação manual e volta para a urna.
  function handleManualVotingClose() {
    handleManualLogout()
  }

  // Inicia a votação. Se o eleitor ainda não tem um token (isto é, ainda
  // não digitou um código de votação válido nesta urna/dispositivo),
  // primeiro pede o código de 4 dígitos. Se já tem token, vai direto
  // para a PRIMEIRA sessão ainda não votada.
  function handleStart() {
    if (!getVoterToken()) {
      setScreen('codeEntry')
      return
    }
    const nextIdx = findNextPendingIdx(election, voterStatus.completed)
    setCurrentSessionIdx(nextIdx)
    setScreen('voting')
  }

  // Chamado pela CodeEntryScreen após validar (e consumir) o código com
  // sucesso. O token já foi salvo em localStorage nesse ponto - o eleitor
  // é sempre "novo" neste momento (nenhuma sessão concluída ainda).
  function handleCodeValidated() {
    setVoterStatus({ completed: [], final_receipt: null })
    setCurrentSessionIdx(0)
    setScreen('voting')
  }

  // Após terminar uma sessão, vai para a próxima pendente
  async function handleNextSession() {
    if (!election) return
    const nextIdx = findNextPendingIdx(election, voterStatus.completed)
    if (nextIdx === -1) {
      // Não há mais sessões pendentes -> finalizar
      await handleFinalize()
      return
    }
    setCurrentSessionIdx(nextIdx)
    setScreen('voting')
  }

  // Encontra o índice da primeira sessão ainda não votada
  function findNextPendingIdx(el, completed) {
    if (!el || !el.sessions) return 0
    for (let i = 0; i < el.sessions.length; i++) {
      if (!completed.some(c => c.session_id === el.sessions[i].id)) {
        return i
      }
    }
    return -1
  }

  async function handleVoted({ sessionId, result }) {
    const newCompleted = [...voterStatus.completed, { session_id: sessionId, ...result }]
    setVoterStatus({ ...voterStatus, completed: newCompleted })
    setLastVotedSessionId(sessionId)
    setLastVotedResult(result)
    setScreen('sessionDone')
  }

  async function handleFinalize() {
    try {
      const token = getVoterToken()
      const { data, error: rpcErr } = await supabase.rpc('finalize_election', {
        p_election_id: ELECTION_ID,
        p_voter_token: token
      })
      if (rpcErr) throw rpcErr
      if (data?.error) throw new Error(data.error)
      setFinalReceipt(data)
      setVoterStatus({ ...voterStatus, final_receipt: data })
      setScreen('final')
    } catch (e) {
      setError(e.message || 'Erro ao finalizar a votação')
      setScreen('error')
    }
  }

  // Reseta TODA a urna (após finalizar ou via "Votar novamente")
  // Isso só limpa o token local: o código já usado continua marcado como
  // usado no banco, então um novo eleitor precisa de um NOVO código.
  function handleFullReset() {
    clearVoterToken()
    setVoterStatus({ completed: [], final_receipt: null })
    setFinalReceipt(null)
    setCurrentSessionIdx(0)
    setLastVotedSessionId(null)
    setLastVotedResult(null)
    loadElection()
  }

  // Atualiza dados do admin SEM mudar de tela
  const handleAdminDataChanged = useCallback(async () => {
    try {
      const { data, error: rpcErr } = await supabase.rpc('get_public_election', {
        p_election_id: ELECTION_ID
      })
      if (!rpcErr && data) {
        setElection(data)
      }
    } catch (_) { /* silencioso */ }
  }, [])

  if (screen === 'configError') return <ConfigError message={error} />
  if (screen === 'loading') return <LoadingScreen />
  if (screen === 'error') return <ErrorScreen error={error} onRetry={loadElection} />

  if (screen === 'adminLogin') {
    return <AdminLogin onLogin={handleAdminLogin} onBack={() => setScreen('welcome')} />
  }

  if (screen === 'admin') {
    return (
      <AdminPanel
        election={election}
        setElection={setElection}
        onLogout={handleAdminLogout}
        onDataChanged={handleAdminDataChanged}
        onGoToWelcome={() => setScreen('welcome')}
      />
    )
  }

  if (screen === 'manualVotingLogin') {
    return (
      <AdminLogin
        title="Votação Manual"
        subtitle="Acesso restrito ao mesário"
        verifyRpc="verify_manual"
        onLogin={handleManualLogin}
        onBack={() => { try { history.replaceState(null, '', window.location.pathname + window.location.search) } catch (_) {} setScreen('welcome') }}
      />
    )
  }

  if (screen === 'manualVoting') {
    return (
      <ManualVotingScreen
        election={election}
        onClose={handleManualVotingClose}
      />
    )
  }

  if (screen === 'publicResults') {
    return (
      <PublicResultsScreen
        electionName={election?.name}
        initialSessionId={publicResultsSessionId}
      />
    )
  }

  if (screen === 'welcome') {
    return (
      <WelcomeScreen
        election={election}
        voterStatus={voterStatus}
        onStart={handleStart}
        onAdminRequest={openAdmin}
        onSecretTap={handleSecretTap}
        onResetVoterToken={() => { clearVoterToken(); loadElection() }}
      />
    )
  }

  if (screen === 'codeEntry') {
    return (
      <CodeEntryScreen
        election={election}
        onValidated={handleCodeValidated}
        onBack={() => setScreen('welcome')}
      />
    )
  }

  if (screen === 'voting' && election) {
    const session = election.sessions[currentSessionIdx]
    if (!session) {
      // Índice inválido -> finalizar
      handleFinalize()
      return null
    }
    return (
      <VotingScreen
        election={election}
        session={session}
        onVoted={handleVoted}
      />
    )
  }

  if (screen === 'sessionDone' && election && lastVotedSessionId) {
    const session = election.sessions.find(s => s.id === lastVotedSessionId)
    const totalSessions = election.sessions.length
    const nextIdx = findNextPendingIdx(election, voterStatus.completed)
    const isLast = nextIdx === -1
    return (
      <SessionDoneScreen
        session={session}
        result={lastVotedResult}
        isLast={isLast}
        onNext={handleNextSession}
        onFinalize={handleFinalize}
      />
    )
  }

  if (screen === 'final' && finalReceipt) {
    return (
      <FinalScreen
        election={election}
        receipt={finalReceipt}
        onReset={handleFullReset}
      />
    )
  }

  return null
}
