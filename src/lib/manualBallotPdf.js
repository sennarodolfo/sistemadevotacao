import jsPDF from 'jspdf'

// Gera um PDF com UMA cédula por página (ou mais, se não couber tudo em
// uma só): cada página traz o código de 4 dígitos da cédula em destaque
// e a lista completa de sessões/candidatos com quadrados para marcação
// manual, para o eleitor preencher no papel e entregar ao mesário.
export function buildManualBallotsPdf(codes, election) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const margin = 15
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const contentW = pageW - margin * 2
  const sessions = (election?.sessions || []).filter(s => s.is_active)
  const electionName = election?.name || 'Urna Eletrônica'

  codes.forEach((code, idx) => {
    if (idx > 0) doc.addPage()
    let y = margin

    function drawHeader(continuation) {
      doc.setDrawColor(79, 70, 229)
      doc.setLineWidth(0.5)
      doc.roundedRect(margin, y, contentW, 22, 2, 2)
      doc.setTextColor(79, 70, 229)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.text('CÉDULA DE VOTAÇÃO MANUAL' + (continuation ? ' (continuação)' : ''), margin + 5, y + 7)
      doc.setTextColor(30, 41, 59)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.text(electionName.slice(0, 70), margin + 5, y + 13)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(18)
      doc.text('Código: ' + code.split('').join('  '), margin + 5, y + 20)
      y += 27
    }

    function ensureSpace(h) {
      if (y + h > pageH - margin) {
        doc.addPage()
        y = margin
        drawHeader(true)
      }
    }

    drawHeader(false)

    doc.setFont('helvetica', 'italic')
    doc.setFontSize(8)
    doc.setTextColor(110, 110, 110)
    doc.text('Marque com um X o(s) candidato(s) escolhido(s) ou "Branco". Entregue esta cédula ao mesário após preencher.', margin, y)
    y += 6

    sessions.forEach(session => {
      ensureSpace(15)
      doc.setFillColor(238, 242, 255)
      doc.rect(margin, y, contentW, 8, 'F')
      doc.setTextColor(67, 56, 202)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.text(`${session.title}  —  vote em ${session.votes_required}`, margin + 2, y + 5.5)
      y += 11

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(30, 41, 59);

      (session.candidates || []).forEach(c => {
        ensureSpace(8)
        doc.setDrawColor(100, 100, 100)
        doc.rect(margin, y, 5, 5)
        doc.text(c.name, margin + 8, y + 4)
        y += 8
      })

      for (let b = 0; b < session.votes_required; b++) {
        ensureSpace(8)
        doc.setDrawColor(100, 100, 100)
        doc.rect(margin, y, 5, 5)
        doc.setFont('helvetica', 'italic')
        doc.setTextColor(90, 90, 90)
        doc.text(`Branco ${b + 1}`, margin + 8, y + 4)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(30, 41, 59)
        y += 8
      }

      y += 5
    })
  })

  return doc
}

export function downloadManualBallotsPdf(codes, election, filename) {
  const doc = buildManualBallotsPdf(codes, election)
  doc.save(`${filename}.pdf`)
}
