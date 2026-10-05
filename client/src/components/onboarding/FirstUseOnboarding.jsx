import { useState, useEffect, useCallback } from 'react';
import { HiEnvelope, HiLockClosed, HiBell, HiSparkles } from 'react-icons/hi2';

function storageKey(address) {
  return `openzap_onboarding_v1_${(address || '').toLowerCase()}`;
}

const STEPS = [
  {
    icon: HiEnvelope,
    title: 'Mensagens sem número de telefone',
    body: 'Sua identidade é a carteira. Converse com seus contatos pela rede, com a simplicidade de um app de mensagens.',
  },
  {
    icon: HiLockClosed,
    title: 'Protegidas neste dispositivo',
    body: 'Um passo na carteira ativa a criptografia local. Não pedimos transações nem acessamos sua chave privada.',
  },
  {
    icon: HiBell,
    title: 'Notificações (opcional)',
    body: 'Você pode permitir alertas para não perder mensagens — ou configurar depois nas configurações.',
  },
  {
    icon: HiSparkles,
    title: 'Pronto para começar',
    body: 'Crie uma conversa ou abra a lista. Quando quiser, instale o OpenZap na tela inicial para abrir como app.',
  },
];

export default function FirstUseOnboarding({ address, onDone }) {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!address || typeof window === 'undefined') return;
    try {
      if (window.localStorage.getItem(storageKey(address)) === '1') {
        setVisible(false);
        return;
      }
    } catch {
      /* ignore */
    }
    setVisible(true);
  }, [address]);

  const finish = useCallback(() => {
    try {
      if (address) window.localStorage.setItem(storageKey(address), '1');
    } catch {
      /* ignore */
    }
    setVisible(false);
    onDone?.();
  }, [address, onDone]);

  if (!visible) return null;

  const s = STEPS[step];
  const Icon = s.icon;
  const last = step === STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-[520] flex flex-col bg-[#09090b] px-6 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onb-title"
    >
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center text-center">
        <div className="mb-8 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-400">
          <Icon className="h-8 w-8" aria-hidden />
        </div>
        <h1 id="onb-title" className="text-2xl font-semibold tracking-tight text-zinc-50">
          {s.title}
        </h1>
        <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-zinc-400">{s.body}</p>
        <div className="mt-10 flex w-full max-w-xs justify-center gap-2">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? 'w-6 bg-emerald-500' : 'w-1.5 bg-zinc-700'
              }`}
            />
          ))}
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:justify-center">
        {!last ? (
          <>
            <button
              type="button"
              onClick={finish}
              className="rounded-xl py-3.5 text-[15px] font-medium text-zinc-500 hover:bg-white/[0.04] touch-manipulation sm:px-8"
            >
              Pular
            </button>
            <button
              type="button"
              onClick={() => setStep((x) => Math.min(x + 1, STEPS.length - 1))}
              className="rounded-xl bg-emerald-500 py-3.5 text-[15px] font-semibold text-zinc-950 hover:bg-emerald-400 touch-manipulation sm:min-w-[200px]"
            >
              Próximo
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={finish}
            className="w-full rounded-xl bg-emerald-500 py-3.5 text-[15px] font-semibold text-zinc-950 hover:bg-emerald-400 touch-manipulation sm:mx-auto sm:max-w-xs"
          >
            Entrar no OpenZap
          </button>
        )}
      </div>
    </div>
  );
}
