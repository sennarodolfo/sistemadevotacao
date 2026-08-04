import { warpToRectangle } from './imageGeometry'
import { computeBallotLayout, CELL_W, CELL_H, BALLOT_PAD } from './manualBallotPdf'

const PX_PER_MM = 10
export const WARPED_W = Math.round(CELL_W * PX_PER_MM)
export const WARPED_H = Math.round(CELL_H * PX_PER_MM)

function mmRectToPx(rect) {
  return {
    x: Math.round(rect.x * PX_PER_MM),
    y: Math.round(rect.y * PX_PER_MM),
    w: Math.round(rect.w * PX_PER_MM),
    h: Math.round(rect.h * PX_PER_MM)
  }
}

// "Escurecimento" médio (0 = branco, 1 = preto total) de uma região do
// canvas - usado tanto para decidir se um quadradinho foi marcado
// quanto, futuramente, para outras checagens de qualidade da imagem.
function regionDarkness(canvas, x, y, w, h) {
  const ctx = canvas.getContext('2d')
  const cx = Math.max(0, Math.round(x))
  const cy = Math.max(0, Math.round(y))
  const cw = Math.min(canvas.width - cx, Math.round(w))
  const ch = Math.min(canvas.height - cy, Math.round(h))
  if (cw <= 0 || ch <= 0) return 0
  const data = ctx.getImageData(cx, cy, cw, ch).data
  let sum = 0
  const n = cw * ch
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
    sum += 255 - gray
  }
  return n > 0 ? sum / n / 255 : 0
}

// Endireita a foto da cédula (corrige perspectiva) a partir dos 4 cantos
// indicados pelo mesário, para o tamanho de referência do template.
export function warpBallotPhoto(img, corners) {
  return warpToRectangle(img, corners, WARPED_W, WARPED_H)
}

// OMR: lê a marcação de cada quadradinho de candidato, usando o MESMO
// layout usado para desenhar o PDF (computeBallotLayout), garantindo que
// a leitura sempre bate com o que foi impresso. O corte "marcado / não
// marcado" é adaptativo: separa os quadradinhos em dois grupos pelo
// maior salto de escurecimento entre eles, em vez de um limiar fixo -
// assim a leitura se ajusta sozinha a fotos mais claras/escuras.
export function readMarks(warpedCanvas, sessions) {
  const layout = computeBallotLayout(sessions, CELL_W, CELL_H, BALLOT_PAD)

  const scored = layout.candidateBoxes.map(box => {
    // Amostra o miolo do quadrado (um pouco menor que o desenhado), para
    // não confundir a própria borda impressa com uma marcação.
    const inset = box.size * 0.18
    const rect = mmRectToPx({
      x: box.x + inset,
      y: box.y + inset,
      w: box.size - inset * 2,
      h: box.size - inset * 2
    })
    const darkness = regionDarkness(warpedCanvas, rect.x, rect.y, rect.w, rect.h)
    return { ...box, darkness }
  })

  if (scored.length === 0) return []

  const sortedVals = [...scored].map(s => s.darkness).sort((a, b) => a - b)
  let bestGap = -1
  let threshold = 0.3
  for (let i = 1; i < sortedVals.length; i++) {
    const gap = sortedVals[i] - sortedVals[i - 1]
    if (gap > bestGap) {
      bestGap = gap
      threshold = (sortedVals[i] + sortedVals[i - 1]) / 2
    }
  }
  // Só confia no salto se ele for expressivo (marca real costuma ser bem
  // mais escura que um quadrado vazio). Cédula toda em branco = sem
  // salto grande = usa o piso fixo (nada marcado, provavelmente).
  if (bestGap < 0.12) threshold = Math.max(threshold, 0.3)

  return scored.map(s => ({ ...s, marked: s.darkness >= threshold }))
}

// OCR: lê o código impresso no topo da cédula (comprimento configurável,
// 4 a 8 dígitos), via Tesseract.js (roda inteiramente no navegador, sem
// backend). Recorta só a região onde o código foi impresso (mesmo layout
// do PDF) e amplia antes de processar, para acelerar e melhorar a precisão.
export async function readCode(warpedCanvas, sessions, codeLength = 4) {
  const layout = computeBallotLayout(sessions, CELL_W, CELL_H, BALLOT_PAD)
  const rect = mmRectToPx(layout.codeRegion)

  const scale = 3
  const cropCanvas = document.createElement('canvas')
  cropCanvas.width = Math.max(1, rect.w * scale)
  cropCanvas.height = Math.max(1, rect.h * scale)
  const ctx = cropCanvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(warpedCanvas, rect.x, rect.y, rect.w, rect.h, 0, 0, cropCanvas.width, cropCanvas.height)

  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('eng')
  try {
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789',
      tessedit_pageseg_mode: '7'
    })
    const { data } = await worker.recognize(cropCanvas)
    const digits = (data.text || '').replace(/[^0-9]/g, '')
    return { raw: data.text || '', digits: digits.slice(0, codeLength), confidence: data.confidence || 0 }
  } finally {
    await worker.terminate()
  }
}
