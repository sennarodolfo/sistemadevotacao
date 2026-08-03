import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, ELECTION_ID } from '../lib/supabase'
import { Icon } from '../components/Icon'

const POLL_MS = 4000

function readAdminPassword() {
  try { return sessionStorage.getItem('admin_pwd') || '' } catch { return '' }
}

// Tela pensada para ser aberta em uma NOVA JANELA (window.open, a partir do
// gráfico de barras no painel admin) e projetada em uma tela separada para
// o público acompanhar a apuração em tempo real. Ela reaproveita o
// sessionStorage herdado da janela que a abriu (mesma origem) para chamar
// admin_get_results periodicamente - não expõe nem pede senha própria.
export default function PublicResultsScreen({ electionName, initialSessionId }) {
  const [results, setResults] = useState([])
  const [sessionId, setSessionId] = useState(initialSessionId || '')
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)
  const chartRef = useRef(null)
  const canvasRef = useRef(null)

  const fetchResults = useCallback(async () => {
    try {
      const pwd = readAdminPassword()
      const { data, error: rpcErr } = await supabase.rpc('admin_get_results', {
        p_election_id: ELECTION_ID,
        p_password: pwd
      })
      if (rpcErr) throw rpcErr
      if (data?.error) {
        throw new Error(
          data.error === 'unauthorized'
            ? 'Sessão de administrador expirada nesta janela. Feche e abra novamente a partir do gráfico no painel.'
            : data.error
        )
      }
      setResults(data || [])
      setError('')
      setLastUpdated(new Date())
      setSessionId(prev => prev || (data && data[0] ? data[0].session_id : ''))
    } catch (e) {
      setError(e.message || 'Erro ao buscar resultados')
    }
  }, [])

  useEffect(() => {
    fetchResults()
    const id = setInterval(fetchResults, POLL_MS)
    return () => clearInterval(id)
  }, [fetchResults])

  const session = results.find(r => r.session_id === sessionId) || results[0] || null
  const candidates = session?.candidates || []
  const blank = session?.blank_votes || 0
  const totalValid = candidates.reduce((a, c) => a + c.votes, 0)

  useEffect(() => {
    if (!canvasRef.current || !session) return
    let cancelled = false

    async function draw() {
      const { default: Chart } = await import('chart.js/auto')
      if (cancelled) return
      if (chartRef.current) chartRef.current.destroy()

      const sorted = [...candidates].sort((a, b) => b.votes - a.votes)
      const labels = sorted.map(c => c.name)
      const data = sorted.map(c => c.votes)
      const percents = sorted.map(c => totalValid > 0 ? ((c.votes / totalValid) * 100).toFixed(1) : '0.0')
      const colors = sorted.map((_, i) => `hsl(${(i * 360) / Math.max(1, sorted.length)}, 70%, 60%)`)

      const dataLabelPlugin = {
        id: 'publicDataLabels',
        afterDatasetsDraw(chart) {
          const { ctx } = chart
          const meta = chart.getDatasetMeta(0)
          meta.data.forEach((bar, index) => {
            const label = `${data[index]} votos (${percents[index]}%)`
            ctx.save()
            ctx.fillStyle = '#f1f5f9'
            ctx.font = 'bold 20px sans-serif'
            ctx.textAlign = 'left'
            ctx.textBaseline = 'middle'
            ctx.fillText(label, bar.x + 12, bar.y)
            ctx.restore()
          })
        }
      }

      chartRef.current = new Chart(canvasRef.current, {
        type: 'bar',
        data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 8 }] },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { right: 230 } },
          animation: { duration: 400 },
          plugins: { legend: { display: false } },
          scales: {
            x: { beginAtZero: true, ticks: { precision: 0, color: '#cbd5e1', font: { size: 13 } }, grid: { color: '#334155' } },
            y: { ticks: { color: '#f1f5f9', font: { size: 17, weight: 'bold' } }, grid: { display: false } }
          }
        },
        plugins: [dataLabelPlugin]
      })
    }
    draw()

    return () => {
      cancelled = true
      if (chartRef.current) chartRef.current.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, JSON.stringify(candidates)])

  return (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0">
              <Icon name="chart" className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-extrabold leading-tight">{electionName || 'Apuração em Tempo Real'}</h1>
              {session && <p className="text-slate-300 text-lg mt-0.5">{session.title}</p>}
            </div>
          </div>
          {results.length > 1 && (
            <select
              value={sessionId}
              onChange={e => setSessionId(e.target.value)}
              className="bg-slate-800 border border-slate-600 text-white px-4 py-2 rounded-lg text-lg"
            >
              {results.map(r => <option key={r.session_id} value={r.session_id}>{r.title}</option>)}
            </select>
          )}
        </div>

        {error && (
          <div className="bg-red-900/40 border border-red-700 text-red-200 p-4 rounded-lg mb-6">{error}</div>
        )}

        {session && (
          <>
            <div className="grid grid-cols-3 gap-4 mb-8">
              <div className="bg-slate-800 rounded-xl p-5 text-center">
                <p className="text-slate-400 text-sm">Eleitores Únicos</p>
                <p className="text-4xl font-bold">{session.unique_voters || 0}</p>
              </div>
              <div className="bg-slate-800 rounded-xl p-5 text-center">
                <p className="text-slate-400 text-sm">Votos Válidos</p>
                <p className="text-4xl font-bold text-emerald-400">{totalValid}</p>
              </div>
              <div className="bg-slate-800 rounded-xl p-5 text-center">
                <p className="text-slate-400 text-sm">Votos em Branco</p>
                <p className="text-4xl font-bold text-slate-300">{blank}</p>
              </div>
            </div>

            <div className="bg-slate-800 rounded-xl p-6" style={{ height: `${Math.max(320, candidates.length * 72)}px` }}>
              <canvas ref={canvasRef}></canvas>
            </div>
          </>
        )}

        {!session && !error && (
          <p className="text-center text-slate-400 py-16">Carregando resultados...</p>
        )}

        <p className="text-center text-slate-500 text-sm mt-6">
          {lastUpdated
            ? `Atualizado às ${lastUpdated.toLocaleTimeString('pt-BR')} — atualiza automaticamente a cada ${POLL_MS / 1000}s`
            : 'Carregando...'}
        </p>
      </div>
    </div>
  )
}
