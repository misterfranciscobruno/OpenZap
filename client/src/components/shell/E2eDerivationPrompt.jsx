import { useState } from 'react';
import { HiLockClosed, HiChevronRight } from 'react-icons/hi2';
import { useAuth } from '../../contexts/AuthContext';
import { useChat } from '../../contexts/ChatContext';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import BottomSheet from './BottomSheet';

const TITLE_ID = 'oz-e2e-derivation-title';

/**
 * Pedido de ativação E2E: no celular = pill inferior + bottom sheet guiado;
 * no desktop = faixa superior compacta (sem ocupar a zona do polegar).
 */
export default function E2eDerivationPrompt() {
  const { needsE2eDerivation, initEncryption } = useAuth();
  const { activeConversation } = useChat();
  const isMdUp = useMediaQuery('(min-width: 768px)');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);

  if (!needsE2eDerivation) return null;

  const runSign = async () => {
    setErr('');
    setBusy(true);
    try {
      const r = await initEncryption();
      if (r && r.ok === false && r.error !== 'already') {
        const m = String(r.error || '');
        setErr(m.length > 140 ? `${m.slice(0, 140)}…` : m || 'Não foi possível concluir.');
      } else {
        setSheetOpen(false);
      }
    } finally {
      setBusy(false);
    }
  };

  if (isMdUp) {
    return (
      <div
        role="region"
        aria-label="Proteger mensagens com criptografia local"
        className="flex shrink-0 flex-col gap-2 border-b border-white/[0.07] bg-[#111114]/95 px-4 py-3 backdrop-blur-md md:flex-row md:items-center md:justify-between"
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-400/95">
            <HiLockClosed className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p id={TITLE_ID} className="text-sm font-medium text-zinc-100">
              Um passo para ler e enviar mensagens protegidas
            </p>
            <p className="mt-1 text-sm leading-relaxed text-zinc-400">
              Vamos pedir uma assinatura na sua carteira para gerar as chaves neste dispositivo. Isso
              não transfere fundos nem concede permissões permanentes.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 md:flex-row md:items-center">
          {err ? (
            <p className="text-xs text-red-300/95 md:max-w-[220px]" role="alert">
              {err}
            </p>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void runSign()}
            className="rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50 touch-manipulation"
          >
            {busy ? 'Aguardando a carteira…' : 'Continuar na carteira'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[480] flex justify-center px-3"
        style={{
          paddingBottom: activeConversation
            ? 'max(5.5rem, calc(env(safe-area-inset-bottom, 0px) + 4.25rem))'
            : 'max(12px, env(safe-area-inset-bottom, 0px))',
        }}
        aria-hidden={!needsE2eDerivation}
      >
        <div className="pointer-events-auto w-full max-w-md">
          <button
            type="button"
            onClick={() => {
              setErr('');
              setSheetOpen(true);
            }}
            className="flex w-full items-center gap-3 rounded-2xl border border-white/[0.1] bg-zinc-900/95 px-4 py-3.5 text-left shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-md touch-manipulation active:scale-[0.99] motion-safe:transition-transform"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-500/14 text-emerald-400">
              <HiLockClosed className="h-5 w-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold text-zinc-50">
                Proteger suas mensagens
              </span>
              <span className="mt-0.5 block text-[13px] leading-snug text-zinc-400">
                Toque para ver o que pedimos à carteira — é rápido e fica só neste aparelho.
              </span>
            </span>
            <HiChevronRight className="h-5 w-5 shrink-0 text-zinc-500" aria-hidden />
          </button>
        </div>
      </div>

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} titleId={TITLE_ID}>
        <div className="px-5 pb-2 pt-4 md:px-6 md:pt-6">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-400">
            <HiLockClosed className="h-6 w-6" aria-hidden />
          </div>
          <h2 id={TITLE_ID} className="text-center text-lg font-semibold tracking-tight text-zinc-50">
            Ativar leitura segura
          </h2>
          <p className="mt-3 text-center text-[15px] leading-relaxed text-zinc-400">
            Para descriptografar e enviar mensagens neste celular, precisamos que você confirme sua
            identidade na carteira assinando uma mensagem fixa definida pelo app.
          </p>
          <ul className="mt-5 space-y-3 text-[14px] leading-relaxed text-zinc-300">
            <li className="flex gap-2.5">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500/80" aria-hidden />
              <span>
                <strong className="font-medium text-zinc-200">O que acontece:</strong> gera-se material
                criptográfico neste dispositivo a partir da assinatura.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-600" aria-hidden />
              <span>
                <strong className="font-medium text-zinc-200">O que não acontece:</strong> não enviamos
                sua chave privada, não movemos saldos e não pedimos aprovação de transação.
              </span>
            </li>
          </ul>
          {err ? (
            <p className="mt-4 rounded-xl bg-red-500/10 px-3 py-2 text-center text-sm text-red-200/95" role="alert">
              {err}
            </p>
          ) : null}
          <div className="mt-6 flex flex-col gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void runSign()}
              className="w-full rounded-xl bg-emerald-500 py-3.5 text-[15px] font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50 touch-manipulation"
            >
              {busy ? 'Aguardando a carteira…' : 'Assinar com a carteira'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setSheetOpen(false)}
              className="w-full rounded-xl py-3 text-[15px] font-medium text-zinc-400 hover:bg-white/[0.04] touch-manipulation"
            >
              Agora não
            </button>
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
