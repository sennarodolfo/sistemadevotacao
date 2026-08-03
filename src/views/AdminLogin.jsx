import { useState } from 'react'
import { Icon } from '../components/Icon'
import { supabase, ELECTION_ID } from '../lib/supabase'

export default function AdminLogin({ onLogin, onBack }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data, error: rpcErr } = await supabase.rpc('verify_admin', {
        p_election_id: ELECTION_ID,
        p_password: password
      })
      if (rpcErr) throw rpcErr
      if (!data) {
        setError('Senha incorreta')
        setLoading(false)
        return
      }
      onLogin(password)
    } catch (e) {
      setError(e.message || 'Erro ao verificar senha')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen gradient-bg flex items-center justify-center p-4">
      <div className="glass card-shadow rounded-2xl p-8 max-w-md w-full fade-in">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-indigo-600 text-white p-3 rounded-xl">
            <Icon name="lock" className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Painel Administrativo</h1>
            <p className="text-sm text-slate-500">Acesso restrito</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Senha de administrador</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              placeholder="Digite a senha"
              autoFocus
              disabled={loading}
            />
            {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onBack} className="flex-1 px-4 py-3 border border-slate-300 rounded-lg hover:bg-slate-50">
              Voltar
            </button>
            <button type="submit" disabled={loading} className="flex-1 px-4 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-50">
              {loading ? 'Verificando...' : 'Entrar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
