import { useState } from 'react'
import { Icon } from '../components/Icon'
import { supabase } from '../lib/supabase'

// Tela de login/cadastro do ORGANIZADOR (quem cria e administra
// eleições) - usa contas reais do Supabase Auth (e-mail + senha). O
// ELEITOR nunca passa por aqui: ele só digita o código de votação.
export default function AuthScreen({ onAuthenticated, onBack }) {
  const [mode, setMode] = useState('login') // login | signup | forgot
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  function switchMode(next) {
    setMode(next)
    setError('')
    setMessage('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setMessage('')

    if (!email.trim()) {
      setError('Informe seu e-mail.')
      return
    }

    if (mode === 'forgot') {
      setLoading(true)
      try {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim())
        if (err) throw err
        setMessage('Se este e-mail tiver uma conta, enviamos um link para redefinir a senha.')
      } catch (err) {
        setError(err.message || 'Erro ao solicitar redefinição de senha.')
      } finally {
        setLoading(false)
      }
      return
    }

    if (password.length < 6) {
      setError('A senha precisa ter pelo menos 6 caracteres.')
      return
    }
    if (mode === 'signup' && password !== confirmPassword) {
      setError('As senhas não coincidem.')
      return
    }

    setLoading(true)
    try {
      if (mode === 'signup') {
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password
        })
        if (err) throw err
        if (data.session) {
          onAuthenticated()
        } else {
          setMessage('Conta criada! Verifique seu e-mail para confirmar o cadastro antes de entrar.')
          setMode('login')
        }
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password
        })
        if (err) throw err
        onAuthenticated()
      }
    } catch (err) {
      setError(
        err.message === 'Invalid login credentials'
          ? 'E-mail ou senha incorretos.'
          : err.message || 'Erro ao autenticar.'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen gradient-bg flex items-center justify-center p-4">
      <div className="glass card-shadow rounded-2xl p-8 max-w-md w-full fade-in">
        <div className="text-center mb-6">
          <div className="bg-indigo-600 text-white w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Icon name="user" className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">
            {mode === 'signup' ? 'Criar Conta' : mode === 'forgot' ? 'Redefinir Senha' : 'Entrar'}
          </h1>
          <p className="text-sm text-slate-500 mt-2">
            {mode === 'signup'
              ? 'Crie sua conta para configurar e gerenciar suas próprias eleições.'
              : mode === 'forgot'
              ? 'Informe seu e-mail para receber o link de redefinição.'
              : 'Entre para acessar suas eleições.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">E-mail</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={loading}
              autoFocus
              className="w-full px-4 py-2 border border-slate-300 rounded-lg disabled:opacity-50"
              placeholder="voce@exemplo.com"
            />
          </div>

          {mode !== 'forgot' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Senha</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={loading}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg disabled:opacity-50"
                placeholder="Mínimo de 6 caracteres"
              />
            </div>
          )}

          {mode === 'signup' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Confirmar senha</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                disabled={loading}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg disabled:opacity-50"
              />
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">{error}</div>
          )}
          {message && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 p-3 rounded-lg text-sm">{message}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-lg font-semibold disabled:opacity-50"
          >
            {loading ? 'Aguarde...' : mode === 'signup' ? 'Criar Conta' : mode === 'forgot' ? 'Enviar Link' : 'Entrar'}
          </button>
        </form>

        <div className="text-center mt-4 text-sm space-y-2">
          {mode === 'login' && (
            <>
              <button type="button" onClick={() => switchMode('forgot')} className="text-indigo-600 hover:underline block w-full">
                Esqueci minha senha
              </button>
              <p className="text-slate-500">
                Não tem conta?{' '}
                <button type="button" onClick={() => switchMode('signup')} className="text-indigo-600 hover:underline font-medium">
                  Criar conta
                </button>
              </p>
            </>
          )}
          {(mode === 'signup' || mode === 'forgot') && (
            <p className="text-slate-500">
              <button type="button" onClick={() => switchMode('login')} className="text-indigo-600 hover:underline font-medium">
                Voltar para o login
              </button>
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={onBack}
          className="w-full mt-4 border border-slate-300 py-2 rounded-lg text-slate-600 hover:bg-slate-50 text-sm"
        >
          Voltar para a urna
        </button>
      </div>
    </div>
  )
}
