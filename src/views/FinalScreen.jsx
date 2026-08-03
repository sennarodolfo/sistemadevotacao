import { useState } from 'react'
import { Icon } from '../components/Icon'
import jsPDF from 'jspdf'

export default function FinalScreen({ election, receipt, onReset }) {
  const [copied, setCopied] = useState(false)
  const [releasing, setReleasing] = useState(false)

  function releaseForNextVoter() {
    if (releasing) return
    if (confirm('Concluir e liberar a urna para o próximo eleitor? Esta tela não poderá mais ser reaberta.')) {
      setReleasing(true)
      onReset()
    }
  }

  function copyCode() {
    navigator.clipboard.writeText(receipt.receipt_code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {
      const ta = document.createElement('textarea')
      ta.value = receipt.receipt_code
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function downloadPDF() {
    const doc = new jsPDF()
    const pageWidth = doc.internal.pageSize.getWidth()
    const margin = 15
    let y = 20

    doc.setFillColor(30, 58, 138)
    doc.rect(0, 0, pageWidth, 35, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(18)
    doc.setFont('helvetica', 'bold')
    doc.text('Comprovante de Votação', pageWidth / 2, 18, { align: 'center' })
    doc.setFontSize(11)
    doc.setFont('helvetica', 'normal')
    doc.text(election.name, pageWidth / 2, 28, { align: 'center' })

    y = 50
    doc.setTextColor(0, 0, 0)

    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text('Código do Comprovante', margin, y)
    y += 7
    doc.setFontSize(16)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(30, 58, 138)
    doc.text(receipt.receipt_code, margin, y)
    doc.setTextColor(0, 0, 0)
    y += 5
    doc.setDrawColor(200, 200, 200)
    doc.line(margin, y, pageWidth - margin, y)
    y += 8

    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text(`Data: ${new Date().toLocaleString('pt-BR')}`, margin, y)
    y += 10

    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text('Votos por Sessão', margin, y)
    y += 8

    const completions = receipt.session_completions || []
    completions.forEach((sc, i) => {
      if (y > 260) { doc.addPage(); y = 20 }
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.text(`${i + 1}. ${sc.session_title}`, margin, y)
      y += 6

      const voted = sc.voted_candidates || []
      if (voted.length > 0) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        doc.text('Candidatos: ' + voted.join(', '), margin + 5, y, { maxWidth: pageWidth - 2 * margin - 5 })
        y += 6 + Math.ceil(voted.join(', ').length / 90) * 4
      }
      if (sc.blank_count > 0) {
        doc.setFont('helvetica', 'italic')
        doc.text(`Votos em branco: ${sc.blank_count}`, margin + 5, y)
        y += 6
      }
      doc.setFontSize(8)
      doc.setTextColor(120, 120, 120)
      doc.text(`Receipt: ${sc.receipt_code}`, margin + 5, y)
      doc.setTextColor(0, 0, 0)
      y += 8
    })

    if (y > 260) { doc.addPage(); y = 20 }
    y = Math.max(y, 250)
    doc.setDrawColor(200, 200, 200)
    doc.line(margin, y, pageWidth - margin, y)
    y += 8
    doc.setFontSize(8)
    doc.setTextColor(100, 100, 100)
    doc.text('Este comprovante é pessoal e intransferível. Guarde-o para fins de auditoria.', pageWidth / 2, y, { align: 'center' })
    doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, pageWidth / 2, y + 5, { align: 'center' })

    doc.save(`comprovante-${receipt.receipt_code}.pdf`)
  }

  const completions = receipt.session_completions || []

  return (
    <div className="min-h-screen gradient-bg flex items-center justify-center p-4">
      <div className="glass card-shadow rounded-2xl p-8 max-w-md w-full text-center fade-in">
        <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Icon name="check" className="w-10 h-10 text-emerald-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-800 mb-2">Votação Concluída!</h1>
        <p className="text-slate-600 mb-4">Obrigado por participar. Abaixo está seu comprovante de votação.</p>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">
          <p className="text-xs text-slate-500 uppercase font-semibold mb-1">Comprovante de Votação</p>
          <p className="text-2xl font-mono font-bold text-indigo-700 break-all">{receipt.receipt_code}</p>
        </div>

        <div className="flex gap-2 mb-4">
          <button onClick={copyCode} className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 py-2 rounded-lg flex items-center justify-center gap-2">
            <Icon name="copy" className="w-4 h-4" />
            {copied ? 'Copiado!' : 'Copiar'}
          </button>
          <button onClick={downloadPDF} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg flex items-center justify-center gap-2">
            <Icon name="download" className="w-4 h-4" />
            Salvar PDF
          </button>
        </div>

        <div className="bg-slate-50 rounded-lg p-3 text-left">
          <p className="text-xs font-semibold text-slate-500 mb-2 uppercase">Resumo</p>
          {completions.map((sc, i) => (
            <div key={i} className="text-xs text-slate-600 mb-2">
              <p className="font-semibold">{sc.session_title}</p>
              <p className="text-slate-500">
                {(sc.voted_candidates || []).join(', ') || '—'}
                {sc.blank_count > 0 && ` + ${sc.blank_count} branco(s)`}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-5 pt-4 border-t border-slate-200">
          <p className="text-xs text-slate-400 mb-2">Guarde ou anote seu código antes de continuar.</p>
          <button
            onClick={releaseForNextVoter}
            disabled={releasing}
            className="w-full bg-slate-700 hover:bg-slate-800 text-white py-3 rounded-lg font-semibold disabled:opacity-50"
          >
            {releasing ? 'Liberando...' : 'Concluir e Liberar Urna'}
          </button>
        </div>
      </div>
    </div>
  )
}
