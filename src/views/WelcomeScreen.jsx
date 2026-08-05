import { Icon } from '../components/Icon'

export default function WelcomeScreen({ election, onAdminRequest, onSecretTap }) {
  return (
    <div className="min-h-screen gradient-bg p-4 flex items-center justify-center">
      <div className="max-w-md w-full">
        <div className="glass card-shadow rounded-2xl p-6 md:p-8 fade-in text-center">
          <div className="bg-indigo-600 text-white w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Icon name="vote" className="w-8 h-8" />
          </div>
          <h1 onClick={onSecretTap} className="text-3xl md:text-4xl font-extrabold text-slate-900 select-none cursor-default">
            {election?.name || 'Urna Eletrônica'}
          </h1>
          {election?.location_name && (
            <p className="text-xs text-slate-500 mt-1">📍 {election.location_name}</p>
          )}

          <p className="text-slate-600 mt-6 mb-8">
            Bem-vindo(a). A votação é feita pelo link de cada sessão, fornecido pela organização.
          </p>

          <button
            onClick={onAdminRequest}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-lg font-semibold"
          >
            Acessar Painel Administrativo
          </button>
        </div>
      </div>
    </div>
  )
}
