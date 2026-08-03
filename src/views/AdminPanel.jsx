import { useState, useEffect, useRef } from 'react'
import { Icon } from '../components/Icon'
import PhotoLightbox from '../components/PhotoLightbox'
import { fileToResizedDataUrl } from '../lib/imageResize'
import { supabase, ELECTION_ID } from '../lib/supabase'
import { downloadCodesPdf } from '../lib/codesPdf'
import { downloadManualBallotsPdf } from '../lib/manualBallotPdf'
import ResultsView from './ResultsView'

const CODE_ERROR_MESSAGES = {
  invalid_quantity: 'Quantidade inválida.',
  quantity_too_large: 'Quantidade máxima de 5000 códigos por geração.'
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

// Identifica a origem de um voter_token (eleitor via código próprio ou
// mesário via cédula manual) e extrai o código de 4 dígitos, para exibir
// na aba Auditoria. Formatos: 'code-<election_id>-XXXX' (eleitor) e
// 'mcode-<election_id>-XXXX' (cédula manual).
function describeVoterOrigin(token) {
  if (!token) return { label: 'Desconhecida', code: '—', badgeClass: 'bg-slate-100 text-slate-600' }
  if (token.startsWith('mcode-')) {
    return { label: 'Mesário (manual)', code: token.split('-').pop(), badgeClass: 'bg-purple-100 text-purple-700' }
  }
  if (token.startsWith('code-')) {
    return { label: 'Eleitor', code: token.split('-').pop(), badgeClass: 'bg-indigo-100 text-indigo-700' }
  }
  return { label: 'Outro', code: '—', badgeClass: 'bg-slate-100 text-slate-600' }
}

function adminPassword() {
  return sessionStorage.getItem('admin_pwd') || ''
}

function setAdminPassword(p) {
  sessionStorage.setItem('admin_pwd', p)
}

export default function AdminPanel({ election, setElection, onLogout, onDataChanged, onGoToWelcome }) {
  const [tab, setTab] = useState('general')
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState('success')
  const [results, setResults] = useState([])
  const [resultsSessionId, setResultsSessionId] = useState(null)
  const [receipts, setReceipts] = useState([])
  const [sessions, setSessions] = useState([])
  const [editingSession, setEditingSession] = useState(null)
  const [showSessionModal, setShowSessionModal] = useState(false)
  const [newPwd, setNewPwd] = useState('')
  const [oldPwd, setOldPwd] = useState('')
  const [newManualPwd, setNewManualPwd] = useState('')
  const [electionForm, setElectionForm] = useState(null)
  const [tempElectionName, setTempElectionName] = useState('')
  const fileInputRef = useRef(null)

  // ===== Códigos de votação =====
  const [codeQuantity, setCodeQuantity] = useState(50)
  const [codeStats, setCodeStats] = useState({ total: 0, used: 0, available: 0 })
  const [codeList, setCodeList] = useState([])
  const [lastBatch, setLastBatch] = useState([])
  const [generatingCodes, setGeneratingCodes] = useState(false)
  const [codeSearch, setCodeSearch] = useState('')
  const [codeActionBusy, setCodeActionBusy] = useState(false)

  // ===== Cédulas manuais (mesário) =====
  const [manualCodeQuantity, setManualCodeQuantity] = useState(50)
  const [manualCodeStats, setManualCodeStats] = useState({ total: 0, used: 0, available: 0 })
  const [manualCodeList, setManualCodeList] = useState([])
  const [manualLastBatch, setManualLastBatch] = useState([])
  const [generatingManualCodes, setGeneratingManualCodes] = useState(false)
  const [manualCodeSearch, setManualCodeSearch] = useState('')
  const [manualCodeActionBusy, setManualCodeActionBusy] = useState(false)

  useEffect(() => {
    if (election) {
      setSessions(election.sessions || [])
      setElectionForm({
        name: election.name,
        location_name: election.location_name
      })
      setTempElectionName(election.name)
    }
  }, [election])

  function showMessage(msg, type = 'success') {
    setMessage(msg)
    setMessageType(type)
    setTimeout(() => setMessage(''), 4000)
  }

  async function callAdmin(fn, args) {
    const pwd = adminPassword()
    const { data, error } = await supabase.rpc(fn, { p_election_id: ELECTION_ID, p_password: pwd, ...args })
    if (error) throw error
    if (data && data.error === 'unauthorized') throw new Error('Senha expirou - faça login novamente')
    return data
  }

  // Recarrega os dados SEM mudar de tela
  async function refreshData() {
    try {
      const { data, error: rpcErr } = await supabase.rpc('get_public_election', {
        p_election_id: ELECTION_ID
      })
      if (!rpcErr && data) {
        setElection(data)
      }
    } catch (_) { /* silencioso */ }
  }

  async function saveGeneral(e) {
    if (e) e.preventDefault()
    try {
      // Usa o nome digitado (tempElectionName) em vez do que veio de election
      const finalName = (tempElectionName || '').trim() || electionForm.name
      const updatedForm = { ...electionForm, name: finalName }
      await callAdmin('admin_update_election', {
        p_name: finalName,
        p_location_name: updatedForm.location_name
      })
      setElectionForm(updatedForm)
      showMessage('Configurações salvas')
      // Atualiza dados sem trocar de tela
      await refreshData()
    } catch (e) { showMessage('Erro: ' + e.message, 'error') }
  }

  async function changePassword() {
    if (newPwd.length < 4) return showMessage('Mínimo de 4 caracteres', 'error')
    try {
      const { data, error } = await supabase.rpc('admin_change_password', {
        p_election_id: ELECTION_ID,
        p_old_password: oldPwd,
        p_new_password: newPwd
      })
      if (error) throw error
      if (!data) throw new Error('Senha atual incorreta')
      setAdminPassword(newPwd)
      setNewPwd('')
      setOldPwd('')
      showMessage('Senha alterada')
    } catch (e) { showMessage('Erro: ' + e.message, 'error') }
  }

  async function changeManualPassword() {
    if (newManualPwd.length < 4) return showMessage('Mínimo de 4 caracteres', 'error')
    try {
      const data = await callAdmin('admin_change_manual_password', { p_new_password: newManualPwd })
      if (!data) throw new Error('Não foi possível alterar a senha')
      setNewManualPwd('')
      showMessage('Senha da votação manual alterada')
    } catch (e) { showMessage('Erro: ' + e.message, 'error') }
  }

  async function openSessionsTab() {
    setTab('sessions')
    try {
      const data = await callAdmin('admin_get_results', {})
      setResults(data || [])
      if (data && data.length > 0) setResultsSessionId(data[0].session_id)
    } catch (e) { showMessage('Erro: ' + e.message, 'error') }
  }

  async function openResultsTab() {
    setTab('results')
    try {
      const data = await callAdmin('admin_get_results', {})
      setResults(data || [])
      if (data && data.length > 0) setResultsSessionId(data[0].session_id)
    } catch (e) { showMessage('Erro: ' + e.message, 'error') }
  }

  async function openAuditTab() {
    setTab('audit')
    try {
      const data = await callAdmin('admin_list_receipts', {})
      setReceipts(data || [])
    } catch (e) { showMessage('Erro: ' + e.message, 'error') }
  }

  async function openCodesTab() {
    setTab('codes')
    await refreshCodes()
  }

  async function refreshCodes() {
    try {
      const data = await callAdmin('admin_list_codes', {})
      if (data?.error) throw new Error(data.error)
      setCodeList(data.codes || [])
      setCodeStats({
        total: data.total || 0,
        used: data.used || 0,
        available: data.available || 0
      })
    } catch (e) { showMessage('Erro: ' + e.message, 'error') }
  }

  async function generateCodes() {
    const qty = parseInt(codeQuantity)
    if (!qty || qty < 1) return showMessage('Informe uma quantidade válida', 'error')
    if (qty > 5000) return showMessage('Máximo de 5000 códigos por geração', 'error')
    setGeneratingCodes(true)
    try {
      const data = await callAdmin('admin_generate_codes', { p_quantity: qty })
      if (data?.error) throw new Error(CODE_ERROR_MESSAGES[data.error] || data.error)
      setLastBatch(data.codes || [])
      const generated = data.generated || 0
      if (generated < qty) {
        showMessage(`Apenas ${generated} de ${qty} código(s) puderam ser gerados (limite de combinações de 4 dígitos disponíveis nesta urna).`, 'error')
      } else {
        showMessage(`${generated} código(s) gerado(s) com sucesso`)
      }
      await refreshCodes()
    } catch (e) { showMessage('Erro: ' + e.message, 'error') }
    finally { setGeneratingCodes(false) }
  }

  function downloadLastBatchPdf() {
    if (lastBatch.length === 0) return showMessage('Nenhum código recém-gerado para exportar', 'error')
    downloadCodesPdf(lastBatch, election?.name, `codigos-votacao-novos-${timestampSlug()}`)
  }

  function downloadAvailablePdf() {
    const available = codeList.filter(c => !c.is_used).map(c => c.code)
    if (available.length === 0) return showMessage('Não há códigos disponíveis para exportar', 'error')
    downloadCodesPdf(available, election?.name, `codigos-votacao-disponiveis-${timestampSlug()}`)
  }

  // undefined = ainda não buscou / poucos dígitos; null = 4 dígitos mas não achou; objeto = achou
  const codeSearchMatch = codeSearch.length === 4
    ? (codeList.find(c => c.code === codeSearch) || null)
    : undefined

  async function resetCode(code) {
    if (!confirm(`Resetar o código ${code}? Ele voltará a ficar disponível para uso. Os votos já registrados com ele (se houver) NÃO serão apagados.`)) return
    setCodeActionBusy(true)
    try {
      const data = await callAdmin('admin_reset_code', { p_code: code })
      if (data?.error) throw new Error(data.error === 'code_not_found' ? 'Código não encontrado' : data.error)
      showMessage(`Código ${code} resetado`)
      setCodeSearch('')
      await refreshCodes()
    } catch (e) { showMessage('Erro: ' + e.message, 'error') }
    finally { setCodeActionBusy(false) }
  }

  async function deleteCode(code) {
    if (!confirm(`Apagar o código ${code}? Esta ação remove o código PERMANENTEMENTE e apaga TODOS os votos e comprovantes já registrados com ele. Não pode ser desfeita.`)) return
    setCodeActionBusy(true)
    try {
      const data = await callAdmin('admin_delete_code', { p_code: code })
      if (data?.error) throw new Error(data.error === 'code_not_found' ? 'Código não encontrado' : data.error)
      const votesMsg = data.deleted_votes > 0 ? ` (${data.deleted_votes} voto(s) removido(s))` : ''
      showMessage(`Código ${code} apagado${votesMsg}`)
      setCodeSearch('')
      await refreshCodes()
    } catch (e) { showMessage('Erro: ' + e.message, 'error') }
    finally { setCodeActionBusy(false) }
  }

  async function resetAllCodes() {
    if (codeStats.used === 0) return showMessage('Não há códigos utilizados para resetar', 'error')
    if (!confirm(`Resetar TODOS os ${codeStats.used} código(s) utilizados? Todos voltarão a ficar disponíveis para uso. Os votos já registrados NÃO serão apagados.`)) return
    setCodeActionBusy(true)
    try {
      const data = await callAdmin('admin_reset_all_codes', {})
      if (data?.error) throw new Error(data.error)
      showMessage(`${data.reset_count} código(s) resetado(s)`)
      setCodeSearch('')
      await refreshCodes()
    } catch (e) { showMessage('Erro: ' + e.message, 'error') }
    finally { setCodeActionBusy(false) }
  }

  async function deleteAllCodes() {
    if (codeStats.total === 0) return showMessage('Não há códigos gerados para apagar', 'error')
    if (!confirm(`Apagar TODOS os ${codeStats.total} código(s) desta urna? Esta ação remove TODOS os códigos PERMANENTEMENTE e apaga TODOS os votos e comprovantes registrados com eles, de qualquer sessão. Não pode ser desfeita.`)) return
    if (!confirm('Tem certeza mesmo? Esta é a última confirmação antes de apagar tudo.')) return
    setCodeActionBusy(true)
    try {
      const data = await callAdmin('admin_delete_all_codes', {})
      if (data?.error) throw new Error(data.error)
      showMessage(`${data.deleted_codes} código(s) apagado(s), ${data.deleted_votes} voto(s) removido(s)`)
      setCodeSearch('')
      setLastBatch([])
      await refreshCodes()
    } catch (e) { showMessage('Erro: ' + e.message, 'error') }
    finally { setCodeActionBusy(false) }
  }

  // ===== Cédulas manuais (mesário) =====

  async function openManualCodesTab() {
    setTab('manualCodes')
    await refreshManualCodes()
  }

  async function refreshManualCodes() {
    try {
      const data = await callAdmin('admin_list_manual_codes', {})
      if (data?.error) throw new Error(data.error)
      setManualCodeList(data.codes || [])
      setManualCodeStats({
        total: data.total || 0,
        used: data.used || 0,
        available: data.available || 0
      })
    } catch (e) { showMessage('Erro: ' + e.message, 'error') }
  }

  async function generateManualCodes() {
    const qty = parseInt(manualCodeQuantity)
    if (!qty || qty < 1) return showMessage('Informe uma quantidade válida', 'error')
    if (qty > 5000) return showMessage('Máximo de 5000 cédulas por geração', 'error')
    setGeneratingManualCodes(true)
    try {
      const data = await callAdmin('admin_generate_manual_codes', { p_quantity: qty })
      if (data?.error) throw new Error(CODE_ERROR_MESSAGES[data.error] || data.error)
      setManualLastBatch(data.codes || [])
      const generated = data.generated || 0
      if (generated < qty) {
        showMessage(`Apenas ${generated} de ${qty} cédula(s) puderam ser geradas (limite de combinações de 4 dígitos disponíveis nesta urna).`, 'error')
      } else {
        showMessage(`${generated} cédula(s) gerada(s) com sucesso`)
      }
      await refreshManualCodes()
    } catch (e) { showMessage('Erro: ' + e.message, 'error') }
    finally { setGeneratingManualCodes(false) }
  }

  function downloadManualLastBatchPdf() {
    if (manualLastBatch.length === 0) return showMessage('Nenhuma cédula recém-gerada para exportar', 'error')
    downloadManualBallotsPdf(manualLastBatch, election, `cedulas-manuais-novas-${timestampSlug()}`)
  }

  function downloadManualAvailablePdf() {
    const available = manualCodeList.filter(c => !c.is_used).map(c => c.code)
    if (available.length === 0) return showMessage('Não há cédulas disponíveis para exportar', 'error')
    downloadManualBallotsPdf(available, election, `cedulas-manuais-disponiveis-${timestampSlug()}`)
  }

  const manualCodeSearchMatch = manualCodeSearch.length === 4
    ? (manualCodeList.find(c => c.code === manualCodeSearch) || null)
    : undefined

  async function resetManualCode(code) {
    if (!confirm(`Resetar a cédula ${code}? Ela voltará a ficar disponível para uso. Os votos já registrados com ela (se houver) NÃO serão apagados.`)) return
    setManualCodeActionBusy(true)
    try {
      const data = await callAdmin('admin_reset_manual_code', { p_code: code })
      if (data?.error) throw new Error(data.error === 'code_not_found' ? 'Cédula não encontrada' : data.error)
      showMessage(`Cédula ${code} resetada`)
      setManualCodeSearch('')
      await refreshManualCodes()
    } catch (e) { showMessage('Erro: ' + e.message, 'error') }
    finally { setManualCodeActionBusy(false) }
  }

  async function deleteManualCode(code) {
    if (!confirm(`Apagar a cédula ${code}? Esta ação remove a cédula PERMANENTEMENTE e apaga TODOS os votos e comprovantes já registrados com ela. Não pode ser desfeita.`)) return
    setManualCodeActionBusy(true)
    try {
      const data = await callAdmin('admin_delete_manual_code', { p_code: code })
      if (data?.error) throw new Error(data.error === 'code_not_found' ? 'Cédula não encontrada' : data.error)
      const votesMsg = data.deleted_votes > 0 ? ` (${data.deleted_votes} voto(s) removido(s))` : ''
      showMessage(`Cédula ${code} apagada${votesMsg}`)
      setManualCodeSearch('')
      await refreshManualCodes()
    } catch (e) { showMessage('Erro: ' + e.message, 'error') }
    finally { setManualCodeActionBusy(false) }
  }

  async function resetAllManualCodes() {
    if (manualCodeStats.used === 0) return showMessage('Não há cédulas utilizadas para resetar', 'error')
    if (!confirm(`Resetar TODAS as ${manualCodeStats.used} cédula(s) utilizadas? Todas voltarão a ficar disponíveis para uso. Os votos já registrados NÃO serão apagados.`)) return
    setManualCodeActionBusy(true)
    try {
      const data = await callAdmin('admin_reset_all_manual_codes', {})
      if (data?.error) throw new Error(data.error)
      showMessage(`${data.reset_count} cédula(s) resetada(s)`)
      setManualCodeSearch('')
      await refreshManualCodes()
    } catch (e) { showMessage('Erro: ' + e.message, 'error') }
    finally { setManualCodeActionBusy(false) }
  }

  async function deleteAllManualCodes() {
    if (manualCodeStats.total === 0) return showMessage('Não há cédulas geradas para apagar', 'error')
    if (!confirm(`Apagar TODAS as ${manualCodeStats.total} cédula(s) desta urna? Esta ação remove TODAS as cédulas PERMANENTEMENTE e apaga TODOS os votos e comprovantes registrados com elas, de qualquer sessão. Não pode ser desfeita.`)) return
    if (!confirm('Tem certeza mesmo? Esta é a última confirmação antes de apagar tudo.')) return
    setManualCodeActionBusy(true)
    try {
      const data = await callAdmin('admin_delete_all_manual_codes', {})
      if (data?.error) throw new Error(data.error)
      showMessage(`${data.deleted_codes} cédula(s) apagada(s), ${data.deleted_votes} voto(s) removido(s)`)
      setManualCodeSearch('')
      setManualLastBatch([])
      await refreshManualCodes()
    } catch (e) { showMessage('Erro: ' + e.message, 'error') }
    finally { setManualCodeActionBusy(false) }
  }

  async function saveSession(form) {
    try {
      const candidates = (form.candidates || [])
        .map(c => ({ name: (c.name || '').trim(), photo_url: c.photo_url || null }))
        .filter(c => c.name)
      if (form.id) {
        await callAdmin('admin_update_session', {
          p_session_id: form.id,
          p_title: form.title,
          p_votes_required: parseInt(form.votes_required),
          p_candidates: candidates,
          p_is_active: form.is_active
        })
      } else {
        await callAdmin('admin_create_session', {
          p_title: form.title,
          p_votes_required: parseInt(form.votes_required),
          p_candidates: candidates
        })
      }
      setShowSessionModal(false)
      setEditingSession(null)
      showMessage('Sessão salva')
      await refreshData()
    } catch (e) { showMessage('Erro: ' + e.message, 'error') }
  }

  async function deleteSession(s) {
    if (!confirm(`Excluir a sessão "${s.title}"? Todos os votos desta sessão serão perdidos.`)) return
    try {
      await callAdmin('admin_delete_session', { p_session_id: s.id })
      showMessage('Sessão excluída')
      await refreshData()
    } catch (e) { showMessage('Erro: ' + e.message, 'error') }
  }

  async function resetSession(s) {
    if (!confirm(`Reiniciar "${s.title}"? Os votos e o comprovante desta sessão serão zerados.`)) return
    try {
      await callAdmin('admin_reset_session', { p_session_id: s.id })
      showMessage('Sessão reiniciada')
      await refreshData()
    } catch (e) { showMessage('Erro: ' + e.message, 'error') }
  }

  async function resetAll() {
    if (!confirm('Zerar TUDO? Todos os votos e comprovantes de TODAS as sessões serão removidos. Esta ação é irreversível.')) return
    try {
      await callAdmin('admin_reset_all', {})
      showMessage('Tudo zerado')
      await refreshData()
    } catch (e) { showMessage('Erro: ' + e.message, 'error') }
  }

  // ===== BACKUP / RESTORE =====
  async function exportBackup() {
    try {
      showMessage('Gerando backup...')
      const el = await callAdmin('admin_export_election', {})
      const blob = new Blob([JSON.stringify(el, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      a.download = `backup-eleicao-${ts}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showMessage('Backup exportado com sucesso')
    } catch (e) { showMessage('Erro ao exportar: ' + e.message, 'error') }
  }

  function triggerRestore() {
    fileInputRef.current?.click()
  }

  async function handleRestoreFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (!confirm(`Restaurar backup "${file.name}"? Os dados atuais serão substituídos. Continuar?`)) {
        if (fileInputRef.current) fileInputRef.current.value = ''
        return
      }
      showMessage('Restaurando...')
      await callAdmin('admin_import_election', { p_data: data })
      showMessage('Backup restaurado com sucesso')
      if (fileInputRef.current) fileInputRef.current.value = ''
      await refreshData()
    } catch (e) {
      showMessage('Erro ao restaurar: ' + e.message, 'error')
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // Sair sem pedir senha (já está autenticado)
  function logout() {
    if (onGoToWelcome) onGoToWelcome()
    if (onLogout) onLogout()
  }

  const tabs = [
    { id: 'general', label: 'Geral', icon: 'settings' },
    { id: 'sessions', label: 'Sessões', icon: 'vote' },
    { id: 'codes', label: 'Códigos', icon: 'lock' },
    { id: 'manualCodes', label: 'Cédulas Manuais', icon: 'edit' },
    { id: 'results', label: 'Resultados', icon: 'chart' },
    { id: 'audit', label: 'Auditoria', icon: 'copy' },
    { id: 'security', label: 'Segurança', icon: 'shield' }
  ]

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="gradient-bg text-white p-4 shadow-lg">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-lg">
              <Icon name="settings" className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Painel Administrativo</h1>
              <p className="text-sm text-indigo-200">{election?.name}</p>
            </div>
          </div>
          <button onClick={logout} className="flex items-center gap-2 bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg text-sm font-medium">
            <Icon name="logout" className="w-4 h-4" /> Sair
          </button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-4">
        {message && (
          <div className={`px-4 py-2 rounded-lg mb-4 fade-in ${messageType === 'error' ? 'bg-red-100 border border-red-300 text-red-800' : 'bg-emerald-100 border border-emerald-300 text-emerald-800'}`}>
            {message}
          </div>
        )}

        <div className="flex gap-2 mb-6 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => {
                if (t.id === 'sessions') openSessionsTab()
                else if (t.id === 'codes') openCodesTab()
                else if (t.id === 'manualCodes') openManualCodesTab()
                else if (t.id === 'results') openResultsTab()
                else if (t.id === 'audit') openAuditTab()
                else setTab(t.id)
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium whitespace-nowrap ${tab === t.id ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
            >
              <Icon name={t.icon} className="w-4 h-4" /> {t.label}
            </button>
          ))}
        </div>

        {tab === 'general' && electionForm && (
          <div className="bg-white card-shadow rounded-2xl p-6 fade-in space-y-4">
            <h2 className="text-lg font-bold text-slate-800">Configurações Gerais</h2>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Nome da Eleição</label>
              <input
                type="text"
                value={tempElectionName}
                onChange={e => setTempElectionName(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div className="border-t pt-4">
              <h3 className="font-semibold text-slate-700 mb-3">Local de Votação</h3>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nome do local</label>
                <input type="text" value={electionForm.location_name || ''} onChange={e => setElectionForm({ ...electionForm, location_name: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg" placeholder="Ex: Igreja - Salão Principal" />
                <p className="text-xs text-slate-500 mt-1">Apenas informativo, exibido para o eleitor. A urna não bloqueia mais o voto por geolocalização — a identificação agora é feita pelo código de votação (aba "Códigos").</p>
              </div>
            </div>

            <button type="button" onClick={saveGeneral} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg font-semibold">
              Salvar Configurações
            </button>

            <div className="border-t pt-4">
              <h3 className="font-semibold text-slate-700 mb-2">Alterar Senha</h3>
              <div className="space-y-2">
                <input type="password" placeholder="Senha atual" value={oldPwd} onChange={e => setOldPwd(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                <div className="flex gap-2">
                  <input type="password" placeholder="Nova senha (mín. 4 caracteres)" value={newPwd} onChange={e => setNewPwd(e.target.value)}
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                  <button type="button" onClick={changePassword} className="bg-slate-700 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-sm">
                    Alterar
                  </button>
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <h3 className="font-semibold text-slate-700 mb-2">Alterar Senha da Votação Manual</h3>
              <p className="text-xs text-slate-500 mb-2">
                Senha própria e independente, usada só na página <code>#votacaomanual</code> pelo mesário. Trocar aqui usa a sua senha de admin já autenticada — não é preciso saber a senha manual antiga (útil se o mesário esquecê-la).
              </p>
              <div className="flex gap-2">
                <input type="password" placeholder="Nova senha da votação manual (mín. 4 caracteres)" value={newManualPwd} onChange={e => setNewManualPwd(e.target.value)}
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                <button type="button" onClick={changeManualPassword} className="bg-slate-700 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-sm">
                  Alterar
                </button>
              </div>
            </div>

            <div className="border-t pt-4">
              <h3 className="font-semibold text-slate-700 mb-2">Backup e Restauração</h3>
              <p className="text-xs text-slate-500 mb-2">Exporte um arquivo JSON com todos os dados da eleição ou restaure um backup anterior.</p>
              <div className="flex gap-2 flex-wrap">
                <button type="button" onClick={exportBackup} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2">
                  <Icon name="download" className="w-4 h-4" /> Exportar tudo (JSON)
                </button>
                <button type="button" onClick={triggerRestore} className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2">
                  <Icon name="upload" className="w-4 h-4" /> Restaurar de arquivo JSON
                </button>
                <input ref={fileInputRef} type="file" accept="application/json" onChange={handleRestoreFile} className="hidden" />
              </div>
            </div>

            <div className="border-t pt-4">
              <h3 className="font-bold text-red-600 mb-2">Zona de perigo</h3>
              <button type="button" onClick={resetAll} className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 text-sm">
                Zerar TUDO (votos e comprovantes)
              </button>
            </div>
          </div>
        )}

        {tab === 'sessions' && (
          <div className="bg-white card-shadow rounded-2xl p-6 fade-in">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-800">Sessões de Votação</h2>
              <button type="button" onClick={() => { setEditingSession({ title: '', votes_required: 1, candidates: [], is_active: true }); setShowSessionModal(true) }}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg flex items-center gap-2">
                <Icon name="plus" className="w-4 h-4" /> Nova Sessão
              </button>
            </div>

            <div className="space-y-2">
              {sessions.length === 0 && <p className="text-center text-slate-400 py-8">Nenhuma sessão cadastrada</p>}
              {sessions.map((s, i) => (
                <div key={s.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                  <div className="bg-indigo-100 text-indigo-700 font-bold w-8 h-8 rounded-full flex items-center justify-center">{i + 1}</div>
                  <div className="flex-1">
                    <p className="font-semibold">{s.title}</p>
                    <p className="text-xs text-slate-500">{s.votes_required} voto(s) • {s.candidates?.length || 0} candidatos</p>
                  </div>
                  <button type="button" onClick={() => resetSession(s)} className="text-amber-600 hover:bg-amber-50 p-2 rounded" title="Reiniciar sessão">
                    <Icon name="refresh" className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => { setEditingSession({ ...s, candidates: (s.candidates || []).map(c => ({ name: c.name, photo_url: c.photo_url || null })) }); setShowSessionModal(true) }}
                    className="text-blue-600 hover:bg-blue-50 p-2 rounded">
                    <Icon name="edit" className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => deleteSession(s)} className="text-red-600 hover:bg-red-50 p-2 rounded">
                    <Icon name="trash" className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            {showSessionModal && (
              <SessionModal
                session={editingSession}
                onSave={saveSession}
                onClose={() => { setShowSessionModal(false); setEditingSession(null) }}
              />
            )}
          </div>
        )}

        {tab === 'codes' && (
          <div className="bg-white card-shadow rounded-2xl p-6 fade-in space-y-5">
            <div>
              <h2 className="text-lg font-bold text-slate-800">Códigos de Votação</h2>
              <p className="text-sm text-slate-500 mt-1">
                Gere códigos numéricos de 4 dígitos para autenticar os eleitores. Cada código libera o voto em todas as sessões desta urna e só pode ser usado <b>uma única vez</b> — ao ser digitado, ele é imediatamente bloqueado para qualquer outra tentativa.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-indigo-700">{codeStats.total}</p>
                <p className="text-xs text-indigo-600 font-medium">Gerados</p>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-emerald-700">{codeStats.used}</p>
                <p className="text-xs text-emerald-600 font-medium">Utilizados</p>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-amber-700">{codeStats.available}</p>
                <p className="text-xs text-amber-600 font-medium">Disponíveis</p>
              </div>
            </div>

            <div className="border-t pt-4">
              <h3 className="font-semibold text-slate-700 mb-2">Gerar novos códigos</h3>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Quantidade</label>
                  <input
                    type="number"
                    min="1"
                    max="5000"
                    value={codeQuantity}
                    onChange={e => setCodeQuantity(e.target.value)}
                    className="w-32 px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <button
                  type="button"
                  onClick={generateCodes}
                  disabled={generatingCodes}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-semibold disabled:opacity-50 flex items-center gap-2"
                >
                  <Icon name="plus" className="w-4 h-4" />
                  {generatingCodes ? 'Gerando...' : 'Gerar Códigos'}
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                Os códigos têm 4 dígitos (0000–9999), portanto o limite é de até 10.000 códigos por urna.
              </p>
            </div>

            {lastBatch.length > 0 && (
              <div className="border-t pt-4">
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-center justify-between flex-wrap gap-2">
                  <p className="text-sm text-emerald-800"><b>{lastBatch.length}</b> código(s) gerado(s) na última geração.</p>
                  <button
                    type="button"
                    onClick={downloadLastBatchPdf}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2"
                  >
                    <Icon name="download" className="w-4 h-4" /> Baixar PDF (recém-gerados)
                  </button>
                </div>
              </div>
            )}

            <div className="border-t pt-4">
              <h3 className="font-semibold text-slate-700 mb-2">Reimprimir códigos disponíveis</h3>
              <p className="text-xs text-slate-500 mb-2">
                Gera um único PDF com todos os códigos ainda não utilizados, prontos para impressão — cada código fica em uma ficha com borda tracejada para recorte.
              </p>
              <button
                type="button"
                onClick={downloadAvailablePdf}
                disabled={codeStats.available === 0}
                className="bg-slate-700 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50"
              >
                <Icon name="download" className="w-4 h-4" /> Baixar PDF (todos disponíveis — {codeStats.available})
              </button>
            </div>

            <div className="border-t pt-4">
              <h3 className="font-semibold text-slate-700 mb-2">Gerenciar um código específico</h3>
              <p className="text-xs text-slate-500 mb-2">
                Digite o código de 4 dígitos para <b>resetar</b> (destrava para uso novamente, sem apagar votos) ou <b>apagar</b> (remove o código e TODOS os votos feitos com ele — use quando o eleitor errou e a votação precisa ser desfeita).
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  value={codeSearch}
                  onChange={e => setCodeSearch(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
                  placeholder="0000"
                  className="w-24 px-3 py-2 border border-slate-300 rounded-lg text-center font-mono text-lg tracking-widest"
                />
                {codeSearchMatch === null && (
                  <span className="text-sm text-red-600">Código não encontrado</span>
                )}
                {codeSearchMatch && (
                  <>
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${codeSearchMatch.is_used ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {codeSearchMatch.is_used ? 'Utilizado' : 'Disponível'}
                    </span>
                    {codeSearchMatch.is_used && (
                      <button
                        type="button"
                        onClick={() => resetCode(codeSearchMatch.code)}
                        disabled={codeActionBusy}
                        className="bg-amber-600 hover:bg-amber-700 text-white px-3 py-2 rounded-lg text-sm flex items-center gap-1 disabled:opacity-50"
                      >
                        <Icon name="refresh" className="w-4 h-4" /> Resetar
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteCode(codeSearchMatch.code)}
                      disabled={codeActionBusy}
                      className="bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-lg text-sm flex items-center gap-1 disabled:opacity-50"
                    >
                      <Icon name="trash" className="w-4 h-4" /> Apagar
                    </button>
                  </>
                )}
              </div>
            </div>

            {codeList.length > 0 && (
              <div className="border-t pt-4">
                <h3 className="font-semibold text-slate-700 mb-2">Códigos recentes</h3>
                <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {codeList.slice(0, 50).map(c => (
                    <div key={c.code} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="font-mono font-semibold tracking-widest">{c.code}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c.is_used ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {c.is_used ? 'Utilizado' : 'Disponível'}
                      </span>
                      <span className="flex-1" />
                      {c.is_used && (
                        <button type="button" onClick={() => resetCode(c.code)} disabled={codeActionBusy}
                          className="text-amber-600 hover:text-amber-800 p-1 disabled:opacity-50" title="Resetar">
                          <Icon name="refresh" className="w-4 h-4" />
                        </button>
                      )}
                      <button type="button" onClick={() => deleteCode(c.code)} disabled={codeActionBusy}
                        className="text-red-500 hover:text-red-700 p-1 disabled:opacity-50" title="Apagar">
                        <Icon name="trash" className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
                {codeList.length > 50 && (
                  <p className="text-xs text-slate-400 mt-1">Mostrando os 50 mais recentes de {codeList.length}. Use a busca acima para localizar um código específico.</p>
                )}
              </div>
            )}

            <div className="border-t pt-4">
              <h3 className="font-semibold text-red-600 mb-2">Ações em lote (todos os códigos)</h3>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
                <p className="text-sm text-amber-800 mb-2">
                  <b>Resetar todos os utilizados</b> destrava de volta todos os códigos marcados como usados, sem apagar nenhum voto.
                </p>
                <button
                  type="button"
                  onClick={resetAllCodes}
                  disabled={codeActionBusy || codeStats.used === 0}
                  className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50"
                >
                  <Icon name="refresh" className="w-4 h-4" /> Resetar todos os utilizados ({codeStats.used})
                </button>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-700 mb-2">
                  <b>Apagar todos os códigos</b> remove TODOS os códigos desta urna permanentemente e apaga TODOS os votos e comprovantes feitos com eles. Use apenas para reiniciar a eleição do zero. Esta ação é irreversível.
                </p>
                <button
                  type="button"
                  onClick={deleteAllCodes}
                  disabled={codeActionBusy || codeStats.total === 0}
                  className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50"
                >
                  <Icon name="trash" className="w-4 h-4" /> Apagar todos os códigos ({codeStats.total})
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'manualCodes' && (
          <div className="bg-white card-shadow rounded-2xl p-6 fade-in space-y-5">
            <div>
              <h2 className="text-lg font-bold text-slate-800">Cédulas Manuais</h2>
              <p className="text-sm text-slate-500 mt-1">
                Gere cédulas de papel para votos computados pelo mesário na página <code>#votacaomanual</code>. Cada cédula tem um código numérico de 4 dígitos <b>próprio, diferente dos códigos do eleitor</b>, de uso único, e o PDF já imprime o código junto com a lista de sessões e candidatos para marcação manual.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-indigo-700">{manualCodeStats.total}</p>
                <p className="text-xs text-indigo-600 font-medium">Geradas</p>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-emerald-700">{manualCodeStats.used}</p>
                <p className="text-xs text-emerald-600 font-medium">Utilizadas</p>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-amber-700">{manualCodeStats.available}</p>
                <p className="text-xs text-amber-600 font-medium">Disponíveis</p>
              </div>
            </div>

            <div className="border-t pt-4">
              <h3 className="font-semibold text-slate-700 mb-2">Gerar novas cédulas</h3>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Quantidade</label>
                  <input
                    type="number"
                    min="1"
                    max="5000"
                    value={manualCodeQuantity}
                    onChange={e => setManualCodeQuantity(e.target.value)}
                    className="w-32 px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <button
                  type="button"
                  onClick={generateManualCodes}
                  disabled={generatingManualCodes}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-semibold disabled:opacity-50 flex items-center gap-2"
                >
                  <Icon name="plus" className="w-4 h-4" />
                  {generatingManualCodes ? 'Gerando...' : 'Gerar Cédulas'}
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                As cédulas compartilham o espaço de 4 dígitos com os códigos do eleitor, mas nunca coincidem: cada número só pertence a um dos dois grupos por vez.
              </p>
            </div>

            {manualLastBatch.length > 0 && (
              <div className="border-t pt-4">
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-center justify-between flex-wrap gap-2">
                  <p className="text-sm text-emerald-800"><b>{manualLastBatch.length}</b> cédula(s) gerada(s) na última geração.</p>
                  <button
                    type="button"
                    onClick={downloadManualLastBatchPdf}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2"
                  >
                    <Icon name="download" className="w-4 h-4" /> Baixar PDF (recém-geradas)
                  </button>
                </div>
              </div>
            )}

            <div className="border-t pt-4">
              <h3 className="font-semibold text-slate-700 mb-2">Reimprimir cédulas disponíveis</h3>
              <p className="text-xs text-slate-500 mb-2">
                Gera um único PDF com todas as cédulas ainda não utilizadas — cada uma com o código e a lista completa de sessões/candidatos para marcação.
              </p>
              <button
                type="button"
                onClick={downloadManualAvailablePdf}
                disabled={manualCodeStats.available === 0}
                className="bg-slate-700 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50"
              >
                <Icon name="download" className="w-4 h-4" /> Baixar PDF (todas disponíveis — {manualCodeStats.available})
              </button>
            </div>

            <div className="border-t pt-4">
              <h3 className="font-semibold text-slate-700 mb-2">Gerenciar uma cédula específica</h3>
              <p className="text-xs text-slate-500 mb-2">
                Digite o código de 4 dígitos para <b>resetar</b> (destrava para uso novamente, sem apagar votos) ou <b>apagar</b> (remove a cédula e TODOS os votos feitos com ela).
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  value={manualCodeSearch}
                  onChange={e => setManualCodeSearch(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
                  placeholder="0000"
                  className="w-24 px-3 py-2 border border-slate-300 rounded-lg text-center font-mono text-lg tracking-widest"
                />
                {manualCodeSearchMatch === null && (
                  <span className="text-sm text-red-600">Cédula não encontrada</span>
                )}
                {manualCodeSearchMatch && (
                  <>
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${manualCodeSearchMatch.is_used ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {manualCodeSearchMatch.is_used ? 'Utilizada' : 'Disponível'}
                    </span>
                    {manualCodeSearchMatch.is_used && (
                      <button
                        type="button"
                        onClick={() => resetManualCode(manualCodeSearchMatch.code)}
                        disabled={manualCodeActionBusy}
                        className="bg-amber-600 hover:bg-amber-700 text-white px-3 py-2 rounded-lg text-sm flex items-center gap-1 disabled:opacity-50"
                      >
                        <Icon name="refresh" className="w-4 h-4" /> Resetar
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteManualCode(manualCodeSearchMatch.code)}
                      disabled={manualCodeActionBusy}
                      className="bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-lg text-sm flex items-center gap-1 disabled:opacity-50"
                    >
                      <Icon name="trash" className="w-4 h-4" /> Apagar
                    </button>
                  </>
                )}
              </div>
            </div>

            {manualCodeList.length > 0 && (
              <div className="border-t pt-4">
                <h3 className="font-semibold text-slate-700 mb-2">Cédulas recentes</h3>
                <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {manualCodeList.slice(0, 50).map(c => (
                    <div key={c.code} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="font-mono font-semibold tracking-widest">{c.code}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c.is_used ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {c.is_used ? 'Utilizada' : 'Disponível'}
                      </span>
                      <span className="flex-1" />
                      {c.is_used && (
                        <button type="button" onClick={() => resetManualCode(c.code)} disabled={manualCodeActionBusy}
                          className="text-amber-600 hover:text-amber-800 p-1 disabled:opacity-50" title="Resetar">
                          <Icon name="refresh" className="w-4 h-4" />
                        </button>
                      )}
                      <button type="button" onClick={() => deleteManualCode(c.code)} disabled={manualCodeActionBusy}
                        className="text-red-500 hover:text-red-700 p-1 disabled:opacity-50" title="Apagar">
                        <Icon name="trash" className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
                {manualCodeList.length > 50 && (
                  <p className="text-xs text-slate-400 mt-1">Mostrando as 50 mais recentes de {manualCodeList.length}. Use a busca acima para localizar uma cédula específica.</p>
                )}
              </div>
            )}

            <div className="border-t pt-4">
              <h3 className="font-semibold text-red-600 mb-2">Ações em lote (todas as cédulas)</h3>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
                <p className="text-sm text-amber-800 mb-2">
                  <b>Resetar todas as utilizadas</b> destrava de volta todas as cédulas marcadas como usadas, sem apagar nenhum voto.
                </p>
                <button
                  type="button"
                  onClick={resetAllManualCodes}
                  disabled={manualCodeActionBusy || manualCodeStats.used === 0}
                  className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50"
                >
                  <Icon name="refresh" className="w-4 h-4" /> Resetar todas as utilizadas ({manualCodeStats.used})
                </button>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-700 mb-2">
                  <b>Apagar todas as cédulas</b> remove TODAS as cédulas desta urna permanentemente e apaga TODOS os votos e comprovantes feitos com elas. Ação irreversível.
                </p>
                <button
                  type="button"
                  onClick={deleteAllManualCodes}
                  disabled={manualCodeActionBusy || manualCodeStats.total === 0}
                  className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50"
                >
                  <Icon name="trash" className="w-4 h-4" /> Apagar todas as cédulas ({manualCodeStats.total})
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'results' && (
          <ResultsView
            results={results}
            sessionId={resultsSessionId}
            onSelectSession={setResultsSessionId}
            electionName={election?.name}
          />
        )}

        {tab === 'audit' && (
          <div className="bg-white card-shadow rounded-2xl p-6 fade-in">
            <h2 className="text-lg font-bold text-slate-800 mb-4">Comprovantes de Votação</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-100 text-left">
                    <th className="p-3 font-semibold">Origem</th>
                    <th className="p-3 font-semibold">Código de Acesso</th>
                    <th className="p-3 font-semibold">Comprovante</th>
                    <th className="p-3 font-semibold">Data/Hora</th>
                    <th className="p-3 font-semibold">Sessões Votadas</th>
                    <th className="p-3 font-semibold">Candidatos Votados</th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.length === 0 && (
                    <tr><td colSpan="6" className="p-8 text-center text-slate-400">Nenhum comprovante emitido</td></tr>
                  )}
                  {receipts.map(r => {
                    const completions = r.session_completions || []
                    const origin = describeVoterOrigin(r.voter_token)
                    return (
                      <tr key={r.receipt_code} className="border-b hover:bg-slate-50">
                        <td className="p-3">
                          <span className={`text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap ${origin.badgeClass}`}>
                            {origin.label}
                          </span>
                        </td>
                        <td className="p-3 font-mono font-semibold tracking-widest text-slate-700">{origin.code}</td>
                        <td className="p-3 font-mono text-indigo-700">{r.receipt_code}</td>
                        <td className="p-3 text-xs">{new Date(r.created_at).toLocaleString('pt-BR')}</td>
                        <td className="p-3 text-slate-700">{completions.map(c => c.session_title).join(', ')}</td>
                        <td className="p-3 text-xs text-slate-600">
                          {completions.map(c => `${c.session_title}: ${(c.voted_candidates || []).join(', ')}${c.blank_count > 0 ? ' + ' + c.blank_count + ' branco(s)' : ''}`).join('; ')}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'security' && (
          <div className="bg-white card-shadow rounded-2xl p-6 fade-in space-y-4">
            <h2 className="text-lg font-bold text-slate-800">Segurança e Dispositivos</h2>

            <div className="bg-amber-50 border border-amber-200 p-4 rounded-lg text-sm text-amber-800">
              <p className="font-semibold mb-1">Como o sistema identifica o eleitor</p>
              <p>
                O eleitor digita um <b>código numérico de 4 dígitos</b> (gerado na aba "Códigos") ao iniciar a votação.
                O código é validado e marcado como usado uma única vez no banco de dados — depois disso, nenhum outro
                dispositivo consegue digitar o mesmo código. O bloqueio de novas tentativas é feito pelo <b>código em si</b>,
                não pelo dispositivo/navegador: não existe mais um "token de liberação" manual para o admin apagar. Ao final
                da votação, a própria tela de comprovante libera o aparelho para o próximo eleitor. Não usamos fingerprint
                (impressão digital do navegador) nem geolocalização.
              </p>
              <p className="mt-2">
                A página <code>#votacaomanual</code> (mesário) tem uma <b>senha própria</b>, diferente da senha de admin — altere-a na seção "Alterar Senha da Votação Manual" na aba Geral.
              </p>
            </div>

            <div className="bg-red-50 border border-red-200 p-4 rounded-lg">
              <h3 className="font-bold text-red-600 mb-2">Zerar TUDO (votos e comprovantes)</h3>
              <p className="text-sm text-red-700 mb-3">
                Esta ação remove <b>todos os votos e comprovantes</b> de todas as sessões no banco de dados. Use apenas se precisar reiniciar a eleição.
                Os <b>códigos de votação</b> gerados (aba "Códigos") não são afetados por esta ação.
              </p>
              <button type="button" onClick={resetAll} className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 text-sm">
                Zerar TUDO
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function CandidateRow({ candidate, index, onChange, onRemove, onZoom }) {
  const fileInputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [photoError, setPhotoError] = useState('')

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // permite selecionar o mesmo arquivo de novo depois
    if (!file) return
    setPhotoError('')
    setUploading(true)
    try {
      const dataUrl = await fileToResizedDataUrl(file)
      onChange({ ...candidate, photo_url: dataUrl })
    } catch (err) {
      setPhotoError(err.message || 'Erro ao processar imagem')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg p-2">
      <button
        type="button"
        onClick={() => candidate.photo_url ? onZoom(candidate) : fileInputRef.current?.click()}
        className="relative w-12 h-12 rounded-full flex-shrink-0 overflow-hidden border border-slate-200 bg-slate-100 flex items-center justify-center text-slate-400 hover:opacity-80 transition"
        title={candidate.photo_url ? 'Clique para ampliar' : 'Adicionar foto'}
      >
        {uploading ? (
          <div className="w-4 h-4 border-2 border-slate-300 border-t-indigo-600 rounded-full animate-spin" />
        ) : candidate.photo_url ? (
          <img src={candidate.photo_url} alt={candidate.name} className="w-full h-full object-cover" />
        ) : (
          <Icon name="user" className="w-6 h-6" />
        )}
      </button>
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />

      <div className="flex-1 min-w-0">
        <input
          type="text"
          value={candidate.name}
          onChange={e => onChange({ ...candidate, name: e.target.value })}
          placeholder={`Candidato ${index + 1}`}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
        />
        {photoError && <p className="text-xs text-red-600 mt-1">{photoError}</p>}
      </div>

      {candidate.photo_url && (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Trocar foto"
          className="text-slate-400 hover:text-indigo-600 p-1"
        >
          <Icon name="edit" className="w-4 h-4" />
        </button>
      )}
      {candidate.photo_url && (
        <button
          type="button"
          onClick={() => onChange({ ...candidate, photo_url: null })}
          title="Remover foto"
          className="text-slate-400 hover:text-amber-600 p-1"
        >
          <Icon name="x" className="w-4 h-4" />
        </button>
      )}
      <button
        type="button"
        onClick={onRemove}
        title="Remover candidato"
        className="text-slate-400 hover:text-red-600 p-1"
      >
        <Icon name="trash" className="w-4 h-4" />
      </button>
    </div>
  )
}

function SessionModal({ session, onSave, onClose }) {
  const [form, setForm] = useState(session)
  const [zoomCandidate, setZoomCandidate] = useState(null)

  function updateCandidate(idx, next) {
    const list = [...form.candidates]
    list[idx] = next
    setForm({ ...form, candidates: list })
  }

  function removeCandidate(idx) {
    setForm({ ...form, candidates: form.candidates.filter((_, i) => i !== idx) })
  }

  function addCandidate() {
    if (form.candidates.length >= 10) return
    setForm({ ...form, candidates: [...form.candidates, { name: '', photo_url: null }] })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-bold mb-4">{form.id ? 'Editar' : 'Nova'} Sessão</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Título</label>
            <input type="text" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg" placeholder="Ex: Presbíteros" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Votos obrigatórios: <b>{form.votes_required}</b></label>
            <div className="flex gap-2">
              <input type="number" min="1" max="10" value={form.votes_required} onChange={e => setForm({ ...form, votes_required: parseInt(e.target.value) || 1 })}
                className="w-20 px-3 py-2 border border-slate-300 rounded-lg" />
              <input type="range" min="1" max="10" value={form.votes_required} onChange={e => setForm({ ...form, votes_required: parseInt(e.target.value) })}
                className="flex-1" />
            </div>
            <p className="text-xs text-slate-500 mt-1">O eleitor pode misturar candidatos e brancos livremente, totalizando este número.</p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-slate-700">Candidatos</label>
              <span className="text-xs text-slate-400">{form.candidates.length}/10</span>
            </div>
            <div className="space-y-2">
              {form.candidates.map((c, idx) => (
                <CandidateRow
                  key={idx}
                  candidate={c}
                  index={idx}
                  onChange={next => updateCandidate(idx, next)}
                  onRemove={() => removeCandidate(idx)}
                  onZoom={setZoomCandidate}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={addCandidate}
              disabled={form.candidates.length >= 10}
              className="mt-2 w-full border-2 border-dashed border-slate-300 hover:border-indigo-400 text-slate-500 hover:text-indigo-600 rounded-lg py-2 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Icon name="plus" className="w-4 h-4" /> Adicionar candidato
            </button>
            <p className="text-xs text-slate-500 mt-1">A foto é opcional. Clique na foto para ampliar; até 10 candidatos por sessão.</p>
          </div>
          {form.id && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} />
              <span className="text-sm">Sessão ativa</span>
            </label>
          )}
        </div>
        <div className="flex gap-2 mt-4">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-slate-300 rounded-lg">Cancelar</button>
          <button type="button" onClick={() => onSave(form)} className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg">Salvar</button>
        </div>
      </div>

      <PhotoLightbox
        photoUrl={zoomCandidate?.photo_url}
        name={zoomCandidate?.name}
        onClose={() => setZoomCandidate(null)}
      />
    </div>
  )
}
