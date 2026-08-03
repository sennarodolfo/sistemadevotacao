import jsPDF from 'jspdf'

// Layout: 6 cédulas por página A4 (2 colunas x 3 linhas). Cada cédula é
// desenhada inteiramente dentro da sua própria célula - nunca quebra
// entre páginas ou entre células. A lista de candidatos de cada sessão
// é distribuída em 2 colunas dentro da cédula. Não há opção de "voto em
// branco" impressa (o próprio papel em branco/sem marcação já representa
// isso na apuração manual).
const PAGE_MARGIN = 8
const CELL_GAP = 4
const COLS = 2
const ROWS = 3
const CELLS_PER_PAGE = COLS * ROWS

export function buildManualBallotsPdf(codes, election) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const cellW = (pageW - PAGE_MARGIN * 2 - CELL_GAP * (COLS - 1)) / COLS
  const cellH = (pageH - PAGE_MARGIN * 2 - CELL_GAP * (ROWS - 1)) / ROWS

  const sessions = (election?.sessions || []).filter(s => s.is_active)
  const electionName = election?.name || 'Urna Eletrônica'

  codes.forEach((code, idx) => {
    const posInPage = idx % CELLS_PER_PAGE
    if (idx > 0 && posInPage === 0) doc.addPage()
    const col = posInPage % COLS
    const row = Math.floor(posInPage / COLS)
    const x = PAGE_MARGIN + col * (cellW + CELL_GAP)
    const y = PAGE_MARGIN + row * (cellH + CELL_GAP)
    drawBallot(doc, x, y, cellW, cellH, code, electionName, sessions)
  })

  return doc
}

function truncateToWidth(doc, text, maxWidth) {
  if (doc.getTextWidth(text) <= maxWidth) return text
  let t = text
  while (t.length > 1 && doc.getTextWidth(t + '…') > maxWidth) {
    t = t.slice(0, -1)
  }
  return t + '…'
}

function drawBallot(doc, x, y, w, h, code, electionName, sessions) {
  // Borda tracejada = linha de corte
  doc.setDrawColor(160, 160, 160)
  doc.setLineWidth(0.2)
  doc.setLineDashPattern([1, 1], 0)
  doc.rect(x, y, w, h)
  doc.setLineDashPattern([], 0)

  const pad = 3
  let cy = y + pad

  doc.setTextColor(79, 70, 229)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('CÉDULA DE VOTAÇÃO MANUAL', x + pad, cy + 3)
  cy += 5

  doc.setTextColor(100, 100, 100)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.text(truncateToWidth(doc, electionName, w - pad * 2), x + pad, cy + 2.5)
  cy += 4.5

  doc.setTextColor(30, 41, 59)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text(code.split('').join(' '), x + pad, cy + 6)
  cy += 9

  doc.setDrawColor(210, 210, 210)
  doc.setLineWidth(0.15)
  doc.line(x + pad, cy, x + w - pad, cy)
  cy += 2.5

  // Calcula quantas "linhas de conteúdo" (título de sessão + candidatos
  // em 2 colunas) serão necessárias, para escolher um tamanho de fonte
  // que caiba tudo no espaço restante SEM quebrar a cédula.
  let totalRows = 0
  sessions.forEach(s => {
    totalRows += 1
    totalRows += Math.ceil((s.candidates || []).length / 2)
  })
  const availableH = (y + h - pad) - cy
  const rawRowH = totalRows > 0 ? availableH / totalRows : availableH
  const rowH = Math.max(2.6, Math.min(5.5, rawRowH))
  const fontSize = Math.max(5, Math.min(7.5, rowH * 1.7))
  const colW = (w - pad * 2) / 2

  sessions.forEach(session => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(fontSize)
    doc.setTextColor(67, 56, 202)
    const title = `${session.title} (vote em ${session.votes_required})`
    doc.text(truncateToWidth(doc, title, w - pad * 2), x + pad, cy + rowH * 0.7)
    cy += rowH

    const candidates = session.candidates || []
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(fontSize)
    doc.setTextColor(30, 41, 59)
    for (let i = 0; i < candidates.length; i += 2) {
      const rowCandidates = [candidates[i], candidates[i + 1]]
      rowCandidates.forEach((c, colIdx) => {
        if (!c) return
        const cx = x + pad + colIdx * colW
        const boxSize = rowH * 0.55
        doc.setDrawColor(100, 100, 100)
        doc.rect(cx, cy + (rowH - boxSize) / 2, boxSize, boxSize)
        const label = truncateToWidth(doc, c.name, colW - boxSize - 2)
        doc.text(label, cx + boxSize + 1.2, cy + rowH * 0.72)
      })
      cy += rowH
    }
  })
}

export function downloadManualBallotsPdf(codes, election, filename) {
  const doc = buildManualBallotsPdf(codes, election)
  doc.save(`${filename}.pdf`)
}
