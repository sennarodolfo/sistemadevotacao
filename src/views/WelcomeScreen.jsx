import { Icon } from '../components/Icon'

export default function WelcomeScreen({ election, voterStatus, onStart, onSecretTap, onResetVoterToken }) {
  const completed = voterStatus.completed || []
  const totalSessions = election?.sessions?.length || 0
  const allDone = totalSessions > 0 && completed.length >= totalSessions

  return (
    <div className="min-h-screen gradient-bg p-4">
      <div className="max-w-2xl mx-auto pt-8">
        <div className="glass card-shadow rounded-2xl p-6 md:p-8 fade-in">
          <div className="text-center mb-6">
            <div className="bg-indigo-600 text-white w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Icon name="vote" className="w-8 h-8" />
            </div>
            <h1 onClick={onSecretTap} className="text-3xl md:text-4xl font-extrabold text-slate-900 select-none cursor-default">
              {election?.name || 'Urna Eletrônica'}
            </h1>
            {election?.location_name && (
              <p className="text-xs text-slate-500 mt-1">📍 {election.location_name}</p>
            )}
          </div>

          {totalSessions === 0 ? (
            <div className="bg-amber-50 border border-amber-200 p-4 rounded-lg text-amber-800 text-sm">
              Nenhuma sessão de votação cadastrada ainda. O administrador precisa configurar as sessões antes de iniciar.
            </div>
          ) : (
            <>
              <div className="bg-slate-50 rounded-lg p-4 mb-4">
                <h2 className="font-semibold text-slate-700 mb-3">Sessões de Votação</h2>
                <ul className="space-y-2">
                  {election.sessions.map((s, i) => {
                    const done = completed.some(c => c.session_id === s.id)
                    return (
                      <li key={s.id} className="flex items-center gap-3">
                        {done ? (
                          <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0 text-white text-sm font-bold">
                            <Icon name="check" className="w-4 h-4" />
                          </div>
                        ) : (
                          <div className="w-8 h-8 rounded-full border-2 border-indigo-300 flex-shrink-0 text-indigo-600 text-sm font-bold flex items-center justify-center">
                            {i + 1}
                          </div>
                        )}
                        <span className="text-slate-700 font-medium">
                          {s.title}
                        </span>
                        <span className="text-xs text-slate-400 ml-auto">
                          {s.votes_required} voto(s) • {s.candidates?.length || 0} candidatos
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>

              <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-sm text-indigo-800 text-center mb-4">
                Você passará por todas as sessões em sequência. O voto em cada uma é único.
              </div>

              {allDone ? (
                <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-lg text-emerald-800 text-sm text-center">
                  ✅ Você já concluiu todas as sessões desta eleição.
                </div>
              ) : (
                <button
                  onClick={onStart}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-lg font-semibold disabled:opacity-50"
                >
                  {completed.length > 0 ? 'Continuar Votação' : 'Iniciar Votação'}
                </button>
              )}

              {completed.length > 0 && !allDone && (
                <p className="text-xs text-center text-slate-500 mt-2">
                  Você já concluiu {completed.length} de {totalSessions} sessões.
                </p>
              )}
            </>
          )}

          {import.meta.env.DEV && (
            <div className="text-center mt-4">
              <button onClick={onResetVoterToken} className="text-slate-300 hover:text-red-500 text-xs underline">
                (dev) Limpar token de eleitor
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
