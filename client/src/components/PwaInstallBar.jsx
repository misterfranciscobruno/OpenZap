import { useState, useEffect, useCallback } from 'react';
import { IoClose, IoDownloadOutline } from 'react-icons/io5';

function isStandaloneDisplay() {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)')?.matches) return true;
  if (window.navigator?.standalone === true) return true;
  return false;
}

function isIosSafariLike() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!iOS) return false;
  const webkit = /WebKit/.test(ua);
  const notOther = !/CriOS|FxiOS|OPiOS|EdgiOS/.test(ua);
  return webkit && notOther;
}

const IOS_HINT_KEY = 'openzap_pwa_ios_hint_dismissed';

export default function PwaInstallBar() {
  const [standalone, setStandalone] = useState(() => isStandaloneDisplay());
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [iosHintOpen, setIosHintOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia?.('(display-mode: standalone)');
    const onChange = () => setStandalone(isStandaloneDisplay());
    mq?.addEventListener?.('change', onChange);
    return () => mq?.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    if (standalone) return undefined;

    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const onInstalled = () => {
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [standalone]);

  useEffect(() => {
    if (standalone || deferredPrompt) return;
    if (!isIosSafariLike()) return;
    try {
      if (localStorage.getItem(IOS_HINT_KEY) === '1') return;
    } catch {
      return;
    }
    setIosHintOpen(true);
  }, [standalone, deferredPrompt]);

  const dismissIosHint = useCallback(() => {
    setIosHintOpen(false);
    try {
      localStorage.setItem(IOS_HINT_KEY, '1');
    } catch {
      /* ignore */
    }
  }, []);

  const runInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } catch {
      /* ignore */
    }
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  if (standalone) return null;

  if (deferredPrompt) {
    return (
      <div className="shrink-0 border-b border-white/10 bg-whatsapp-green/15 px-3 py-2.5 sm:px-4">
        <div className="flex items-start gap-2">
          <IoDownloadOutline className="mt-0.5 h-5 w-5 shrink-0 text-whatsapp-green" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-whatsapp-text">Instalar na área de trabalho</p>
            <p className="mt-0.5 text-xs leading-snug text-whatsapp-text-secondary">
              Abre como aplicativo próprio (janela sem barra do navegador), com atalho no menu Iniciar ou
              na tela inicial.
            </p>
            <button
              type="button"
              onClick={runInstall}
              className="mt-2 rounded-md bg-whatsapp-green px-3 py-1.5 text-xs font-semibold text-whatsapp-on-primary hover:opacity-90"
            >
              Instalar OpenZap
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (iosHintOpen) {
    return (
      <div className="shrink-0 border-b border-white/10 bg-white/5 px-3 py-2 sm:px-4">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-[12px] leading-snug text-whatsapp-text-secondary">
            <span className="text-whatsapp-text">iPhone / iPad:</span> toque nos … no canto inferior
            direito, toque em Compartilhar, Ver mais e, em seguida, em Adicionar à Tela de Início.
          </p>
          <button
            type="button"
            onClick={dismissIosHint}
            className="shrink-0 rounded-full p-1 text-whatsapp-text-secondary hover:bg-white/10 hover:text-whatsapp-text"
            aria-label="Fechar dica"
          >
            <IoClose className="h-5 w-5" />
          </button>
        </div>
      </div>
    );
  }

  return null;
}
