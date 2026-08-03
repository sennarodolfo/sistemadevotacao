// Utilitário genérico de correção de perspectiva: dados 4 pontos (cantos
// de um retângulo fotografado em ângulo) e um tamanho de saída desejado,
// calcula a homografia e "endireita" a imagem em um canvas novo — a
// mesma técnica usada por apps de escaneamento de documentos. Implementado
// em JS puro (resolução de sistema linear 8x8), sem depender de nenhuma
// biblioteca de visão computacional.

// Resolve A·x = b para uma matriz A (n x n) usando eliminação de Gauss
// com pivô parcial. Retorna o vetor solução x.
function solveLinearSystem(A, b) {
  const n = A.length
  const M = A.map((row, i) => [...row, b[i]])

  for (let col = 0; col < n; col++) {
    let pivotRow = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivotRow][col])) pivotRow = r
    }
    if (pivotRow !== col) [M[col], M[pivotRow]] = [M[pivotRow], M[col]]
    const pivot = M[col][col]
    if (Math.abs(pivot) < 1e-12) continue
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const factor = M[r][col] / pivot
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c]
    }
  }

  return M.map((row, i) => row[n] / (row[i] || 1e-12))
}

// Calcula a matriz de homografia 3x3 (8 graus de liberdade) que mapeia
// os 4 pontos de origem (src) para os 4 pontos de destino (dst).
// src/dst: [{x,y}, {x,y}, {x,y}, {x,y}]
function computeHomography(src, dst) {
  const A = []
  const b = []
  for (let i = 0; i < 4; i++) {
    const { x: sx, y: sy } = src[i]
    const { x: dx, y: dy } = dst[i]
    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx])
    b.push(dx)
    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy])
    b.push(dy)
  }
  const h = solveLinearSystem(A, b)
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]
}

export function applyHomography(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8]
  return {
    x: (H[0] * x + H[1] * y + H[2]) / w,
    y: (H[3] * x + H[4] * y + H[5]) / w
  }
}

// Endireita a região definida pelos 4 cantos (ordem: topo-esquerda,
// topo-direita, baixo-direita, baixo-esquerda) da imagem de origem para
// um canvas novo de outW x outH pixels, usando amostragem inversa
// (para cada pixel de destino, descobre de onde veio na origem).
export function warpToRectangle(sourceCanvasOrImage, corners, outW, outH) {
  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = sourceCanvasOrImage.width || sourceCanvasOrImage.naturalWidth
  srcCanvas.height = sourceCanvasOrImage.height || sourceCanvasOrImage.naturalHeight
  const srcCtx = srcCanvas.getContext('2d')
  srcCtx.drawImage(sourceCanvasOrImage, 0, 0)
  const srcData = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height)

  const dst = [
    { x: 0, y: 0 },
    { x: outW, y: 0 },
    { x: outW, y: outH },
    { x: 0, y: outH }
  ]
  // Homografia de DESTINO -> ORIGEM (para amostragem inversa)
  const H = computeHomography(dst, corners)

  const outCanvas = document.createElement('canvas')
  outCanvas.width = outW
  outCanvas.height = outH
  const outCtx = outCanvas.getContext('2d')
  const outData = outCtx.createImageData(outW, outH)
  const srcW = srcCanvas.width
  const srcH = srcCanvas.height

  for (let oy = 0; oy < outH; oy++) {
    for (let ox = 0; ox < outW; ox++) {
      const wDen = H[6] * ox + H[7] * oy + H[8]
      const sx = (H[0] * ox + H[1] * oy + H[2]) / wDen
      const sy = (H[3] * ox + H[4] * oy + H[5]) / wDen
      const ix = (sx + 0.5) | 0
      const iy = (sy + 0.5) | 0
      const outIdx = (oy * outW + ox) * 4
      if (ix >= 0 && ix < srcW && iy >= 0 && iy < srcH) {
        const inIdx = (iy * srcW + ix) * 4
        outData.data[outIdx] = srcData.data[inIdx]
        outData.data[outIdx + 1] = srcData.data[inIdx + 1]
        outData.data[outIdx + 2] = srcData.data[inIdx + 2]
        outData.data[outIdx + 3] = 255
      } else {
        outData.data[outIdx] = 255
        outData.data[outIdx + 1] = 255
        outData.data[outIdx + 2] = 255
        outData.data[outIdx + 3] = 255
      }
    }
  }

  outCtx.putImageData(outData, 0, 0)
  return outCanvas
}

// Carrega um File/Blob de imagem em um <img> pronto para uso em canvas.
export function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Não foi possível carregar a imagem'))
    img.src = url
  })
}
