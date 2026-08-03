// Redimensiona e comprime uma imagem no navegador (via canvas) e retorna
// um data URI (base64) pronto para ser salvo no banco. Isso evita
// depender de um bucket de Storage separado: a foto viaja junto com o
// resto dos dados do candidato, pelas mesmas funções RPC já usadas por
// todo o painel administrativo.
export function fileToResizedDataUrl(file, { maxDim = 480, quality = 0.82 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('Nenhum arquivo selecionado'))
    if (!file.type.startsWith('image/')) return reject(new Error('O arquivo precisa ser uma imagem'))
    if (file.size > 12 * 1024 * 1024) return reject(new Error('Imagem muito grande (máx. 12MB)'))

    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Erro ao ler o arquivo'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Erro ao processar a imagem'))
      img.onload = () => {
        let { width, height } = img
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round((height * maxDim) / width)
            width = maxDim
          } else {
            width = Math.round((width * maxDim) / height)
            height = maxDim
          }
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, width, height)
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}
