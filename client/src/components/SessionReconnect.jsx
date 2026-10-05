import { useState, useEffect, useCallback } from 'react';

import { IoWallet } from 'react-icons/io5';

import { useAuth } from '../contexts/AuthContext';
import SiteFooter from './SiteFooter';

import {

  hasBrowserWalletInjection,

  isMobileOrTablet,

  getMetaMaskDappUniversalLink,

  getMetaMaskDappNativeFallbackLink,

  getCanonicalDappUrl,

  isInsecureHttpDapp,

  walletConnectProjectIdConfigured,

} from '../utils/ethereumProvider';



const REOWN_CLOUD = 'https://cloud.reown.com/';



export default function SessionReconnect() {

  const { user, reconnectSession } = useAuth();

  const [busy, setBusy] = useState(false);

  const [error, setError] = useState(null);

  const [browserWallet, setBrowserWallet] = useState(() =>

    typeof window !== 'undefined' ? hasBrowserWalletInjection() : false

  );



  const wcConfigured = walletConnectProjectIdConfigured();

  const canReconnect = browserWallet || wcConfigured;



  const refreshBrowserWallet = useCallback(() => {

    setBrowserWallet(hasBrowserWalletInjection());

  }, []);



  useEffect(() => {

    refreshBrowserWallet();

    if (typeof window === 'undefined') return undefined;

    const onInit = () => refreshBrowserWallet();

    window.addEventListener('ethereum#initialized', onInit);

    const t = window.setTimeout(refreshBrowserWallet, 800);

    return () => {

      window.removeEventListener('ethereum#initialized', onInit);

      window.clearTimeout(t);

    };

  }, [refreshBrowserWallet]);



  const mobileNoBrowser = !browserWallet && isMobileOrTablet();

  const showMmFallback = mobileNoBrowser && !wcConfigured;

  const metaMaskUniversalUrl =

    typeof window !== 'undefined' ? getMetaMaskDappUniversalLink() : '';

  const metaMaskNativeUrl =

    typeof window !== 'undefined' ? getMetaMaskDappNativeFallbackLink() : '';

  const canonicalDapp = typeof window !== 'undefined' ? getCanonicalDappUrl() : '';

  const httpWarning = typeof window !== 'undefined' && isInsecureHttpDapp();

  const [copied, setCopied] = useState(false);



  async function copyCanonicalUrl() {

    if (!canonicalDapp) return;

    try {

      await navigator.clipboard.writeText(canonicalDapp);

      setCopied(true);

      window.setTimeout(() => setCopied(false), 2500);

    } catch {

      try {

        const ta = document.createElement('textarea');

        ta.value = canonicalDapp;

        ta.setAttribute('readonly', '');

        ta.style.position = 'fixed';

        ta.style.left = '-9999px';

        document.body.appendChild(ta);

        ta.select();

        document.execCommand('copy');

        document.body.removeChild(ta);

        setCopied(true);

        window.setTimeout(() => setCopied(false), 2500);

      } catch {

        /* ignore */

      }

    }

  }



  async function handleReconnect() {

    setError(null);

    if (!canReconnect) {

      setError(

        'Defina VITE_WALLETCONNECT_PROJECT_ID no build (cloud.reown.com + Allowed domains) ou abra o OpenZap no navegador do app MetaMask e toque novamente em «Assinar e continuar».'

      );

      return;

    }

    setBusy(true);

    try {

      await reconnectSession();

    } catch (e) {

      const raw = typeof e?.message === 'string' ? e.message : 'Não foi possível conectar.';

      setError(raw);

    } finally {

      setBusy(false);

    }

  }



  return (

    <div className="flex min-h-full flex-col items-center justify-center overflow-x-hidden bg-whatsapp-dark px-6 text-center touch-manipulation">

      <h1 className="text-xl font-medium text-whatsapp-text">Sessão do chat incompleta</h1>

      <p className="mt-3 max-w-md text-sm leading-relaxed text-whatsapp-text-secondary">

        Para mensagens em tempo real, é preciso assinar novamente com a carteira (a sessão da aba pode

        ter sido limpa ou o servidor foi reiniciado).

      </p>

      {user?.address && (

        <p className="mt-4 font-mono text-xs text-whatsapp-text-secondary">{user.address}</p>

      )}



      {mobileNoBrowser && wcConfigured && (

        <p className="mt-4 max-w-md rounded-xl border border-whatsapp-green/35 bg-whatsapp-dark/60 px-4 py-3 text-sm text-whatsapp-text-secondary">

          Toque em <strong className="text-whatsapp-text">Assinar e continuar</strong>. Se precisar, a

          MetaMask pede primeiro <strong className="text-whatsapp-text">conectar</strong> e depois a{' '}

          <strong className="text-whatsapp-text">assinatura</strong>.

        </p>

      )}



      {showMmFallback && (

        <div className="mt-4 max-w-md rounded-xl border border-amber-600/40 bg-amber-950/30 px-4 py-3 text-left text-sm text-amber-100/90">

          <p className="font-medium text-amber-200">WalletConnect não configurado no build</p>

          <p className="mt-1 text-amber-100/80">

            Adicione <code className="text-amber-50">VITE_WALLETCONNECT_PROJECT_ID</code> (

            <a

              href={REOWN_CLOUD}

              target="_blank"

              rel="noopener noreferrer"

              className="font-semibold text-whatsapp-green underline underline-offset-2"

            >

              cloud.reown.com

            </a>

            ), o domínio em Allowed domains, novo <code className="text-amber-50">npm run build</code>, e

            publique. <strong className="text-amber-100">Alternativa:</strong> abrir o OpenZap no
            navegador da MetaMask e usar «Verificar novamente».

          </p>

          {httpWarning && (

            <p className="mt-2 rounded-lg bg-red-950/35 px-2 py-2 text-xs text-red-100/90">

              Site em <strong>http</strong>: no iOS a MetaMask costuma precisar de{' '}

              <strong>https</strong>.

            </p>

          )}

          <a

            href={metaMaskUniversalUrl}

            className="mt-3 flex w-full items-center justify-center rounded-lg bg-whatsapp-cta py-3 text-center text-sm font-semibold text-whatsapp-dark no-underline"

          >

            Abrir no MetaMask

          </a>

          <a

            href={metaMaskNativeUrl}

            className="mt-2 flex w-full items-center justify-center rounded-lg border border-amber-500/50 bg-amber-950/40 py-3 text-center text-sm font-semibold text-amber-100 no-underline"

          >

            Conexão direta com o app

          </a>

          <button

            type="button"

            onClick={copyCanonicalUrl}

            className="mt-2 w-full rounded-lg border border-whatsapp-border/60 py-2.5 text-center text-xs font-medium text-whatsapp-text-secondary"

          >

            {copied ? 'Copiado — cole no navegador da MetaMask' : 'Copiar endereço deste site'}

          </button>

          <button

            type="button"

            onClick={() => {

              setError(null);

              refreshBrowserWallet();

            }}

            className="mt-2 w-full rounded-lg border border-whatsapp-border/60 py-2.5 text-center text-xs font-medium text-whatsapp-text-secondary"

          >

            Verificar novamente (já estou no navegador da MetaMask)

          </button>

        </div>

      )}



      {error && (

        <p className="mt-4 max-w-md rounded-lg bg-red-950/40 px-3 py-2 text-sm text-red-200" role="alert">

          {error}

        </p>

      )}

      <button

        type="button"

        onClick={handleReconnect}

        disabled={busy || !canReconnect}

        className="mt-6 flex items-center gap-2 rounded-xl bg-whatsapp-green px-6 py-3 text-base font-semibold text-whatsapp-on-primary disabled:opacity-50"

      >

        {busy ? (

          <span className="h-5 w-5 animate-spin rounded-full border-2 border-whatsapp-on-primary border-t-transparent" />

        ) : (

          <IoWallet className="h-6 w-6" />

        )}

        {busy ? 'Aguardando a carteira…' : 'Assinar e continuar'}

      </button>

      <SiteFooter className="mt-10 pb-[max(1rem,env(safe-area-inset-bottom))]" />

    </div>

  );

}


