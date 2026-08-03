import { useState, useEffect } from 'react'
import { Icon } from '../components/Icon'
import PhotoLightbox from '../components/PhotoLightbox'
import { supabase, ELECTION_ID } from '../lib/supabase'
import { generateManualBallotToken } from '../lib/api'

const ERROR_MESSAGES = {
  wrong_count: 'Quantidade de votos incorreta para esta sessão.',
  invalid_candidate: 'Candidato inválido selecionado.',
  session_inactive: 'Esta sessão está fechada.',
  session_not_found: 'Sessão não encontrada.',
  already_voted: 'Erro interno ao gerar identificador da cédula. Tente novamente.'
}

// Página do mesário (acessada via #votacaomanual) para computar, uma a
// uma, as cédulas de papel na urna eletrônica. Cada cédula recebe um
// identificador único e descartável (gerado em memória, nunca salvo),
// reaproveitando a MESMA função submit_vote usada pelos eleitores
// digitais - os votos entram na contagem normalmente.
export default function ManualVotingScreen({ election, onClose }) {
  const activeSessions = (election?.sessions || []).filter(s => s.is_active)
  const [sessionId, setSessionId] = useState(activeSessions[0]?.id || '')
  const [selected, setSelected] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [registeredCount, setRegisteredCount] = useState(0)
  const [zoomCandidate, setZoomCandidate] = useState(null)

  const session = activeSessions.find(s => s.id === sessionId) || activeSessions[0] || null

  useEffect(() => {
    setSelected([])
    setError('')
    setMessage('')
    setRegisteredCount(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id])

  if (!session) {
    return (
      <div className="min-h-screen gradient-bg flex items-center justify-center p-4">
        <div className="glass card-shadow rounded-2xl p-8 max-w-md w-full text-center fade-in">
          <p className="text-slate-700 mb-4">Nenhuma sessão de votação ativa no momento.</p>
          <button onClick={onClose} className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-semibold">Voltar</button>
        </div>
      </div>
    )
  }

  const required = session.votes_required
  const blankCount = selected.filter(s => s === '__blank__').length
  const candidateCount = selected.filter(s => s !== '__blank__').length
  const totalSelected = selected.length

  function toggleCandidate(id) {
    setError('')
    if (selected.includes(id)) {
      setSelected(selected.filter(s => s !== id))
      return
    }
    if (totalSelected >= required) {
      setError(`Total de ${required} voto(s) já atingido. Remova algum para adicionar outro.`)
      return
    }
    setSelected([...selected, id])
  }

  function toggleBlank() {
    setError('')
    if (totalSelected >= required) {
      setError(`Total de ${required} voto(s) já atingido.`)
      return
    }
    setSelected([...selected, '__blank__'])
  }

  function removeBlankAt(idx) {
    const arr = [...selected]
    let count = -1
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === '__blank__') {
        count++
        if (count === idx) { arr.splice(i, 1); break }
      }
    }
    setSelected(arr)
  }

  async function registerBallot() {
    setError('')
    setMessage('')
    if (totalSelected !== required) {
      setError(`Selecione exatamente ${required} voto(s) (candidatos e/ou brancos) antes de registrar.`)
      return
    }
    setSubmitting(true)
    try {
      const candidateIds = selected.filter(s => s !== '__blank__')
      const blankN = selected.filter(s => s === '__blank__').length
      const token = generateManualBallotToken()
      const { data, error: rpcErr } = await supabase.rpc('submit_vote', {
        p_election_id: ELECTION_ID,
        p_session_id: session.id,
        p_voter_token: token,
        p_candidate_ids: candidateIds,
        p_blank_count: blankN,
        p_voter_lat: null,
        p_voter_lng: null
      })
      if (rpcErr) throw rpcErr
      if (data?.error) throw new Error(ERROR_MESSAGES[data.error] || data.error)
      setSelected([])
      setRegisteredCount(n => n + 1)
      setMessage('Voto registrado com sucesso. Pronto para a próxima cédula.')
      setTimeout(() => setMessage(''), 2500)
    } catch (e) {
      setError(e.message || 'Erro ao registrar o voto')
    } finally {
      setSubmitting(false)
    }
  }

  function handleClose() {
    if (confirm('Concluir e liberar o sistema? Será necessário informar a senha novamente para voltar a esta página.')) {
      onClose()
    }
  }

  return (
    <div className="min-h-screen gradient-bg p-4">
      <div className="max-w-2xl mx-auto pt-8 pb-8">
        <div className="glass card-shadow rounded-2xl p-6 md:p-8 fade-in">
          <div className="text-center mb-6">
            <div className="bg-indigo-600 text-white w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-3">
              <Icon name="edit" className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-bold text-slate-800">Votação Manual</h1>
            <p className="text-slate-500 mt-1">Uso do mesário — computar votos registrados em papel</p>
          </div>

          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-sm text-indigo-800 mb-4">
            Selecione a sessão da cédula em mãos, marque os votos exatamente como estão no papel e clique em <b>Registrar Voto</b>. A tela fica pronta em seguida para a próxima cédula da mesma sessão.
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1">Sessão</label>
            <select
              value={session.id}
              onChange={e => setSessionId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            >
              {activeSessions.map(s => (
                <option key={s.id} value={s.id}>{s.title} ({s.votes_required} voto(s))</option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between bg-slate-50 rounded-lg p-3 mb-4 text-sm">
            <span className="text-slate-600">Cédulas registradas nesta sessão nesta página:</span>
            <span className="font-bold text-slate-800 text-lg">{registeredCount}</span>
          </div>

          {error && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm mb-3">{error}</div>}
          {message && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 p-3 rounded-lg text-sm mb-3">{message}</div>}

          <div className="space-y-2 max-h-[24rem] overflow-y-auto mb-4">
            {session.candidates.map(c => (
              <button
                key={c.id}
                onClick={() => toggleCandidate(c.id)}
                className={`w-full text-left p-4 rounded-lg border-2 transition flex items-center gap-3 ${selected.includes(c.id) ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-slate-300 bg-white'}`}
              >
                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${selected.includes(c.id) ? 'border-indigo-600 bg-indigo-600' : 'border-slate-300'}`}>
                  {selected.includes(c.id) && <Icon name="check" className="w-4 h-4 text-white" />}
                </div>
                {c.photo_url ? (
                  <img
                    src={c.photo_url}
                    alt={c.name}
                    onClick={e => { e.stopPropagation(); setZoomCandidate(c) }}
                    className="w-12 h-12 rounded-full object-cover flex-shrink-0 border border-slate-200 cursor-zoom-in hover:opacity-80 transition"
                    title="Clique para ampliar"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0 text-slate-400">
                    <Icon name="user" className="w-6 h-6" />
                  </div>
                )}
                <span className="font-medium flex-1">{c.name}</span>
              </button>
            ))}

            <div className={`rounded-lg border-2 border-dashed p-3 ${blankCount > 0 ? 'border-slate-500 bg-slate-50' : 'border-slate-300 bg-white'}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className="font-medium italic text-slate-600 flex-1">Voto em Branco</span>
                <span className="text-xs text-slate-500">{blankCount}/{required} marcados</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                {Array.from({ length: required }).map((_, idx) => {
                  const isMarked = idx < blankCount
                  return (
                    <button
                      key={idx}
                      onClick={() => isMarked ? removeBlankAt(idx) : toggleBlank()}
                      disabled={!isMarked && blankCount >= required}
                      className={`p-2 rounded border text-xs font-medium transition flex items-center justify-center gap-1 ${
                        isMarked ? 'border-slate-600 bg-slate-600 text-white' : 'border-slate-300 bg-white text-slate-500 hover:border-slate-400'
                      }`}
                    >
                      {isMarked && <Icon name="check" className="w-3 h-3" />}
                      Branco {idx + 1}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="text-sm text-slate-600 text-center p-2 bg-slate-50 rounded-lg mb-4">
            Total: <b>{candidateCount + blankCount}/{required}</b>
            {candidateCount > 0 && <span> · {candidateCount} candidato(s)</span>}
            {blankCount > 0 && <span> · {blankCount} em branco</span>}
          </div>

          <div className="flex gap-2 mb-6">
            <button onClick={() => { setSelected([]); setError('') }} className="flex-1 border border-slate-300 py-3 rounded-lg hover:bg-slate-50">
              Limpar
            </button>
            <button onClick={registerBallot} disabled={submitting} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-lg font-semibold disabled:opacity-50">
              {submitting ? 'Registrando...' : 'Registrar Voto'}
            </button>
          </div>

          <div className="border-t pt-4">
            <button
              onClick={handleClose}
              className="w-full bg-slate-700 hover:bg-slate-800 text-white py-3 rounded-lg font-semibold"
            >
              Concluir e Liberar Sistema
            </button>
          </div>
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
