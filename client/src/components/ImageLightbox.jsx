import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { IoClose } from 'react-icons/io5';

export default function ImageLightbox({ open, src, alt = '', onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || !src) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex flex-col items-center justify-center p-2 sm:p-6"
      style={{ backgroundColor: 'rgba(0,0,0,0.96)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Imagem em tela cheia"
      onClick={onClose}
    >
      <div className="absolute top-2 right-2 sm:top-4 sm:right-4 z-10">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20 transition-colors"
          aria-label="Fechar"
        >
          <IoClose className="h-7 w-7" />
        </button>
      </div>
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        download
        onClick={(e) => e.stopPropagation()}
        className="absolute top-2 left-2 sm:top-4 sm:left-4 z-10 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-white/20 transition-colors"
      >
        Abrir / baixar
      </a>
      <img
        src={src}
        alt={alt}
        className="max-h-[min(100dvh,100vh)] max-w-full w-auto h-auto object-contain select-none touch-manipulation"
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />
    </div>,
    document.body
  );
}
