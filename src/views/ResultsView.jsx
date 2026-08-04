import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import jsPDF from 'jspdf'
import * as XLSX from 'xlsx'

export default function ResultsView({ results, sessionId, onSelectSession, electionName }) {
  const barRef = useRef(null)
  const pieRef = useRef(null)
  const barChartRef = useRef(null)
  const pieChartRef = useRef(null)

  const session = results.find(r => r.session_id === sessionId) || results[0]
  const candidates = session?.candidates || []
  const blank = session?.blank_votes || 0
  const totalValid = candidates.reduce((a, c) => a + c.votes, 0)
  const totalAll = totalValid + blank
  const totalVoters = session?.unique_voters || 0

  // ===== Eleição por assembleia: percentual sobre o Nº DE MEMBROS
  // PRESENTES informado na sessão (não sobre o total de votos). Ex: 100
  // membros presentes, candidato com 80 votos => 80%. Se a sessão não
  // tiver esse número informado, cai para o total de votos (comportamento
  // anterior) como alternativa razoável.
  const registeredVoters = session?.registered_voters ?? null
  const usingRegistered = !!(registeredVoters && registeredVoters > 0)
  const percentBase = usingRegistered ? registeredVoters : totalAll
  // Limiar de maioria absoluta (50% + 1) - exibido só como REFERÊNCIA
  // informativa quando há nº de membros presentes; NÃO é mais o que
  // decide quem está marcado como "Eleito" (ver electedIds abaixo).
  const electedThreshold = usingRegistered ? Math.floor(registeredVoters / 2) + 1 : null

  // ===== Eleitos = os N mais votados, onde N é o número de vagas da
  // sessão (votes_required) - a mesma quantidade que o eleitor marca na
  // cédula. Ex: "vote em 5" -> os 5 candidatos com mais votos ficam
  // marcados como eleitos, sempre exatamente 5 (não depende de bater
  // percentual algum).
  const seats = session?.votes_required || 0
  const sortedCandidates = [...candidates].sort((a, b) => b.votes - a.votes)
  const electedIds = new Set(sortedCandidates.slice(0, seats).map(c => c.id))

  function pctOfBase(votes, digits = 2) {
    return percentBase > 0 ? ((votes / percentBase) * 100).toFixed(digits) : (0).toFixed(digits)
  }

  useEffect(() => {
    if (barChartRef.current) barChartRef.current.destroy()
    if (pieChartRef.current) pieChartRef.current.destroy()

    async function draw() {
      const { default: Chart } = await import('chart.js/auto')
      const colors = candidates.map((_, i) => `hsl(${(i*360)/Math.max(1,candidates.length)}, 70%, 55%)`)
      // O voto em branco entra como uma barra a mais (cinza), igual já
      // acontece no gráfico de pizza e na tabela.
      const labels = [...candidates.map(c => c.name), 'Voto em Branco']
      const data = [...candidates.map(c => c.votes), blank]
      const percents = [...candidates.map(c => pctOfBase(c.votes, 1)), pctOfBase(blank, 1)]
      const barColors = [...colors, '#94a3b8']

      // Plugin local (sem dependência externa) que escreve "N votos (X%)"
      // logo após a ponta de cada barra horizontal. O percentual usa o
      // número de membros presentes quando disponível.
      const barLabelsPlugin = {
        id: 'barLabelsPlugin',
        afterDatasetsDraw(chart) {
          const { ctx } = chart
          const meta = chart.getDatasetMeta(0)
          meta.data.forEach((bar, index) => {
            const label = `${data[index]} (${percents[index]}%)`
            ctx.save()
            ctx.fillStyle = '#1e293b'
            ctx.font = 'bold 12px sans-serif'
            ctx.textAlign = 'left'
            ctx.textBaseline = 'middle'
            ctx.fillText(label, bar.x + 6, bar.y)
            ctx.restore()
          })
        }
      }

      if (barRef.current) {
        barChartRef.current = new Chart(barRef.current, {
          type: 'bar',
          data: { labels, datasets: [{ label: 'Votos', data, backgroundColor: barColors, borderRadius: 6 }] },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { right: 70 } },
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: (ctx) => `${ctx.raw} voto(s) (${percents[ctx.dataIndex]}%${usingRegistered ? ' dos membros' : ''})` } }
            },
            scales: {
              x: { beginAtZero: true, ticks: { precision: 0 } }
            }
          },
          plugins: [barLabelsPlugin]
        })
      }
      if (pieRef.current) {
        const pieData = [...candidates.map(c => ({ name: c.name, votes: c.votes })), ...(blank > 0 ? [{ name: 'Branco', votes: blank }] : [])]
        pieChartRef.current = new Chart(pieRef.current, {
          type: 'pie',
          data: { labels: pieData.map(c => c.name), datasets: [{ data: pieData.map(c => c.votes), backgroundColor: [...colors, '#94a3b8'], borderWidth: 2, borderColor: '#fff' }] },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (ctx) => { const t = ctx.dataset.data.reduce((a,b)=>a+b,0); const p = t>0?((ctx.parsed/t)*100).toFixed(1):0; return `${ctx.label}: ${ctx.parsed} (${p}%)`; } } } } }
        })
      }
    }
    draw()

    return () => {
      if (barChartRef.current) barChartRef.current.destroy()
      if (pieChartRef.current) pieChartRef.current.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, JSON.stringify(candidates), blank, registeredVoters])

  function openPublicWindow() {
    if (!session) return
    const url = `${window.location.origin}${window.location.pathname}#resultadospublicos:${session.session_id}`
    window.open(url, '_blank', 'width=1280,height=800,menubar=no,toolbar=no')
  }

  function exportExcel() {
    if (!session) return
    const rows = [
      ['Posição', 'Candidato', 'Votos', '% Total', 'Eleito'],
      ...sortedCandidates.map((c, i) => [
        i + 1,
        c.name,
        c.votes,
        pctOfBase(c.votes) + '%',
        electedIds.has(c.id) ? 'Sim' : 'Não'
      ]),
      ['-', 'Voto em Branco', blank, pctOfBase(blank) + '%', '-']
    ]
    rows.push([])
    rows.push(['Vagas (votos obrigatórios)', seats])
    if (usingRegistered) {
      rows.push(['Membros presentes', registeredVoters])
      rows.push(['Membros votantes', totalVoters])
      rows.push(['Referência - maioria absoluta (50% + 1)', electedThreshold])
    }
    const ws = XLSX.utils.aoa_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, session.title.slice(0, 30))
    XLSX.writeFile(wb, `resultados-${session.title}.xlsx`)
  }

  async function exportPDF() {
    if (!session) return
    const doc = new jsPDF()
    const margin = 15
    let y = 20

    doc.setFillColor(30, 58, 138)
    doc.rect(0, 0, doc.internal.pageSize.getWidth(), 30, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(16)
    doc.setFont('helvetica', 'bold')
    doc.text('Resultados - ' + session.title, doc.internal.pageSize.getWidth() / 2, 18, { align: 'center' })
    doc.setFontSize(10)
    doc.text(electionName, doc.internal.pageSize.getWidth() / 2, 25, { align: 'center' })

    y = 40
    doc.setTextColor(0, 0, 0)

    doc.setFontSize(10)
    const summaryLine = usingRegistered
      ? `Membros presentes: ${registeredVoters} | Membros votantes: ${totalVoters} | Votos válidos: ${totalValid} | Brancos: ${blank} | Vagas: ${seats}`
      : `Total de membros: ${totalVoters} | Votos válidos: ${totalValid} | Brancos: ${blank} | Vagas: ${seats}`
    doc.text(summaryLine, margin, y)
    y += 10

    // Tabela
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text('Pos', margin, y)
    doc.text('Candidato', margin + 15, y)
    doc.text('Votos', margin + 100, y)
    doc.text('% Total', margin + 130, y)
    doc.text('Eleito', margin + 165, y)
    y += 5
    doc.setDrawColor(200)
    doc.line(margin, y, 195, y)
    y += 5

    doc.setFont('helvetica', 'normal')
    sortedCandidates.forEach((c, i) => {
      doc.text(`${i + 1}º`, margin, y)
      doc.text(c.name, margin + 15, y)
      doc.text(String(c.votes), margin + 100, y)
      doc.text(pctOfBase(c.votes) + '%', margin + 130, y)
      doc.text(electedIds.has(c.id) ? 'Sim' : 'Não', margin + 165, y)
      y += 6
    })
    doc.text('-', margin, y)
    doc.text('Voto em Branco', margin + 15, y)
    doc.text(String(blank), margin + 100, y)
    doc.text(pctOfBase(blank) + '%', margin + 130, y)

    y += 10
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(8)
    const noteLine = usingRegistered
      ? `Eleitos = os ${seats} mais votados (vagas da sessão). Percentual sobre os ${registeredVoters} membros presentes. Referência de maioria absoluta (50% + 1) = ${electedThreshold} voto(s).`
      : `Eleitos = os ${seats} mais votados (vagas da sessão).`
    doc.text(noteLine, margin, y)

    // Imagens dos gráficos
    if (barChartRef.current) {
      const url = barChartRef.current.toBase64Image()
      y += 15
      if (y > 200) { doc.addPage(); y = 20 }
      doc.text('Gráfico de Barras', margin, y)
      y += 5
      doc.addImage(url, 'PNG', margin, y, 180, 80)
      y += 85
    }
    if (pieChartRef.current) {
      if (y > 200) { doc.addPage(); y = 20 }
      doc.text('Gráfico de Pizza', margin, y)
      y += 5
      doc.addImage(pieChartRef.current.toBase64Image(), 'PNG', margin + 40, y, 100, 80)
    }

    doc.save(`resultados-${session.title}.pdf`)
  }

  if (!session) {
    return <div className="bg-white card-shadow rounded-2xl p-6 fade-in text-center text-slate-500">Selecione uma sessão para ver os resultados</div>
  }

  return (
    <div className="bg-white card-shadow rounded-2xl p-6 fade-in">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="text-lg font-bold text-slate-800">Resultados</h2>
        <select value={sessionId || ''} onChange={e => onSelectSession(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
          {results.map(r => <option key={r.session_id} value={r.session_id}>{r.title}</option>)}
        </select>
      </div>

      {usingRegistered ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
          <div className="bg-indigo-50 p-4 rounded-lg">
            <p className="text-sm text-slate-600">Membros Presentes</p>
            <p className="text-3xl font-bold text-indigo-700">{registeredVoters}</p>
          </div>
          <div className={`p-4 rounded-lg ${totalVoters === registeredVoters ? 'bg-emerald-50' : 'bg-amber-50'}`}>
            <p className="text-sm text-slate-600 flex items-center gap-1">
              Membros Votantes
              {totalVoters === registeredVoters
                ? <Icon name="check" className="w-3.5 h-3.5 text-emerald-600" />
                : <Icon name="x" className="w-3.5 h-3.5 text-amber-600" />}
            </p>
            <p className={`text-3xl font-bold ${totalVoters === registeredVoters ? 'text-emerald-700' : 'text-amber-700'}`}>{totalVoters}</p>
          </div>
          <div className="bg-emerald-50 p-4 rounded-lg">
            <p className="text-sm text-slate-600">Votos Válidos</p>
            <p className="text-3xl font-bold text-emerald-700">{totalValid}</p>
          </div>
          <div className="bg-slate-100 p-4 rounded-lg">
            <p className="text-sm text-slate-600">Votos em Branco</p>
            <p className="text-3xl font-bold text-slate-700">{blank}</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
          <div className="bg-indigo-50 p-4 rounded-lg">
            <p className="text-sm text-slate-600">Total de Membros</p>
            <p className="text-3xl font-bold text-indigo-700">{totalVoters}</p>
          </div>
          <div className="bg-emerald-50 p-4 rounded-lg">
            <p className="text-sm text-slate-600">Votos Válidos</p>
            <p className="text-3xl font-bold text-emerald-700">{totalValid}</p>
          </div>
          <div className="bg-slate-100 p-4 rounded-lg">
            <p className="text-sm text-slate-600">Votos em Branco</p>
            <p className="text-3xl font-bold text-slate-700">{blank}</p>
          </div>
        </div>
      )}

      {usingRegistered && totalVoters !== registeredVoters && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg p-2 mb-3">
          ⚠️ O número de membros votantes ({totalVoters}) ainda não bate com o número de membros presentes informado ({registeredVoters}).
        </div>
      )}

      <p className="text-xs text-slate-500 mb-3">
        <b>{seats} vaga(s)</b> nesta sessão — os {seats} candidato(s) mais votados ficam marcados como "Eleito".
        {usingRegistered && <> Percentual calculado sobre os <b>{registeredVoters} membros presentes</b> (referência de maioria absoluta: 50% + 1 = <b>{electedThreshold} voto(s)</b>).</>}
      </p>

      <div className="overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-100 text-left">
              <th className="p-3 font-semibold">#</th>
              <th className="p-3 font-semibold">Candidato</th>
              <th className="p-3 font-semibold text-right">Votos</th>
              <th className="p-3 font-semibold text-right">% Total</th>
              <th className="p-3 font-semibold text-center">Eleito</th>
            </tr>
          </thead>
          <tbody>
            {sortedCandidates.map((c, i) => {
              const elected = electedIds.has(c.id)
              return (
                <tr key={c.id} className={`border-b hover:bg-slate-50 ${elected ? 'bg-emerald-50/50' : ''}`}>
                  <td className="p-3">{i + 1}º</td>
                  <td className="p-3 font-medium">{c.name}</td>
                  <td className="p-3 text-right font-mono">{c.votes}</td>
                  <td className="p-3 text-right font-mono font-semibold">{pctOfBase(c.votes)}%</td>
                  <td className="p-3 text-center">
                    {elected && (
                      <span className="bg-emerald-100 text-emerald-700 text-xs font-semibold px-2 py-1 rounded-full">✅ Eleito</span>
                    )}
                  </td>
                </tr>
              )
            })}
            <tr className="border-b bg-slate-50">
              <td className="p-3">-</td>
              <td className="p-3 font-medium italic">Voto em Branco</td>
              <td className="p-3 text-right font-mono">{blank}</td>
              <td className="p-3 text-right font-mono">{pctOfBase(blank)}%</td>
              <td className="p-3"></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-1">
        <p className="text-xs text-slate-400 flex items-center gap-1">
          <Icon name="maximize" className="w-3 h-3" /> Clique no gráfico de barras para abrir em uma nova janela e projetar em outra tela
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
        <div className="bg-slate-50 p-4 rounded-lg">
          <div
            className="h-72 relative cursor-pointer group"
            onClick={openPublicWindow}
            title="Clique para abrir em uma nova janela (ideal para projetar em outra tela para o público acompanhar)"
          >
            <canvas ref={barRef}></canvas>
            <div className="absolute inset-x-0 bottom-0 flex justify-center pb-1 opacity-0 group-hover:opacity-100 transition pointer-events-none">
              <span className="bg-slate-800/85 text-white text-xs px-3 py-1 rounded-full flex items-center gap-1">
                <Icon name="maximize" className="w-3 h-3" /> Clique para abrir em nova janela (projeção)
              </span>
            </div>
          </div>
        </div>
        <div className="bg-slate-50 p-4 rounded-lg">
          <div className="h-72"><canvas ref={pieRef}></canvas></div>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <button onClick={exportExcel} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm">
          <Icon name="download" className="w-4 h-4" /> Exportar Excel
        </button>
        <button onClick={exportPDF} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm">
          <Icon name="download" className="w-4 h-4" /> Exportar PDF
        </button>
      </div>
    </div>
  )
}
