import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { supabase, ELECTION_ID } from '../lib/supabase'
import { setVoterToken } from '../lib/api'

const ERROR_MESSAGES = {
  invalid_format: 'Digite todos os dígitos do código.',
  code_not_found: 'Código não encontrado. Verifique com a mesa e tente novamente.',
  code_already_used: 'Este código já concluiu a votação em todas as sessões e não pode ser usado novamente.'
}

// Tamanho de cada quadradinho conforme a quantidade de dígitos (definida
// pelo admin, 4 a 8), pra sempre caber confortavelmente no cartão.
const BOX_SIZE_BY_LEN = {
  4: { box: 56, text: 'text-3xl' },
  5: { box: 50, text: 'text-2xl' },
  6: { box: 46, text: 'text-2xl' },
  7: { box: 42, text: 'text-xl' },
  8: { box: 38, text: 'text-xl' }
}

export default function CodeEntryScreen({ election, onValidated, onBack }) {
  const codeLength = Math.min(8, Math.max(4, election?.code_digits || 4))
  const [digits, setDigits] = useState(() => Array(codeLength).fill(''))
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const inputsRef = useRef([])

  // Se o comprimento mudar (ex: dados da eleição chegaram depois), reinicia os campos
  useEffect(() => {
    setDigits(Array(codeLength).fill(''))
  }, [codeLength])

  const { box: boxSize, text: textClass } = BOX_SIZE_BY_LEN[codeLength] || BOX_SIZE_BY_LEN[4]

  function focusInput(idx) {
    inputsRef.current[idx]?.focus()
    inputsRef.current[idx]?.select()
  }

  function handleChange(idx, rawValue) {
    const value = rawValue.replace(/[^0-9]/g, '').slice(-1)
    setError('')
    setDigits(prev => {
      const next = [...prev]
      next[idx] = value
      return next
    })
    if (value && idx < codeLength - 1) focusInput(idx + 1)
  }

  function handleKeyDown(idx, e) {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
      focusInput(idx - 1)
    }
    if (e.key === 'Enter') {
      submitCode()
    }
  }

  function handlePaste(e) {
    const text = e.clipboardData.getData('text').replace(/[^0-9]/g, '').slice(0, codeLength)
    if (!text) return
    e.preventDefault()
    const next = Array(codeLength).fill('')
    for (let i = 0; i < text.length; i++) next[i] = text[i]
    setDigits(next)
    setError('')
    focusInput(Math.min(text.length, codeLength) - 1)
  }

  async function submitCode() {
    const code = digits.join('')
    if (code.length !== codeLength) {
      setError('Digite todos os dígitos do código.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const { data, error: rpcErr } = await supabase.rpc('redeem_voter_code', {
        p_election_id: ELECTION_ID,
        p_code: code
      })
      if (rpcErr) throw rpcErr
      if (data?.error) {
        setError(ERROR_MESSAGES[data.error] || 'Código inválido.')
        setDigits(Array(codeLength).fill(''))
        focusInput(0)
        return
      }
      setVoterToken(data.voter_token)
      onValidated()
    } catch (e) {
      setError(e.message || 'Erro ao validar o código. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen gradient-bg flex items-center justify-center p-4">
      <div className="glass card-shadow rounded-2xl p-8 max-w-md w-full fade-in">
        <div className="text-center mb-6">
          <div className="bg-indigo-600 text-white w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Icon name="lock" className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Código de Votação</h1>
          <p className="text-sm text-slate-500 mt-2">
            Digite o código de {codeLength} dígitos fornecido pela mesa para iniciar sua votação em{' '}
            <b>{election?.name || 'Urna Eletrônica'}</b>.
          </p>
        </div>

        <div className="flex justify-center gap-2 mb-4 flex-wrap" onPaste={handlePaste}>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={el => { inputsRef.current[i] = el }}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={1}
              value={d}
              onChange={e => handleChange(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              disabled={loading}
              autoFocus={i === 0}
              style={{ width: boxSize, height: boxSize * 1.15 }}
              className={`text-center ${textClass} font-bold text-slate-800 border-2 border-slate-300 rounded-xl focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none disabled:opacity-50 transition`}
            />
          ))}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm mb-4 text-center fade-in">
            {error}
          </div>
        )}

        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-xs text-indigo-800 text-center mb-5">
          🔒 O código libera o voto em todas as sessões desta urna. Ele só é bloqueado <b>depois de concluir todas as sessões</b> — se você parar no meio, pode digitá-lo novamente (inclusive em outro dispositivo) para continuar de onde parou.
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onBack}
            disabled={loading}
            className="flex-1 border border-slate-300 py-3 rounded-lg text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={submitCode}
            disabled={loading}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-lg font-semibold disabled:opacity-50"
          >
            {loading ? 'Validando...' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}
