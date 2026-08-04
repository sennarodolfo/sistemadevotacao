import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { supabase } from '../lib/supabase'

function voterLink(electionId) {
  return `${window.location.origin}${window.location.pathname}#v/${electionId}`
}

// Painel do ORGANIZADOR: lista as eleições que ele criou, permite criar
// novas (cada uma isolada, com sua própria senha/config, sem interferir
// nas eleições de outros usuários) e disponibiliza o link de votação de
// cada uma para compartilhar com os eleitores.
export default function DashboardScreen({ userEmail, onOpenAdmin, onOpenManualVoting, onLogout }) {
  const [elections, setElections] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newLocation, setNewLocation] = useState('')
  const [creating, setCreating] = useState(false)

  const [revealCredentials, setRevealCredentials] = useState(null) // { election_id, admin_password, manual_password }
  const [copiedKey, setCopiedKey] = useState('')

  async function loadElections() {
    setLoading(true)
    setError('')
    try {
      const { data, error: err } = await supabase.rpc('list_my_elections')
      if (err) throw err
      if (data?.error) throw new Error(data.error)
      setElections(data?.elections || [])
    } catch (e) {
      setError(e.message || 'Erro ao carregar suas eleições.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadElections()
  }, [])

  async function createElection(e) {
    e.preventDefault()
    if (!newName.trim()) {
      setError('Informe um nome para a eleição.')
      return
    }
    setError('')
    setCreating(true)
    try {
      const { data, error: err } = await supabase.rpc('create_my_election', {
        p_name: newName.trim(),
        p_location_name: newLocation.trim()
      })
      if (err) throw err
      if (data?.error) throw new Error(data.error)
      setRevealCredentials(data)
      setNewName('')
      setNewLocation('')
      setShowCreate(false)
      await loadElections()
    } catch (e) {
      setError(e.message || 'Erro ao criar eleição.')
    } finally {
      setCreating(false)
    }
  }

  async function deleteElection(el) {
    if (!confirm(`Apagar a eleição "${el.name}" permanentemente? Isso remove TODAS as sessões, votos, comprovantes e códigos dela. Esta ação não pode ser desfeita.`)) return
    if (!confirm('Tem certeza mesmo? Não é possível recuperar depois de apagado.')) return
    try {
      const { data, error: err } = await supabase.rpc('delete_my_election', { p_election_id: el.id })
      if (err) throw err
      if (data?.error) throw new Error(data.error)
      setMessage(`Eleição "${el.name}" apagada.`)
      await loadElections()
    } catch (e) {
      setError(e.message || 'Erro ao apagar eleição.')
    }
  }

  function copy(text, key) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(''), 2000)
    })
  }

  async function resetPassword(el, kind) {
    const label = kind === 'admin' ? 'do painel admin' : 'da votação manual'
    if (!confirm(`Gerar uma NOVA senha ${label} para "${el.name}"? A senha atual deixará de funcionar.`)) return
    try {
      const fn = kind === 'admin' ? 'reset_my_election_admin_password' : 'reset_my_election_manual_password'
      const { data, error: err } = await supabase.rpc(fn, { p_election_id: el.id })
      if (err) throw err
      if (data?.error) throw new Error(data.error)
      setRevealCredentials({
        election_id: el.id,
        admin_password: kind === 'admin' ? data.admin_password : null,
        manual_password: kind === 'manual' ? data.manual_password : null
      })
    } catch (e) {
      setError(e.message || 'Erro ao redefinir a senha.')
    }
  }

  return (
    <div className="min-h-screen gradient-bg p-4">
      <div className="max-w-3xl mx-auto pt-8 pb-12">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white drop-shadow">Minhas Eleições</h1>
            <p className="text-white/80 text-sm">{userEmail}</p>
          </div>
          <button onClick={onLogout} className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2">
            <Icon name="logout" className="w-4 h-4" /> Sair
          </button>
        </div>

        {revealCredentials && (
          <div className="bg-white card-shadow rounded-2xl p-6 mb-6 fade-in border-2 border-emerald-400">
            <div className="flex items-center gap-2 mb-2">
              <Icon name="check" className="w-5 h-5 text-emerald-600" />
              <h2 className="text-lg font-bold text-slate-800">Eleição criada!</h2>
            </div>
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
              ⚠️ Guarde estas senhas agora — <b>elas não serão mostradas novamente</b>. Você pode trocá-las depois pelo próprio painel admin.
            </p>
            <div className="space-y-2 mb-4">
              {revealCredentials.admin_password && (
                <div className="flex items-center justify-between bg-slate-50 rounded-lg p-3">
                  <div>
                    <p className="text-xs text-slate-500">Senha do Painel Admin</p>
                    <p className="font-mono font-bold text-lg tracking-wide">{revealCredentials.admin_password}</p>
                  </div>
                  <button onClick={() => copy(revealCredentials.admin_password, 'admin')} className="text-indigo-600 hover:text-indigo-800 p-2">
                    <Icon name={copiedKey === 'admin' ? 'check' : 'copy'} className="w-5 h-5" />
                  </button>
                </div>
              )}
              {revealCredentials.manual_password && (
                <div className="flex items-center justify-between bg-slate-50 rounded-lg p-3">
                  <div>
                    <p className="text-xs text-slate-500">Senha da Votação Manual (#votacaomanual)</p>
                    <p className="font-mono font-bold text-lg tracking-wide">{revealCredentials.manual_password}</p>
                  </div>
                  <button onClick={() => copy(revealCredentials.manual_password, 'manual')} className="text-indigo-600 hover:text-indigo-800 p-2">
                    <Icon name={copiedKey === 'manual' ? 'check' : 'copy'} className="w-5 h-5" />
                  </button>
                </div>
              )}
            </div>
            <button onClick={() => setRevealCredentials(null)} className="w-full bg-slate-700 hover:bg-slate-800 text-white py-2 rounded-lg text-sm font-semibold">
              Já guardei, fechar
            </button>
          </div>
        )}

        {error && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm mb-4">{error}</div>}
        {message && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 p-3 rounded-lg text-sm mb-4">{message}</div>}

        <div className="bg-white card-shadow rounded-2xl p-6 mb-6">
          {!showCreate ? (
            <button onClick={() => setShowCreate(true)} className="w-full border-2 border-dashed border-indigo-300 hover:border-indigo-500 text-indigo-600 rounded-xl py-4 flex items-center justify-center gap-2 font-semibold">
              <Icon name="plus" className="w-5 h-5" /> Criar Nova Eleição
            </button>
          ) : (
            <form onSubmit={createElection} className="space-y-3">
              <h3 className="font-semibold text-slate-700">Nova Eleição</h3>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nome</label>
                <input type="text" value={newName} onChange={e => setNewName(e.target.value)} autoFocus
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg" placeholder="Ex: Eleição para Presbíteros e Diáconos" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Local (opcional)</label>
                <input type="text" value={newLocation} onChange={e => setNewLocation(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg" placeholder="Ex: Igreja - Salão Principal" />
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowCreate(false)} className="flex-1 border border-slate-300 py-2 rounded-lg">Cancelar</button>
                <button type="submit" disabled={creating} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg font-semibold disabled:opacity-50">
                  {creating ? 'Criando...' : 'Criar'}
                </button>
              </div>
            </form>
          )}
        </div>

        {loading ? (
          <p className="text-center text-white/80">Carregando...</p>
        ) : elections.length === 0 ? (
          <p className="text-center text-white/80">Você ainda não criou nenhuma eleição.</p>
        ) : (
          <div className="space-y-4">
            {elections.map(el => (
              <div key={el.id} className="bg-white card-shadow rounded-2xl p-5">
                <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                  <div>
                    <h3 className="font-bold text-slate-800 text-lg">{el.name}</h3>
                    {el.location_name && <p className="text-sm text-slate-500">📍 {el.location_name}</p>}
                    <p className="text-xs text-slate-400 mt-1">
                      {el.session_count} sessão(ões) · {el.voter_code_count} código(s) · {el.receipt_count} comprovante(s)
                    </p>
                  </div>
                  <button onClick={() => deleteElection(el)} className="text-red-400 hover:text-red-600 p-2" title="Apagar eleição">
                    <Icon name="trash" className="w-5 h-5" />
                  </button>
                </div>

                <div className="bg-slate-50 rounded-lg p-3 mb-3">
                  <p className="text-xs text-slate-500 mb-1">Link de votação (compartilhe com os eleitores)</p>
                  <div className="flex items-center gap-2">
                    <input readOnly value={voterLink(el.id)} className="flex-1 px-2 py-1.5 border border-slate-200 rounded bg-white text-xs font-mono" onFocus={e => e.target.select()} />
                    <button onClick={() => copy(voterLink(el.id), `link-${el.id}`)} className="text-indigo-600 hover:text-indigo-800 p-1.5 flex-shrink-0">
                      <Icon name={copiedKey === `link-${el.id}` ? 'check' : 'copy'} className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => onOpenAdmin(el.id)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2">
                    <Icon name="settings" className="w-4 h-4" /> Abrir Painel Admin
                  </button>
                  <button onClick={() => onOpenManualVoting(el.id)} className="bg-slate-700 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2">
                    <Icon name="edit" className="w-4 h-4" /> Votação Manual
                  </button>
                  <button onClick={() => resetPassword(el, 'admin')} className="border border-slate-300 text-slate-600 hover:bg-slate-50 px-3 py-2 rounded-lg text-sm flex items-center gap-2" title="Gerar nova senha do painel admin (se você esqueceu a atual)">
                    <Icon name="refresh" className="w-4 h-4" /> Redefinir senha admin
                  </button>
                  <button onClick={() => resetPassword(el, 'manual')} className="border border-slate-300 text-slate-600 hover:bg-slate-50 px-3 py-2 rounded-lg text-sm flex items-center gap-2" title="Gerar nova senha da votação manual (se você esqueceu a atual)">
                    <Icon name="refresh" className="w-4 h-4" /> Redefinir senha manual
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
