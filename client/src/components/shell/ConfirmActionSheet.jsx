import { createPortal } from 'react-dom';
import BottomSheet from './BottomSheet';
import { useMediaQuery } from '../../hooks/useMediaQuery';

/**
 * Confirmação destrutiva: bottom sheet no celular, modal centrado no desktop.
 */
export default function ConfirmActionSheet({
  open,
  onClose,
  title,
  titleId = 'confirm-action-title',
  description,
  extra,
  actions,
}) {
  const isMdUp = useMediaQuery('(min-width: 768px)');

  if (!open) return null;

  const body = (
    <>
      <h2 id={titleId} className="text-lg font-semibold text-zinc-50 md:text-center">
        {title}
      </h2>
      {description ? (
        <div className="mt-2 text-sm leading-relaxed text-zinc-400 md:text-center">{description}</div>
      ) : null}
      {extra ? <div className="mt-3 md:text-center">{extra}</div> : null}
      <div className="mt-6 flex flex-col gap-2 md:mt-5 md:flex-row md:flex-wrap md:justify-end">
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            disabled={a.disabled}
            title={a.title}
            onClick={() => {
              a.onClick?.();
            }}
            className={a.className}
          >
            {a.label}
          </button>
        ))}
      </div>
    </>
  );

  if (isMdUp) {
    return createPortal(
      <div
        className="fixed inset-0 z-[400] flex items-center justify-center p-4"
        style={{ backgroundColor: 'rgba(0,0,0,0.82)' }}
        role="presentation"
        onClick={() => onClose?.()}
        onKeyDown={(e) => e.key === 'Escape' && onClose?.()}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="w-full max-w-md rounded-xl border border-whatsapp-border bg-whatsapp-sidebar p-5 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {body}
        </div>
      </div>,
      document.body
    );
  }

  return (
    <BottomSheet open={open} onClose={onClose} titleId={titleId} zClass="z-[400]">
      <div className="px-5 pb-2 pt-1">{body}</div>
    </BottomSheet>
  );
}
