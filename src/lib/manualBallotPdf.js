import jsPDF from 'jspdf'

// Layout: 6 cédulas por página A4 (2 colunas x 3 linhas). Cada cédula é
// desenhada inteiramente dentro da sua própria célula - nunca quebra
// entre páginas ou entre células. A lista de candidatos de cada sessão
// é distribuída em 2 colunas dentro da cédula. Não há opção de "voto em
// branco" impressa (o próprio papel em branco/sem marcação já representa
// isso na apuração manual - e também na leitura automática por foto).
//
// A4 tem tamanho FIXO (210x297mm), então CELL_W/CELL_H abaixo são
// constantes conhecidas em qualquer lugar do app - inclusive fora do
// jsPDF (ex: no módulo de leitura de cédula por foto, que precisa saber
// exatamente onde cada quadradinho foi impresso para "reconhecer" a
// marcação na imagem fotografada).
export const A4_WIDTH_MM = 210
export const A4_HEIGHT_MM = 297
export const PAGE_MARGIN = 8
export const CELL_GAP = 4
export const COLS = 4
export const ROWS = 3
export const CELLS_PER_PAGE = COLS * ROWS
export const CELL_W = (A4_WIDTH_MM - PAGE_MARGIN * 2 - CELL_GAP * (COLS - 1)) / COLS
export const CELL_H = (A4_HEIGHT_MM - PAGE_MARGIN * 2 - CELL_GAP * (ROWS - 1)) / ROWS
export const BALLOT_PAD = 3

// ============== Geometria compartilhada (PDF <-> reconhecimento) ==============
// Calcula, para uma cédula de tamanho CELL_W x CELL_H mm com as sessões
// informadas, EXATAMENTE as mesmas posições usadas para desenhar o PDF:
// onde fica o código impresso e onde fica cada quadradinho de candidato.
// Tudo em mm, relativo ao canto superior esquerdo da cédula (0,0).
// O módulo de leitura de foto reusa esta MESMA função (convertendo mm
// para fração 0..1 dividindo por CELL_W/CELL_H) para nunca ficar
// dessincronizado do que foi realmente impresso.
export function computeBallotLayout(sessions, w = CELL_W, h = CELL_H, pad = BALLOT_PAD) {
  let cy = pad
  cy += 5    // título "CÉDULA DE VOTAÇÃO MANUAL"
  cy += 4.5  // nome da eleição
  const codeRegion = { x: pad, y: cy, w: w - pad * 2, h: 9 }
  cy += 9
  cy += 2.5  // linha divisória + respiro

  // Linha GROSSA entre uma sessão e a próxima, para o eleitor nunca
  // confundir onde termina uma votação e começa outra. Reserva um
  // espaço fixo (linha + respiro), descontado do espaço disponível antes
  // de calcular a altura das linhas de candidato.
  const SEPARATOR_H = 1.8
  const numSeparators = Math.max(0, sessions.length - 1)

  let totalRows = 0
  sessions.forEach(s => {
    totalRows += 1
    totalRows += Math.ceil((s.candidates || []).length / 2)
  })
  const availableH = (h - pad) - cy - (numSeparators * SEPARATOR_H)
  const rawRowH = totalRows > 0 ? availableH / totalRows : availableH
  const rowH = Math.max(2.6, Math.min(5.5, rawRowH))
  const fontSize = Math.max(5, Math.min(7.5, rowH * 1.7))
  const colW = (w - pad * 2) / 2

  const candidateBoxes = []
  const sessionTitles = []
  const separators = []

  sessions.forEach((session, sIdx) => {
    if (sIdx > 0) {
      separators.push({ x: pad, y: cy + SEPARATOR_H / 2, w: w - pad * 2 })
      cy += SEPARATOR_H
    }

    sessionTitles.push({ session_id: session.id, x: pad, y: cy, w: w - pad * 2, h: rowH, title: session.title, votes_required: session.votes_required })
    cy += rowH

    const candidates = session.candidates || []
    for (let i = 0; i < candidates.length; i += 2) {
      const rowCandidates = [candidates[i], candidates[i + 1]]
      const rowY = cy
      rowCandidates.forEach((c, colIdx) => {
        if (!c) return
        const cx = pad + colIdx * colW
        const boxSize = rowH * 0.55
        candidateBoxes.push({
          session_id: session.id,
          candidate_id: c.id,
          candidate_name: c.name,
          x: cx,
          y: rowY + (rowH - boxSize) / 2,
          size: boxSize,
          rowY,
          labelX: cx + boxSize + 1.2,
          labelY: rowY + rowH * 0.72,
          labelMaxWidth: colW - boxSize - 2
        })
      })
      cy += rowH
    }
  })

  return { pad, rowH, fontSize, codeRegion, sessionTitles, candidateBoxes, separators }
}

export function buildManualBallotsPdf(codes, election) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const cellW = (pageW - PAGE_MARGIN * 2 - CELL_GAP * (COLS - 1)) / COLS
  const cellH = (pageH - PAGE_MARGIN * 2 - CELL_GAP * (ROWS - 1)) / ROWS

  const sessions = (election?.sessions || []).filter(s => s.is_active)
  const electionName = election?.name || 'Urna Eletrônica'

  // Cada sessão é INDEPENDENTE, com seu próprio comprovante - então cada
  // código gera UMA CÉDULA POR SESSÃO (todas com o mesmo código impresso),
  // em vez de uma única cédula combinando todas as sessões.
  const items = []
  codes.forEach(code => {
    sessions.forEach(session => items.push({ code, session }))
  })

  items.forEach((item, idx) => {
    const posInPage = idx % CELLS_PER_PAGE
    if (idx > 0 && posInPage === 0) doc.addPage()
    const col = posInPage % COLS
    const row = Math.floor(posInPage / COLS)
    const x = PAGE_MARGIN + col * (cellW + CELL_GAP)
    const y = PAGE_MARGIN + row * (cellH + CELL_GAP)
    drawBallot(doc, x, y, cellW, cellH, item.code, electionName, [item.session])
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

  // Marcadores de canto (fiduciais) sólidos: ajudam o mesário a apontar
  // com precisão os 4 cantos da cédula na tela ao fotografar/enquadrar
  // para a leitura automática.
  const markerSize = 2.2
  doc.setFillColor(30, 41, 59)
  doc.rect(x + 0.6, y + 0.6, markerSize, markerSize, 'F')
  doc.rect(x + w - 0.6 - markerSize, y + 0.6, markerSize, markerSize, 'F')
  doc.rect(x + 0.6, y + h - 0.6 - markerSize, markerSize, markerSize, 'F')
  doc.rect(x + w - 0.6 - markerSize, y + h - 0.6 - markerSize, markerSize, markerSize, 'F')

  const layout = computeBallotLayout(sessions, w, h)
  const pad = layout.pad

  doc.setTextColor(79, 70, 229)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('CÉDULA DE VOTAÇÃO MANUAL', x + pad, y + pad + 3)

  doc.setTextColor(100, 100, 100)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.text(truncateToWidth(doc, electionName, w - pad * 2), x + pad, y + pad + 7.5)

  doc.setTextColor(30, 41, 59)
  doc.setFont('helvetica', 'bold')
  // Fonte/espaçamento se ajustam à quantidade de dígitos (admin pode
  // configurar de 4 a 8), pra sempre caber na largura da cédula.
  const codeFontSize = code.length <= 4 ? 15 : code.length <= 6 ? 12 : 9
  const codeSep = code.length <= 5 ? ' ' : ''
  doc.setFontSize(codeFontSize)
  doc.text(code.split('').join(codeSep), x + layout.codeRegion.x, y + layout.codeRegion.y + 6)

  doc.setDrawColor(210, 210, 210)
  doc.setLineWidth(0.15)
  const dividerY = y + layout.codeRegion.y + layout.codeRegion.h
  doc.line(x + pad, dividerY, x + w - pad, dividerY)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(layout.fontSize)
  doc.setTextColor(67, 56, 202)
  layout.sessionTitles.forEach(st => {
    const title = `${st.title} (vote em ${st.votes_required})`
    doc.text(truncateToWidth(doc, title, st.w), x + st.x, y + st.y + layout.rowH * 0.7)
  })

  // Linha GROSSA separando visualmente uma sessão da próxima, para o
  // eleitor nunca confundir onde termina uma votação e começa outra.
  doc.setDrawColor(30, 41, 59)
  doc.setLineWidth(0.9)
  layout.separators.forEach(sep => {
    doc.line(x + sep.x, y + sep.y, x + sep.x + sep.w, y + sep.y)
  })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(layout.fontSize)
  doc.setTextColor(30, 41, 59)
  doc.setDrawColor(100, 100, 100)
  layout.candidateBoxes.forEach(box => {
    doc.rect(x + box.x, y + box.y, box.size, box.size)
    const label = truncateToWidth(doc, box.candidate_name, box.labelMaxWidth)
    doc.text(label, x + box.labelX, y + box.labelY)
  })
}

export function downloadManualBallotsPdf(codes, election, filename) {
  const doc = buildManualBallotsPdf(codes, election)
  doc.save(`${filename}.pdf`)
}
