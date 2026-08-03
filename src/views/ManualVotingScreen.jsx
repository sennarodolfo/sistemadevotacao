import { useState, useRef, useEffect } from 'react'
import { Icon } from '../components/Icon'
import PhotoLightbox from '../components/PhotoLightbox'
import { supabase, ELECTION_ID } from '../lib/supabase'

const CODE_ERROR_MESSAGES = {
  invalid_format: 'Digite os 4 dígitos da cédula.',
  code_not_found: 'Cédula não encontrada. Verifique o código impresso.',
  code_already_used: 'Esta cédula já foi utilizada. Cada cédula só pode ser computada uma vez.'
}

const VOTE_ERROR_MESSAGES = {
  wrong_count: 'Quantidade de votos incorreta para esta sessão.',
  invalid_candidate: 'Candidato inválido selecionado.',
  session_inactive: 'Esta sessão está fechada.',
  session_not_found: 'Sessão não encontrada.',
  already_voted: 'Esta cédula já votou nesta sessão.'
}

function findNextPendingIdx(sessions, completed) {
  for (let i = 0; i < sessions.length; i++) {
    if (!completed.some(c => c.session_id === sessions[i].id)) return i
  }
  return -1
}

// Página do mesário (#votacaomanual). O código da cédula é digitado UMA
// ÚNICA VEZ e libera TODAS as sessões em sequência - exatamente como o
// eleitor digital - reaproveitando as mesmas RPCs (submit_vote,
// get_voter_status, finalize_election). O código vem de um espaço
// totalmente separado dos códigos do eleitor (redeem_manual_code /
// tabela manual_ballot_codes), então nunca colide com eles.
export default function ManualVotingScreen({ election, onClose }) {
  const activeSessions = (election?.sessions || []).filter(s => s.is_active)

  const [phase, setPhase] = useState('codeEntry') // codeEntry | voting | ballotDone
  const [ballotCount, setBallotCount] = useState(0)

  // ----- Entrada do código -----
  const [digits, setDigits] = useState(['', '', '', ''])
  const [codeError, setCodeError] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const inputsRef = useRef([])

  // ----- Estado da cédula em processamento -----
  const [token, setToken] = useState(null)
  const [currentCode, setCurrentCode] = useState('')
  const [completed, setCompleted] = useState([])
  const [sessionIdx, setSessionIdx] = useState(0)
  const [selected, setSelected] = useState([])
  const [voteError, setVoteError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [zoomCandidate, setZoomCandidate] = useState(null)

  const session = activeSessions[sessionIdx] || null

  useEffect(() => {
    setSelected([])
    setVoteError('')
  }, [sessionIdx])

  function focusInput(idx) {
    inputsRef.current[idx]?.focus()
    inputsRef.current[idx]?.select()
  }

  function handleDigitChange(idx, raw) {
    const value = raw.replace(/[^0-9]/g, '').slice(-1)
    setCodeError('')
    setDigits(prev => {
      const next = [...prev]
      next[idx] = value
      return next
    })
    if (value && idx < 3) focusInput(idx + 1)
  }

  function handleDigitKeyDown(idx, e) {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) focusInput(idx - 1)
    if (e.key === 'Enter') redeemCode()
  }

  function handlePaste(e) {
    const text = e.clipboardData.getData('text').replace(/[^0-9]/g, '').slice(0, 4)
    if (!text) return
    e.preventDefault()
    const next = ['', '', '', '']
    for (let i = 0; i < text.length; i++) next[i] = text[i]
    setDigits(next)
    setCodeError('')
    focusInput(Math.min(text.length, 4) - 1)
  }

  async function redeemCode() {
    const code = digits.join('')
    if (code.length !== 4) {
      setCodeError('Digite os 4 dígitos da cédula.')
      return
    }
    if (activeSessions.length === 0) {
      setCodeError('Nenhuma sessão de votação ativa no momento.')
      return
    }
    setCodeError('')
    setRedeeming(true)
    try {
      const { data, error: rpcErr } = await supabase.rpc('redeem_manual_code', {
        p_election_id: ELECTION_ID,
        p_code: code
      })
      if (rpcErr) throw rpcErr
      if (data?.error) {
        setCodeError(CODE_ERROR_MESSAGES[data.error] || 'Código inválido.')
        setDigits(['', '', '', ''])
        focusInput(0)
        return
      }
      setToken(data.voter_token)
      setCurrentCode(code)
      setCompleted([])
      setSessionIdx(findNextPendingIdx(activeSessions, []))
      setDigits(['', '', '', ''])
      setPhase('voting')
    } catch (e) {
      setCodeError(e.message || 'Erro ao validar a cédula.')
    } finally {
      setRedeeming(false)
    }
  }

  // ----- Seleção de candidatos (mesma lógica do eleitor) -----
  const required = session?.votes_required || 0
  const blankCount = selected.filter(s => s === '__blank__').length
  const candidateCount = selected.filter(s => s !== '__blank__').length
  const totalSelected = selected.length

  function toggleCandidate(id) {
    setVoteError('')
    if (selected.includes(id)) {
      setSelected(selected.filter(s => s !== id))
      return
    }
    if (totalSelected >= required) {
      setVoteError(`Total de ${required} voto(s) já atingido. Remova algum para adicionar outro.`)
      return
    }
    setSelected([...selected, id])
  }

  function toggleBlank() {
    setVoteError('')
    if (totalSelected >= required) {
      setVoteError(`Total de ${required} voto(s) já atingido.`)
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

  async function submitSessionVote() {
    setVoteError('')
    if (totalSelected !== required) {
      setVoteError(`Selecione exatamente ${required} voto(s) (candidatos e/ou brancos) antes de confirmar.`)
      return
    }
    setSubmitting(true)
    try {
      const candidateIds = selected.filter(s => s !== '__blank__')
      const blankN = selected.filter(s => s === '__blank__').length
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
      if (data?.error) throw new Error(VOTE_ERROR_MESSAGES[data.error] || data.error)

      const newCompleted = [...completed, { session_id: session.id }]
      setCompleted(newCompleted)

      const nextIdx = findNextPendingIdx(activeSessions, newCompleted)
      if (nextIdx === -1) {
        await finalizeBallot()
      } else {
        setSessionIdx(nextIdx)
      }
    } catch (e) {
      setVoteError(e.message || 'Erro ao registrar o voto.')
    } finally {
      setSubmitting(false)
    }
  }

  async function finalizeBallot() {
    try {
      const { data, error: rpcErr } = await supabase.rpc('finalize_election', {
        p_election_id: ELECTION_ID,
        p_voter_token: token
      })
      if (rpcErr) throw rpcErr
      if (data?.error) throw new Error(data.error)
      setBallotCount(n => n + 1)
      setPhase('ballotDone')
    } catch (e) {
      setVoteError(e.message || 'Erro ao concluir a cédula.')
    }
  }

  function startNextBallot() {
    setToken(null)
    setCurrentCode('')
    setCompleted([])
    setSessionIdx(0)
    setSelected([])
    setVoteError('')
    setDigits(['', '', '', ''])
    setPhase('codeEntry')
  }

  function handleClose() {
    if (confirm('Concluir e liberar o sistema? Será necessário informar a senha novamente para voltar a esta página.')) {
      onClose()
    }
  }

  // ===== Tela: nenhuma sessão ativa =====
  if (activeSessions.length === 0) {
    return (
      <div className="min-h-screen gradient-bg flex items-center justify-center p-4">
        <div className="glass card-shadow rounded-2xl p-8 max-w-md w-full text-center fade-in">
          <p className="text-slate-700 mb-4">Nenhuma sessão de votação ativa no momento.</p>
          <button onClick={onClose} className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-semibold">Voltar</button>
        </div>
      </div>
    )
  }

  // ===== Tela: entrada do código da cédula =====
  if (phase === 'codeEntry') {
    return (
      <div className="min-h-screen gradient-bg flex items-center justify-center p-4">
        <div className="glass card-shadow rounded-2xl p-8 max-w-md w-full fade-in">
          <div className="text-center mb-6">
            <div className="bg-indigo-600 text-white w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Icon name="edit" className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Votação Manual</h1>
            <p className="text-sm text-slate-500 mt-2">
              Digite o código de 4 dígitos impresso na cédula de papel para liberar o lançamento dos votos em todas as sessões.
            </p>
          </div>

          <div className="flex justify-center gap-3 mb-4" onPaste={handlePaste}>
            {digits.map((d, i) => (
              <input
                key={i}
                ref={el => { inputsRef.current[i] = el }}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={1}
                value={d}
                onChange={e => handleDigitChange(i, e.target.value)}
                onKeyDown={e => handleDigitKeyDown(i, e)}
                disabled={redeeming}
                autoFocus={i === 0}
                className="w-14 h-16 text-center text-3xl font-bold text-slate-800 border-2 border-slate-300 rounded-xl focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none disabled:opacity-50 transition"
              />
            ))}
          </div>

          {codeError && (
            <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm mb-4 text-center fade-in">
              {codeError}
            </div>
          )}

          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-xs text-indigo-800 text-center mb-4">
            🔒 Cada cédula tem um código próprio (diferente dos códigos do eleitor) e só pode ser usada <b>uma vez</b>.
          </div>

          {ballotCount > 0 && (
            <p className="text-xs text-center text-slate-500 mb-4">Cédulas computadas nesta sessão de trabalho: <b>{ballotCount}</b></p>
          )}

          <div className="flex gap-2 mb-4">
            <button
              type="button"
              onClick={redeemCode}
              disabled={redeeming}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-lg font-semibold disabled:opacity-50"
            >
              {redeeming ? 'Validando...' : 'Confirmar Cédula'}
            </button>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className="w-full bg-slate-700 hover:bg-slate-800 text-white py-3 rounded-lg font-semibold"
          >
            Concluir e Liberar Sistema
          </button>
        </div>
      </div>
    )
  }

  // ===== Tela: cédula concluída =====
  if (phase === 'ballotDone') {
    return (
      <div className="min-h-screen gradient-bg flex items-center justify-center p-4">
        <div className="glass card-shadow rounded-2xl p-8 max-w-md w-full text-center fade-in">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Icon name="check" className="w-8 h-8 text-emerald-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-800 mb-2">Cédula {currentCode} computada</h1>
          <p className="text-slate-600 mb-1 text-sm">Todos os votos desta cédula foram registrados com sucesso.</p>
          <p className="text-slate-500 mb-6 text-sm">Cédulas computadas nesta sessão de trabalho: <b>{ballotCount}</b></p>
          <div className="flex flex-col gap-2">
            <button onClick={startNextBallot} className="bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-lg font-semibold">
              Computar Próxima Cédula
            </button>
            <button onClick={handleClose} className="bg-slate-700 hover:bg-slate-800 text-white py-3 rounded-lg font-semibold">
              Concluir e Liberar Sistema
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ===== Tela: votação da sessão atual =====
  return (
    <div className="min-h-screen gradient-bg p-4">
      <div className="max-w-2xl mx-auto pt-8 pb-8">
        <div className="glass card-shadow rounded-2xl p-6 md:p-8 fade-in">
          <div className="text-center mb-6">
            <div className="bg-indigo-600 text-white w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-3">
              <Icon name="vote" className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-bold text-slate-800">{session.title}</h1>
            <p className="text-slate-500 mt-1">{election.name}</p>
            <p className="text-xs text-slate-400 mt-1">Cédula {currentCode} · Sessão {completed.length + 1} de {activeSessions.length}</p>
          </div>

          <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg text-sm text-amber-800 mb-4">
            📋 Marque exatamente <b>{required} voto(s)</b> como estão na cédula de papel. Pode misturar candidatos e brancos livremente.
          </div>

          {voteError && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm mb-3">{voteError}</div>}

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

          <div className="flex gap-2">
            <button onClick={() => { setSelected([]); setVoteError('') }} className="flex-1 border border-slate-300 py-3 rounded-lg hover:bg-slate-50">
              Limpar
            </button>
            <button onClick={submitSessionVote} disabled={submitting} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-lg font-semibold disabled:opacity-50">
              {submitting ? 'Enviando...' : (completed.length + 1 >= activeSessions.length ? 'Confirmar e Concluir Cédula' : 'Confirmar e Ir para Próxima Sessão')}
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
