import { useState } from 'react'
import { Icon } from '../components/Icon'
import jsPDF from 'jspdf'

// Comprovante de UMA sessão específica, gerado a partir do link
// individual dela (ver SessionVoteFlow). O código (session_receipt)
// já existe desde sempre no banco - toda votação de sessão gera um em
// public.voter_completions.receipt_code (ver submit_vote) - e é o
// mesmo código usado na aba "Auditoria" do painel admin para conferir
// os votos, então serve como comprovante para fins de auditoria.
export default function SessionReceiptScreen({ electionName, session, result, standalone, onBack }) {
  const [copied, setCopied] = useState(false)
  const votedNames = result?.voted_candidates || []
  const blankCount = result?.blank_count || 0
  const receiptCode = result?.session_receipt

  function copyCode() {
    if (!receiptCode) return
    navigator.clipboard.writeText(receiptCode).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {
      const ta = document.createElement('textarea')
      ta.value = receiptCode
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
    doc.text('Comprovante de Votação (Sessão)', pageWidth / 2, 15, { align: 'center' })
    doc.setFontSize(11)
    doc.setFont('helvetica', 'normal')
    doc.text(electionName || '', pageWidth / 2, 24, { align: 'center' })
    doc.text(session?.title || '', pageWidth / 2, 30, { align: 'center' })

    y = 50
    doc.setTextColor(0, 0, 0)

    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text('Código do Comprovante', margin, y)
    y += 7
    doc.setFontSize(16)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(30, 58, 138)
    doc.text(receiptCode || '-', margin, y)
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
    doc.text('Voto Registrado', margin, y)
    y += 8

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    if (votedNames.length > 0) {
      doc.text('Candidatos: ' + votedNames.join(', '), margin, y, { maxWidth: pageWidth - 2 * margin })
      y += 6 + Math.ceil(votedNames.join(', ').length / 90) * 5
    }
    if (blankCount > 0) {
      doc.setFont('helvetica', 'italic')
      doc.text(`Votos em branco: ${blankCount}`, margin, y)
      y += 6
    }

    y = Math.max(y + 10, 260)
    doc.setDrawColor(200, 200, 200)
    doc.line(margin, y, pageWidth - margin, y)
    y += 8
    doc.setFontSize(8)
    doc.setTextColor(100, 100, 100)
    doc.text('Este comprovante é pessoal e intransferível. Guarde-o para fins de auditoria desta sessão.', pageWidth / 2, y, { align: 'center' })
    doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, pageWidth / 2, y + 5, { align: 'center' })

    doc.save(`comprovante-sessao-${receiptCode || 'votacao'}.pdf`)
  }

  return (
    <div className="min-h-screen gradient-bg flex items-center justify-center p-4">
      <div className="glass card-shadow rounded-2xl p-8 max-w-md w-full text-center fade-in">
        <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Icon name="shield" className="w-10 h-10 text-emerald-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Comprovante de Votação</h1>
        <p className="text-slate-500 mb-4">
          <b>{session?.title}</b> — {electionName}
        </p>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">
          <p className="text-xs text-slate-500 uppercase font-semibold mb-1">Código do Comprovante</p>
          <p className="text-2xl font-mono font-bold text-indigo-700 break-all">{receiptCode || '—'}</p>
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

        {(votedNames.length > 0 || blankCount > 0) && (
          <div className="bg-slate-50 rounded-lg p-3 text-left mb-4">
            <p className="text-xs font-semibold text-slate-500 mb-2 uppercase">Resumo do voto</p>
            {votedNames.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1">
                {votedNames.map((n, i) => (
                  <span key={i} className="bg-indigo-100 text-indigo-800 text-xs px-2 py-1 rounded">{n}</span>
                ))}
              </div>
            )}
            {blankCount > 0 && (
              <p className="text-xs text-slate-500">+ {blankCount} voto(s) em branco</p>
            )}
          </div>
        )}

        <div className="pt-2 border-t border-slate-200">
          <p className="text-xs text-slate-400 mb-3">Este código serve para conferência na Auditoria. Guarde-o.</p>
          {standalone ? (
            <button onClick={() => { try { window.close() } catch (_) { /* ignore */ } }} className="w-full bg-slate-700 hover:bg-slate-800 text-white py-3 rounded-lg font-semibold">
              Encerrar Votação
            </button>
          ) : (
            <button onClick={onBack} className="w-full border border-slate-300 py-3 rounded-lg text-slate-700 hover:bg-slate-50">
              Voltar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
