import { useState, useEffect } from 'react'
import { Icon } from '../components/Icon'
import { supabase, ELECTION_ID } from '../lib/supabase'
import { getVoterToken } from '../lib/api'

export default function VotingScreen({ election, session, onVoted }) {
  // A identificação do eleitor (voter_token) já foi validada antes de
  // chegar aqui, via o código de votação digitado na CodeEntryScreen.
  const [error, setError] = useState('')
  const [selected, setSelected] = useState([])
  const [submitting, setSubmitting] = useState(false)

  // Quando muda a sessão, limpa a seleção.
  useEffect(() => {
    setError('')
    setSelected([])
  }, [session.id])

  const blankCount = selected.filter(s => s === '__blank__').length
  const candidateCount = selected.filter(s => s !== '__blank__').length
  const totalSelected = selected.length
  const required = session.votes_required

  function toggleCandidate(id) {
    setError('')
    if (selected.includes(id)) {
      setSelected(selected.filter(s => s !== id))
      return
    }
    if (totalSelected >= required) {
      setError(`Você já atingiu o total de ${required} votos. Remova algum para adicionar outro.`)
      setTimeout(() => setError(''), 3000)
      return
    }
    setSelected([...selected, id])
  }

  function toggleBlank() {
    setError('')
    if (totalSelected >= required) {
      setError(`Você já atingiu o total de ${required} votos.`)
      setTimeout(() => setError(''), 3000)
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

  async function submitVote() {
    setError('')
    if (totalSelected !== required) {
      setError(`Você deve completar exatamente ${required} votos no total.`)
      return
    }
    setSubmitting(true)
    try {
      const candidateIds = selected.filter(s => s !== '__blank__')
      const blankN = selected.filter(s => s === '__blank__').length
      const token = getVoterToken()
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
      if (data?.error) {
        const messages = {
          already_voted: 'Você já votou nesta sessão.',
          wrong_count: `Quantidade incorreta de votos.`,
          invalid_candidate: 'Candidato inválido selecionado.',
          session_closed: 'Esta sessão está fechada.'
        }
        throw new Error(messages[data.error] || data.error)
      }
      onVoted({ sessionId: session.id, result: data })
    } catch (e) {
      setError(e.message || 'Erro ao enviar o voto')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen gradient-bg p-4">
      <div className="max-w-2xl mx-auto pt-8">
        <div className="glass card-shadow rounded-2xl p-6 md:p-8 fade-in">
          <div className="text-center mb-6">
            <div className="bg-indigo-600 text-white w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-3">
              <Icon name="vote" className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-bold text-slate-800">{session.title}</h1>
            <p className="text-slate-500 mt-1">{election.name}</p>
          </div>

          <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg text-sm text-amber-800 mb-4">
            📋 Você deve preencher exatamente <b>{required} votos</b>. Pode misturar candidatos e brancos livremente.
          </div>

          {error && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm mb-3">{error}</div>}

          <div className="space-y-2 max-h-[28rem] overflow-y-auto mb-4">
            {session.candidates.map((c) => (
              <button
                key={c.id}
                onClick={() => toggleCandidate(c.id)}
                className={`w-full text-left p-4 rounded-lg border-2 transition flex items-center gap-3 ${selected.includes(c.id) ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-slate-300 bg-white'}`}
              >
                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${selected.includes(c.id) ? 'border-indigo-600 bg-indigo-600' : 'border-slate-300'}`}>
                  {selected.includes(c.id) && <Icon name="check" className="w-4 h-4 text-white" />}
                </div>
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
                      Branco {idx+1}
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

          <div className="flex gap-2">
            <button onClick={() => { setSelected([]); setError('') }} className="flex-1 border border-slate-300 py-3 rounded-lg hover:bg-slate-50">
              Limpar
            </button>
            <button onClick={submitVote} disabled={submitting} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-lg font-semibold disabled:opacity-50">
              {submitting ? 'Enviando...' : 'Confirmar Voto'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
