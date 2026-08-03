import { useEffect } from 'react'
import { Icon } from './Icon'

// Overlay de tela cheia para ampliar a foto de um candidato ao clicar.
// Fecha ao clicar fora da imagem, no X, ou pressionando Esc.
export default function PhotoLightbox({ photoUrl, name, onClose }) {
  useEffect(() => {
    if (!photoUrl) return
    function handleKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [photoUrl, onClose])

  if (!photoUrl) return null

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-[100] fade-in"
      onClick={onClose}
    >
      <div className="relative max-w-lg w-full" onClick={e => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-3 -right-3 bg-white text-slate-700 rounded-full w-9 h-9 flex items-center justify-center shadow-lg hover:bg-slate-100"
          aria-label="Fechar"
        >
          <Icon name="x" className="w-5 h-5" />
        </button>
        <img
          src={photoUrl}
          alt={name || 'Foto do candidato'}
          className="w-full max-h-[80vh] object-contain rounded-xl bg-white shadow-2xl"
        />
        {name && (
          <p className="text-center text-white font-semibold mt-3 text-lg">{name}</p>
        )}
      </div>
    </div>
  )
}
