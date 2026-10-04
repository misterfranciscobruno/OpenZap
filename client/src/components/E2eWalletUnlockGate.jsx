import { HiLockClosed } from 'react-icons/hi2';
import { useMediaQuery } from '../hooks/useMediaQuery';
import BottomSheet from './shell/BottomSheet';

const TITLE_ID = 'e2e-wallet-unlock-title';

/**
 * Restaurar cofre local: em mobile usa bottom sheet; em desktop mantém cartão centrado.
 */
export default function E2eWalletUnlockGate({ error, busy, onSign }) {
  const isMdUp = useMediaQuery('(min-width: 768px)');

  const body = (
    <>
      <div className="mb-4 flex justify-center md:mb-5">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-400">
          <HiLockClosed className="h-7 w-7" aria-hidden />
        </span>
      </div>
      <h2
        id={TITLE_ID}
        className="text-center text-lg font-semibold tracking-tight text-zinc-50 md:text-xl"
      >
        Restaurar criptografia neste dispositivo
      </h2>
      <p className="mt-3 text-center text-[15px] leading-relaxed text-zinc-400">
        Sua carteira vai pedir para assinar uma mensagem fixa. Isso apenas desbloqueia a cópia
        criptografada salva localmente — não enviamos a chave privada ao servidor e não movemos saldos.
      </p>
      {error ? (
        <p className="mt-4 rounded-xl bg-red-500/10 px-3 py-2 text-center text-sm text-red-200/95" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => void onSign()}
        className="mt-6 w-full rounded-xl bg-emerald-500 py-3.5 text-[15px] font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50 touch-manipulation md:rounded-lg md:py-3"
      >
        {busy ? 'Aguardando assinatura…' : 'Continuar na carteira'}
      </button>
    </>
  );

  if (isMdUp) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
        <div
          className="w-full max-w-md rounded-xl border border-whatsapp-border bg-[#121214] p-6 shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby={TITLE_ID}
        >
          {body}
        </div>
      </div>
    );
  }

  return (
    <BottomSheet open dismissible={false} zClass="z-[100]" titleId={TITLE_ID}>
      <div className="px-5 pb-1 pt-2">{body}</div>
    </BottomSheet>
  );
}
