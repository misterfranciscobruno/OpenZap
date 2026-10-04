import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * Bottom sheet acessível: foco no painel, Escape fecha, clique no fundo fecha.
 * Respeita safe-area inferior (iPhone).
 */
export default function BottomSheet({
  open,
  onClose,
  titleId,
  children,
  labelledBy,
  /** z-index abaixo do WalletConnect modal (~2147483646) */
  zClass = 'z-[600]',
  /** Se false, não fecha com Escape nem toque fora (fluxos críticos). */
  dismissible = true,
}) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = requestAnimationFrame(() => {
      const el = panelRef.current?.querySelector?.(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      el?.focus?.({ preventScroll: true });
    });
    return () => cancelAnimationFrame(t);
  }, [open]);

  useEffect(() => {
    if (!open || !dismissible) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, dismissible]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={`fixed inset-0 ${zClass} flex flex-col justify-end md:items-center md:justify-center md:p-6`}
      role="presentation"
    >
      {dismissible ? (
        <button
          type="button"
          aria-label="Fechar"
          className="absolute inset-0 bg-black/65 backdrop-blur-[2px] motion-safe:transition-opacity"
          onClick={() => onClose?.()}
        />
      ) : (
        <div
          className="absolute inset-0 bg-black/65 backdrop-blur-[2px]"
          aria-hidden
        />
      )}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy || titleId}
        className="relative mx-auto w-full max-w-lg rounded-t-2xl border border-white/[0.08] border-b-0 bg-[#121214] shadow-[0_-12px_48px_rgba(0,0,0,0.55)] motion-safe:animate-[ozSheetUp_0.28s_cubic-bezier(0.22,1,0.36,1)_forwards] md:rounded-2xl md:border md:max-h-[min(90dvh,640px)] md:overflow-hidden md:border-b"
        style={{
          paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/15 md:hidden"
          aria-hidden
        />
        {children}
      </div>
    </div>,
    document.body
  );
}
