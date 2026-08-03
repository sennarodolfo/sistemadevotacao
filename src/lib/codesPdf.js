import jsPDF from 'jspdf'

// Gera um PDF (A4) com um código por "ficha", em grade, com borda
// tracejada em cada ficha para servir de linha de corte após a impressão.
// Layout: 3 colunas x 8 linhas = 24 fichas por página.
export function buildCodesPdf(codes, electionName) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })

  const margin = 10
  const cols = 3
  const rows = 8
  const perPage = cols * rows

  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const cellW = (pageW - margin * 2) / cols
  const cellH = (pageH - margin * 2) / rows

  const nameTrunc = electionName && electionName.length > 34
    ? electionName.slice(0, 34) + '…'
    : (electionName || 'Urna Eletrônica')

  codes.forEach((code, i) => {
    const posInPage = i % perPage
    if (i > 0 && posInPage === 0) doc.addPage()

    const col = posInPage % cols
    const row = Math.floor(posInPage / cols)
    const x = margin + col * cellW
    const y = margin + row * cellH
    const cx = x + cellW / 2

    // Borda tracejada = linha de corte
    doc.setDrawColor(160, 160, 160)
    doc.setLineWidth(0.2)
    doc.setLineDashPattern([1.2, 1.2], 0)
    doc.rect(x, y, cellW, cellH)
    doc.setLineDashPattern([], 0)

    // Cabeçalho
    doc.setTextColor(79, 70, 229) // indigo-600
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text('CÓDIGO DE VOTAÇÃO', cx, y + 7, { align: 'center' })

    // Nome da eleição
    doc.setTextColor(110, 110, 110)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.text(nameTrunc, cx, y + 12, { align: 'center' })

    // Linha divisória fina
    doc.setDrawColor(225, 225, 225)
    doc.setLineWidth(0.1)
    doc.line(x + 4, y + 15, x + cellW - 4, y + 15)

    // Código grande e espaçado
    doc.setTextColor(30, 41, 59) // slate-800
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(26)
    const spaced = String(code).split('').join('  ')
    doc.text(spaced, cx, y + cellH / 2 + 7, { align: 'center' })

    // Rodapé
    doc.setTextColor(130, 130, 130)
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(6)
    doc.text('Uso único e pessoal • Não compartilhe', cx, y + cellH - 4, { align: 'center' })
  })

  return doc
}

export function downloadCodesPdf(codes, electionName, filename) {
  const doc = buildCodesPdf(codes, electionName)
  doc.save(`${filename}.pdf`)
}
