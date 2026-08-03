import { Icon } from '../components/Icon'

export default function SessionDoneScreen({ session, result, isLast, onNext, onFinalize }) {
  const votedNames = result?.voted_candidates || []
  const blankCount = result?.blank_count || 0

  return (
    <div className="min-h-screen gradient-bg flex items-center justify-center p-4">
      <div className="glass card-shadow rounded-2xl p-8 max-w-md w-full text-center fade-in">
        <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Icon name="check" className="w-10 h-10 text-emerald-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-800 mb-2">Voto Computado!</h1>
        <p className="text-slate-600 mb-4">
          Seu voto para <b>{session?.title}</b> foi registrado com sucesso.
        </p>

        {(votedNames.length > 0 || blankCount > 0) && (
          <div className="bg-slate-50 rounded-lg p-3 mb-4 text-left">
            <p className="text-xs font-semibold text-slate-500 mb-2 uppercase">Resumo do voto</p>
            {votedNames.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {votedNames.map((n, i) => (
                  <span key={i} className="bg-indigo-100 text-indigo-800 text-xs px-2 py-1 rounded">{n}</span>
                ))}
              </div>
            )}
            {blankCount > 0 && (
              <p className="text-xs text-slate-500">+ {blankCount} voto(s) em branco</p>
            )}
            {result?.session_receipt && (
              <p className="text-xs text-slate-400 mt-2 font-mono">{result.session_receipt}</p>
            )}
          </div>
        )}

        <button
          onClick={isLast ? onFinalize : onNext}
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-lg font-semibold"
        >
          {isLast ? 'Ver Comprovante' : 'Ir para Próxima Votação'}
        </button>
      </div>
    </div>
  )
}
