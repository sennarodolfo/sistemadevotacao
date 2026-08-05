import { useState, useRef } from 'react'
import { Icon } from '../components/Icon'
import { supabase, ELECTION_ID } from '../lib/supabase'
import { loadImageFile } from '../lib/imageGeometry'
import { warpBallotPhoto, readMarks, readCode } from '../lib/manualBallotRecognition'

const CORNER_LABELS = [
  'Toque no canto SUPERIOR ESQUERDO da cédula',
  'Toque no canto SUPERIOR DIREITO da cédula',
  'Toque no canto INFERIOR DIREITO da cédula',
  'Toque no canto INFERIOR ESQUERDO da cédula'
]

const CODE_ERROR_MESSAGES = {
  invalid_format: 'Código reconhecido não tem dígitos válidos suficientes - corrija manualmente.',
  code_not_found: 'Código não encontrado. Confira se os dígitos foram lidos corretamente.',
  code_already_used: 'Este código já foi bloqueado e não pode ser usado novamente.'
}

const VOTE_ERROR_MESSAGES = {
  already_voted: 'Esta cédula já votou nesta sessão.',
  wrong_count: 'Quantidade de votos incorreta.',
  invalid_candidate: 'Candidato inválido selecionado.',
  session_inactive: 'Esta sessão está fechada.',
  session_not_found: 'Sessão não encontrada.'
}

function groupMarksForSession(session, marks) {
  return {
    session_id: session.id,
    title: session.title,
    votes_required: session.votes_required,
    candidates: marks
      .filter(m => m.session_id === session.id)
      .map(m => ({ candidate_id: m.candidate_id, name: m.candidate_name, marked: m.marked, darkness: m.darkness }))
  }
}

export default function BallotScanView({ election }) {
  const activeSessions = (election?.sessions || []).filter(s => s.is_active)
  const codeLength = Math.min(8, Math.max(4, election?.code_digits || 4))

  const [selectedSessionId, setSelectedSessionId] = useState(activeSessions[0]?.id || '')
  const selectedSession = activeSessions.find(s => s.id === selectedSessionId) || null

  const [step, setStep] = useState('capture') // capture | corners | processing | review | done
  const [error, setError] = useState('')
  const [processedCount, setProcessedCount] = useState(0)

  const imgRef = useRef(null)
  const [imgUrl, setImgUrl] = useState(null)
  const [imgNatural, setImgNatural] = useState({ w: 0, h: 0 })
  const [corners, setCorners] = useState([])

  const [warpedPreview, setWarpedPreview] = useState(null)
  const warpedCanvasRef = useRef(null)

  const [recognizedCode, setRecognizedCode] = useState('')
  const [codeConfidence, setCodeConfidence] = useState(null)
  const [sessionReview, setSessionReview] = useState(null)

  const [submitting, setSubmitting] = useState(false)
  const [receiptCode, setReceiptCode] = useState('')

  const fileInputRef = useRef(null)
  const cameraInputRef = useRef(null)

  async function handleFile(file) {
    if (!file) return
    setError('')
    try {
      const img = await loadImageFile(file)
      imgRef.current = img
      setImgUrl(img.src)
      setImgNatural({ w: img.naturalWidth, h: img.naturalHeight })
      setCorners([])
      setStep('corners')
    } catch (e) {
      setError(e.message || 'Erro ao carregar a foto')
    }
  }

  function handleImageClick(e) {
    if (corners.length >= 4) return
    const rect = e.currentTarget.getBoundingClientRect()
    const scaleX = imgNatural.w / rect.width
    const scaleY = imgNatural.h / rect.height
    const x = (e.clientX - rect.left) * scaleX
    const y = (e.clientY - rect.top) * scaleY
    setCorners([...corners, { x, y }])
  }

  function undoCorner() {
    setCorners(corners.slice(0, -1))
  }

  async function processBallot() {
    if (corners.length !== 4 || !selectedSession) return
    setStep('processing')
    setError('')
    try {
      const warped = warpBallotPhoto(imgRef.current, corners)
      warpedCanvasRef.current = warped
      setWarpedPreview(warped.toDataURL('image/jpeg', 0.85))

      const marks = readMarks(warped, [selectedSession])
      setSessionReview(groupMarksForSession(selectedSession, marks))

      const codeResult = await readCode(warped, [selectedSession], codeLength)
      setRecognizedCode(codeResult.digits)
      setCodeConfidence(codeResult.confidence)

      setStep('review')
    } catch (e) {
      setError(e.message || 'Erro ao processar a cédula. Tente novamente com uma foto mais nítida.')
      setStep('corners')
    }
  }

  function toggleCandidate(candidateId) {
    setSessionReview(prev => prev && ({
      ...prev,
      candidates: prev.candidates.map(c => c.candidate_id === candidateId ? { ...c, marked: !c.marked } : c)
    }))
  }

  const markedCount = sessionReview ? sessionReview.candidates.filter(c => c.marked).length : 0
  const isOvervote = sessionReview ? markedCount > sessionReview.votes_required : false

  async function confirmAndSubmit() {
    setError('')
    if (!sessionReview) return
    const code = recognizedCode.replace(/[^0-9]/g, '')
    if (code.length !== codeLength) {
      setError(`O código precisa ter ${codeLength} dígitos. Corrija o campo antes de confirmar.`)
      return
    }
    if (isOvervote) {
      setError(`Há mais candidatos marcados do que o permitido (${sessionReview.votes_required}). Corrija antes de confirmar.`)
      return
    }

    setSubmitting(true)
    try {
      const { data: redeemData, error: redeemErr } = await supabase.rpc('redeem_manual_code', {
        p_election_id: ELECTION_ID,
        p_code: code
      })
      if (redeemErr) throw redeemErr
      if (redeemData?.error) throw new Error(CODE_ERROR_MESSAGES[redeemData.error] || redeemData.error)
      const token = redeemData.voter_token

      const candidateIds = sessionReview.candidates.filter(c => c.marked).map(c => c.candidate_id)
      const blankCount = Math.max(0, sessionReview.votes_required - candidateIds.length)
      const { data: voteData, error: voteErr } = await supabase.rpc('submit_vote', {
        p_election_id: ELECTION_ID,
        p_session_id: sessionReview.session_id,
        p_voter_token: token,
        p_candidate_ids: candidateIds,
        p_blank_count: blankCount,
        p_voter_lat: null,
        p_voter_lng: null
      })
      if (voteErr) throw voteErr
      if (voteData?.error) throw new Error(VOTE_ERROR_MESSAGES[voteData.error] || voteData.error)

      setReceiptCode(voteData.session_receipt || '')
      setProcessedCount(n => n + 1)
      setStep('done')
    } catch (e) {
      setError(e.message || 'Erro ao registrar os votos da cédula.')
    } finally {
      setSubmitting(false)
    }
  }

  function reset() {
    setStep('capture')
    setError('')
    setImgUrl(null)
    setImgNatural({ w: 0, h: 0 })
    setCorners([])
    setWarpedPreview(null)
    setRecognizedCode('')
    setCodeConfidence(null)
    setSessionReview(null)
    setReceiptCode('')
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (cameraInputRef.current) cameraInputRef.current.value = ''
  }

  if (activeSessions.length === 0) {
    return (
      <div className="bg-white card-shadow rounded-2xl p-6 fade-in text-center text-slate-500">
        Nenhuma sessão de votação ativa no momento.
      </div>
    )
  }

  return (
    <div className="bg-white card-shadow rounded-2xl p-6 fade-in space-y-5">
      <div>
        <h2 className="text-lg font-bold text-slate-800">Leitura de Cédulas por Foto</h2>
        <p className="text-sm text-slate-500 mt-1">
          Cada cédula pertence a UMA sessão. Fotografe ou envie a imagem de uma cédula manual preenchida daquela sessão — o sistema reconhece o código e as marcações automaticamente, você confere e confirma antes de o voto ser computado.
        </p>
        {processedCount > 0 && (
          <p className="text-xs text-emerald-600 font-medium mt-1">✅ {processedCount} cédula(s) computada(s) nesta sessão de trabalho.</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Sessão desta cédula</label>
        <select
          value={selectedSessionId}
          onChange={e => setSelectedSessionId(e.target.value)}
          disabled={step !== 'capture'}
          className="w-full max-w-sm px-3 py-2 border border-slate-300 rounded-lg disabled:opacity-50 disabled:bg-slate-50"
        >
          {activeSessions.map(s => (
            <option key={s.id} value={s.id}>{s.title}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">{error}</div>
      )}

      {step === 'capture' && (
        <div className="flex flex-wrap gap-3">
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={e => handleFile(e.target.files?.[0])}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => handleFile(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-3 rounded-lg font-semibold flex items-center gap-2"
          >
            <Icon name="upload" className="w-5 h-5" /> Usar Câmera
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="bg-slate-700 hover:bg-slate-800 text-white px-5 py-3 rounded-lg font-semibold flex items-center gap-2"
          >
            <Icon name="upload" className="w-5 h-5" /> Escolher Arquivo
          </button>
        </div>
      )}

      {step === 'corners' && imgUrl && (
        <div>
          <div className="bg-indigo-50 border border-indigo-200 text-indigo-800 text-sm rounded-lg p-3 mb-3">
            <b>{corners.length < 4 ? CORNER_LABELS[corners.length] : 'Todos os cantos marcados!'}</b>
            {' '}({corners.length}/4)
          </div>
          <div className="relative inline-block max-w-full border border-slate-300 rounded-lg overflow-hidden">
            <img
              src={imgUrl}
              alt="Cédula fotografada"
              onClick={handleImageClick}
              className="max-w-full max-h-[70vh] cursor-crosshair select-none"
              draggable={false}
            />
            {corners.map((c, i) => (
              <div
                key={i}
                className="absolute w-6 h-6 -ml-3 -mt-3 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center border-2 border-white shadow pointer-events-none"
                style={{ left: `${(c.x / imgNatural.w) * 100}%`, top: `${(c.y / imgNatural.h) * 100}%` }}
              >
                {i + 1}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" onClick={undoCorner} disabled={corners.length === 0}
              className="border border-slate-300 px-4 py-2 rounded-lg text-sm disabled:opacity-50 hover:bg-slate-50">
              Desfazer Ponto
            </button>
            <button type="button" onClick={reset}
              className="border border-slate-300 px-4 py-2 rounded-lg text-sm hover:bg-slate-50">
              Trocar Foto
            </button>
            <button type="button" onClick={processBallot} disabled={corners.length !== 4}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center gap-2 ml-auto">
              <Icon name="check" className="w-4 h-4" /> Processar Cédula
            </button>
          </div>
        </div>
      )}

      {step === 'processing' && (
        <div className="text-center py-12">
          <div className="w-10 h-10 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-500 text-sm">Corrigindo perspectiva, lendo o código e as marcações...</p>
        </div>
      )}

      {step === 'review' && sessionReview && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-1">
              <p className="text-xs font-semibold text-slate-500 mb-1 uppercase">Cédula corrigida</p>
              {warpedPreview && <img src={warpedPreview} alt="Cédula corrigida" className="w-full border border-slate-200 rounded-lg" />}
            </div>
            <div className="md:col-span-2 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Código reconhecido
                  {codeConfidence != null && (
                    <span className={`ml-2 text-xs font-normal ${codeConfidence < 60 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      (confiança OCR: {Math.round(codeConfidence)}%)
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={codeLength}
                  value={recognizedCode}
                  onChange={e => setRecognizedCode(e.target.value.replace(/[^0-9]/g, '').slice(0, codeLength))}
                  className={`w-32 px-3 py-2 border rounded-lg text-center font-mono text-2xl tracking-widest ${recognizedCode.length === codeLength ? 'border-slate-300' : 'border-amber-400 bg-amber-50'}`}
                  placeholder={'0'.repeat(codeLength)}
                />
                <p className="text-xs text-slate-400 mt-1">Confira com o código impresso na cédula e corrija se necessário.</p>
              </div>

              {isOvervote && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-2">
                  ⚠️ Excesso de marcações em {sessionReview.title}. Desmarque candidatos antes de confirmar.
                </div>
              )}

              <div className={`border rounded-lg p-3 ${isOvervote ? 'border-red-300 bg-red-50/40' : 'border-slate-200'}`}>
                <div className="flex items-center justify-between mb-2">
                  <p className="font-semibold text-sm text-slate-700">{sessionReview.title}</p>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${isOvervote ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                    {markedCount}/{sessionReview.votes_required} marcados
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                  {sessionReview.candidates.map(c => (
                    <label key={c.candidate_id} className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm ${c.marked ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                      <input type="checkbox" checked={c.marked} onChange={() => toggleCandidate(c.candidate_id)} className="w-4 h-4" />
                      <span className={c.marked ? 'font-medium text-slate-800' : 'text-slate-600'}>{c.name}</span>
                    </label>
                  ))}
                </div>
                {markedCount < sessionReview.votes_required && (
                  <p className="text-xs text-slate-400 mt-1">{sessionReview.votes_required - markedCount} voto(s) em branco (nenhuma marcação reconhecida).</p>
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-2 border-t pt-4">
            <button type="button" onClick={reset} className="flex-1 border border-slate-300 py-3 rounded-lg hover:bg-slate-50">
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmAndSubmit}
              disabled={submitting}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-lg font-semibold disabled:opacity-50"
            >
              {submitting ? 'Registrando...' : 'Confirmar e Registrar Voto'}
            </button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="text-center py-10">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Icon name="check" className="w-8 h-8 text-emerald-600" />
          </div>
          <h3 className="text-lg font-bold text-slate-800 mb-1">Voto registrado com sucesso</h3>
          {receiptCode && <p className="text-sm text-slate-500 mb-6">Comprovante: <span className="font-mono text-indigo-700">{receiptCode}</span></p>}
          <button type="button" onClick={reset} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-lg font-semibold">
            Ler Próxima Cédula
          </button>
        </div>
      )}
    </div>
  )
}
