import { useState, useEffect, useCallback } from 'react';
import { IoWallet, IoShieldCheckmark } from 'react-icons/io5';
import { HiChatBubbleLeftRight, HiLockClosed } from 'react-icons/hi2';
import { useAuth } from '../contexts/AuthContext';
import {
  hasBrowserWalletInjection,
  isIOS,
  isMobileOrTablet,
  getMetaMaskDappUniversalLink,
  getMetaMaskDappNativeFallbackLink,
  getCanonicalDappUrl,
  isInsecureHttpDapp,
  walletConnectProjectIdConfigured,
} from '../utils/ethereumProvider';

const METAMASK_URL = 'https://metamask.io/download/';
const REOWN_CLOUD = 'https://cloud.reown.com/';

function MetaWhatsLogo({ className = '' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M60 12C35 12 15 32 15 57c0 18 9 34 23 43l-3 18 17-9c5 2 11 3 18 3 25 0 45-20 45-45S85 12 60 12z"
        fill="#10B981"
      />
      <path
        d="M58 38 L44 62h12l-4 20 22-28H66l6-16z"
        fill="#030303"
        stroke="#030303"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function defaultNicknameFromAddress(addr) {
  if (!addr || addr.length < 8) return '';
  const hex = addr.startsWith('0x') ? addr.slice(2, 8) : addr.slice(0, 6);
  return `User_${hex}`;
}

function parseWalletError(err) {
  if (!err) return 'Ocorreu um erro ao conectar a carteira.';
  const code = err.code ?? err?.error?.code;
  if (code === 4001 || code === 'ACTION_REJECTED') {
    return 'Conexão cancelada. Você precisa aprovar o pedido na carteira.';
  }
  const msg = typeof err.message === 'string' ? err.message : String(err);
  if (msg.includes('OZ_WC_ORIGIN:')) {
    return msg.replace(/^OZ_WC_ORIGIN:\s*/, '').trim();
  }
  if (msg.includes('VITE_WALLETCONNECT_PROJECT_ID') || msg.includes('cloud.reown')) {
    return msg;
  }
  if (msg.includes('MetaMask não encontrado') || msg.includes('não encontrado')) {
    return msg;
  }
  if (msg.includes('User denied') || msg.includes('denied transaction')) {
    return 'Pedido rejeitado na carteira.';
  }
  if (msg.includes('Proposal expired') || msg.includes('rejected')) {
    return 'Pedido expirado ou rejeitado. Tente novamente.';
  }
  return msg || 'Não foi possível conectar.';
}

export default function Login() {
  const {
    linkedLogin,
    connectWalletOnly,
    completeLoginProfileRead,
    completeLoginWithSignature,
    cancelWalletLinking,
  } = useAuth();

  const [loginStep, setLoginStep] = useState(1);
  const [nickname, setNickname] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [profileResolving, setProfileResolving] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState(null);

  const [browserWallet, setBrowserWallet] = useState(() =>
    typeof window !== 'undefined' ? hasBrowserWalletInjection() : false
  );

  const wcConfigured = walletConnectProjectIdConfigured();
  const canConnect = browserWallet || wcConfigured;

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

  useEffect(() => {
    if (!linkedLogin?.address) {
      setLoginStep(1);
      return;
    }
    if (linkedLogin.existingNickname) {
      setLoginStep(3);
    } else {
      setLoginStep(2);
      setNickname((n) =>
        n.trim().length >= 2 ? n : defaultNicknameFromAddress(linkedLogin.address)
      );
    }
  }, [linkedLogin]);

  const linkedAddress = linkedLogin?.address ?? null;
  const skippedUsernameStep = Boolean(linkedLogin?.existingNickname);

  const mobileNoBrowserWallet = !browserWallet && isMobileOrTablet();
  const showMmBrowserFallback = mobileNoBrowserWallet && !wcConfigured;
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

  async function handleStep1Connect() {
    if (!canConnect) return;
    setError(null);
    setConnecting(true);
    setProfileResolving(false);
    try {
      const address = await connectWalletOnly();
      setConnecting(false);
      setProfileResolving(true);
      await completeLoginProfileRead(address);
    } catch (e) {
      setError(parseWalletError(e));
    } finally {
      setConnecting(false);
      setProfileResolving(false);
    }
  }

  function handleGoToSignStep() {
    setError(null);
    const n = nickname.trim();
    if (n.length < 2) {
      setError('Use pelo menos 2 caracteres no nome de usuário.');
      return;
    }
    setLoginStep(3);
  }

  async function handleStep3Sign() {
    setError(null);
    setSigning(true);
    try {
      await completeLoginWithSignature(nickname);
    } catch (e) {
      setError(parseWalletError(e));
    } finally {
      setSigning(false);
    }
  }

  function handleBackFromUsername() {
    setError(null);
    cancelWalletLinking();
    setLoginStep(1);
  }

  return (
    <div className="relative h-full max-h-full w-full max-w-[100vw] overflow-y-auto overflow-x-hidden overscroll-y-contain bg-whatsapp-dark touch-manipulation">
      <div
        className="pointer-events-none fixed inset-0 bg-gradient-to-br from-[#050508] via-transparent to-[#040806] opacity-95"
        aria-hidden
      />
      <div className="relative z-10 flex min-h-min w-full items-start justify-center p-4 pb-10 sm:p-6 sm:pb-12">
        <div className="oz-animate-login my-4 w-full max-w-md rounded-2xl border border-whatsapp-border/40 bg-whatsapp-sidebar/95 p-6 shadow-2xl shadow-black/40 backdrop-blur-sm transition-transform duration-300 sm:p-8 sm:hover:scale-[1.01]">
          <div className="flex flex-col items-center text-center">
            <MetaWhatsLogo className="mb-5 h-24 w-24 drop-shadow-lg" />
            <h1 className="text-3xl font-semibold tracking-tight text-whatsapp-text">MetaWhats</h1>
            <p className="mt-2 text-sm leading-relaxed text-whatsapp-text-secondary">
              Mensagens descentralizadas. Sua identidade, sua carteira.
            </p>
          </div>

          <ol className="mt-6 flex items-center justify-center gap-2 text-xs text-whatsapp-text-secondary">
            <li
              className={`rounded-full px-2.5 py-1 ${
                loginStep >= 1 ? 'bg-whatsapp-green/25 text-whatsapp-green' : ''
              }`}
            >
              1 · Conectar
            </li>
            <span aria-hidden className="text-whatsapp-border">
              →
            </span>
            <li
              className={`rounded-full px-2.5 py-1 ${
                loginStep >= 2 || skippedUsernameStep ? 'bg-whatsapp-green/25 text-whatsapp-green' : ''
              }`}
            >
              2 · Nome
            </li>
            <span aria-hidden className="text-whatsapp-border">
              →
            </span>
            <li
              className={`rounded-full px-2.5 py-1 ${
                loginStep >= 3 ? 'bg-whatsapp-green/25 text-whatsapp-green' : ''
              }`}
            >
              3 · Assinar
            </li>
          </ol>

          {loginStep === 1 && (
            <>
              <ul className="mt-8 space-y-4">
                <li className="flex items-start gap-3 rounded-xl bg-whatsapp-dark/50 px-4 py-3 transition-colors hover:bg-whatsapp-hover/30">
                  <IoShieldCheckmark className="mt-0.5 h-6 w-6 shrink-0 text-whatsapp-green" />
                  <span className="text-left text-sm text-whatsapp-text">
                    Identidade via MetaMask (ou outra carteira)
                  </span>
                </li>
                <li className="flex items-start gap-3 rounded-xl bg-whatsapp-dark/50 px-4 py-3 transition-colors hover:bg-whatsapp-hover/30">
                  <HiChatBubbleLeftRight className="mt-0.5 h-6 w-6 shrink-0 text-whatsapp-green" />
                  <span className="text-left text-sm text-whatsapp-text">Mensagens em tempo real</span>
                </li>
                <li className="flex items-start gap-3 rounded-xl bg-whatsapp-dark/50 px-4 py-3 transition-colors hover:bg-whatsapp-hover/30">
                  <HiLockClosed className="mt-0.5 h-6 w-6 shrink-0 text-whatsapp-green" />
                  <span className="text-left text-sm text-whatsapp-text">
                    Sem número de telefone necessário
                  </span>
                </li>
              </ul>

              {mobileNoBrowserWallet && wcConfigured && (
                <div
                  className="mt-6 rounded-xl border border-whatsapp-green/35 bg-whatsapp-dark/60 px-4 py-3 text-sm text-whatsapp-text"
                  role="status"
                >
                  <p className="font-medium text-whatsapp-green">No celular</p>
                  <p className="mt-1 text-whatsapp-text-secondary leading-relaxed">
                    <strong className="text-whatsapp-text">Passo 1:</strong> toque em{' '}
                    <strong className="text-whatsapp-text">Conectar carteira</strong> — primeiro conecta no
                    WalletConnect, depois pode pedir uma <strong className="text-whatsapp-text">
                      assinatura rápida
                    </strong>{' '}
                    só para ver se você já tem conta. Depois o nome (se for novo) e a assinatura final para entrar.
                  </p>
                </div>
              )}

              {showMmBrowserFallback && (
                <div
                  className="mt-6 rounded-xl border border-amber-600/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100/90 transition-opacity duration-300"
                  role="alert"
                >
                  <p className="font-medium text-amber-200">
                    {isIOS() ? 'No iPhone/iPad' : 'Neste celular'}, o navegador não injeta a MetaMask.
                  </p>
                  <p className="mt-1 text-amber-100/80">
                    <strong className="text-amber-100">Recomendado (WalletConnect):</strong> no servidor
                    onde você faz o build do cliente, crie{' '}
                    <code className="text-amber-50">client/.env</code> com{' '}
                    <code className="text-amber-50">VITE_WALLETCONNECT_PROJECT_ID</code> obtido em{' '}
                    <a
                      href={REOWN_CLOUD}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-whatsapp-green underline underline-offset-2"
                    >
                      cloud.reown.com
                    </a>
                    . No painel do projeto, adicione o domínio do MetaWhats em{' '}
                    <strong className="text-amber-100">Allowed domains</strong>, execute novamente{' '}
                    <code className="text-amber-50">npm run build</code> e publique o{' '}
                    <code className="text-amber-50">dist</code>. Depois «Conectar carteira» abre o fluxo
                    WalletConnect.
                  </p>
                  <p className="mt-2 text-xs text-amber-100/75">
                    <strong className="text-amber-100">Sem WalletConnect no build:</strong> abra o MetaWhats
                    no navegador integrado da MetaMask (ou use os atalhos abaixo).
                  </p>
                  {httpWarning && (
                    <p className="mt-2 rounded-lg bg-red-950/35 px-2 py-2 text-xs text-red-100/90">
                      Este site está em <strong>http</strong>. No iOS, o navegador da MetaMask costuma
                      exigir <strong>https</strong>.
                    </p>
                  )}
                  <a
                    href={metaMaskUniversalUrl}
                    className="mt-3 flex w-full items-center justify-center rounded-lg bg-whatsapp-cta py-3 text-center text-sm font-semibold text-whatsapp-dark no-underline transition hover:opacity-95"
                  >
                    Abrir no MetaMask (navegador do app)
                  </a>
                  <a
                    href={metaMaskNativeUrl}
                    className="mt-2 flex w-full items-center justify-center rounded-lg border border-amber-500/50 bg-amber-950/40 py-3 text-center text-sm font-semibold text-amber-100 no-underline transition hover:bg-amber-950/55"
                  >
                    Se a tela ficou em branco: conexão direta com o app
                  </a>
                  <button
                    type="button"
                    onClick={copyCanonicalUrl}
                    className="mt-2 w-full rounded-lg border border-whatsapp-border/60 py-2.5 text-center text-xs font-medium text-whatsapp-text-secondary transition hover:bg-whatsapp-hover/30"
                  >
                    {copied ? 'Endereço copiado — cole no navegador da MetaMask' : 'Copiar endereço deste site'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      refreshBrowserWallet();
                    }}
                    className="mt-2 w-full rounded-lg border border-whatsapp-border/60 py-2.5 text-center text-xs font-medium text-whatsapp-text-secondary transition hover:bg-whatsapp-hover/30"
                  >
                    Já estou no navegador da MetaMask — verificar novamente
                  </button>
                  <p className="mt-3 text-xs text-amber-100/70">
                    App MetaMask:{' '}
                    <a
                      href={METAMASK_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-whatsapp-green underline underline-offset-2"
                    >
                      Instalar
                    </a>
                  </p>
                </div>
              )}

              {!browserWallet && !mobileNoBrowserWallet && !wcConfigured && (
                <div
                  className="mt-6 rounded-xl border border-amber-600/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100/90 transition-opacity duration-300"
                  role="alert"
                >
                  <p className="font-medium text-amber-200">Carteira não detectada</p>
                  <p className="mt-1 text-amber-100/80">
                    Instale a extensão MetaMask no Chrome, Edge ou Firefox, ou defina{' '}
                    <code className="text-amber-50">VITE_WALLETCONNECT_PROJECT_ID</code> para conectar por
                    QR / celular (
                    <a
                      href={REOWN_CLOUD}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-whatsapp-green underline underline-offset-2"
                    >
                      cloud.reown.com
                    </a>
                    ).
                  </p>
                </div>
              )}
            </>
          )}

          {loginStep === 2 && linkedAddress && !skippedUsernameStep && (
            <div className="mt-8 space-y-4 text-left">
              <p className="text-sm text-whatsapp-text-secondary">
                <span className="font-medium text-whatsapp-text">Passo 2 · Nome de usuário</span>
                <br />
                Carteira conectada:{' '}
                <span className="font-mono text-xs text-whatsapp-text">{linkedAddress}</span>
              </p>
              <label className="block text-xs font-medium text-whatsapp-text-secondary" htmlFor="oz-nick">
                Como você quer aparecer nas conversas?
              </label>
              <input
                id="oz-nick"
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={64}
                autoComplete="username"
                className="w-full rounded-lg border border-whatsapp-border/60 bg-whatsapp-dark px-3 py-2.5 text-sm text-whatsapp-text outline-none focus:border-whatsapp-green/50"
                placeholder="Ex.: João"
              />
              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleBackFromUsername}
                  className="rounded-lg border border-whatsapp-border px-4 py-2.5 text-sm text-whatsapp-text-secondary hover:bg-whatsapp-hover"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={handleGoToSignStep}
                  className="rounded-lg bg-whatsapp-green px-4 py-2.5 text-sm font-semibold text-whatsapp-on-primary hover:bg-whatsapp-green-hover"
                >
                  Continuar para assinatura
                </button>
              </div>
            </div>
          )}

          {loginStep === 3 && linkedAddress && (
            <div className="mt-8 space-y-4 text-left">
              <p className="text-sm font-medium text-whatsapp-text">Passo 3 · Confirmar com a carteira</p>
              {skippedUsernameStep && linkedLogin?.existingNickname ? (
                <p className="text-sm text-whatsapp-text-secondary">
                  Conta existente:{' '}
                  <strong className="text-whatsapp-text">{linkedLogin.existingNickname}</strong>
                  <span className="mt-1 block font-mono text-xs opacity-90">{linkedAddress}</span>
                </p>
              ) : null}
              <p className="text-sm leading-relaxed text-whatsapp-text-secondary">
                A MetaMask vai pedir uma <strong className="text-whatsapp-text">assinatura</strong> para
                provar que você é dono desta carteira. Não é uma transação e não custa gas.
              </p>
              <p className="rounded-lg bg-whatsapp-dark/60 px-3 py-2 text-xs text-whatsapp-text-secondary">
                Depois pode aparecer <strong className="text-whatsapp-text">mais um pedido</strong> só para
                a criptografia das mensagens.
              </p>
              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    if (skippedUsernameStep) {
                      cancelWalletLinking();
                    } else {
                      setLoginStep(2);
                    }
                  }}
                  className="rounded-lg border border-whatsapp-border px-4 py-2.5 text-sm text-whatsapp-text-secondary hover:bg-whatsapp-hover"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={handleStep3Sign}
                  disabled={signing}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-whatsapp-green px-4 py-2.5 text-sm font-semibold text-whatsapp-on-primary hover:bg-whatsapp-green-hover disabled:opacity-50"
                >
                  {signing ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-whatsapp-on-primary border-t-transparent" />
                      Aguardando assinatura…
                    </>
                  ) : (
                    <>
                      <IoWallet className="h-5 w-5" aria-hidden />
                      Pedir assinatura e entrar
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {error && (
            <p
              className="mt-4 rounded-lg bg-red-950/40 px-3 py-2 text-center text-sm text-red-200/95"
              role="alert"
            >
              {error}
            </p>
          )}

          {loginStep === 1 && (
            <>
              <button
                type="button"
                onClick={handleStep1Connect}
                disabled={connecting || profileResolving || !canConnect}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-whatsapp-green py-3.5 text-base font-semibold text-whatsapp-on-primary shadow-lg shadow-whatsapp-green/25 transition hover:bg-whatsapp-green-hover hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50"
              >
                {connecting ? (
                  <>
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-whatsapp-on-primary border-t-transparent" />
                    Conectando à carteira…
                  </>
                ) : profileResolving ? (
                  <>
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-whatsapp-on-primary border-t-transparent" />
                    Abra a MetaMask e assine (verificação de conta)…
                  </>
                ) : (
                  <>
                    <IoWallet className="h-6 w-6" aria-hidden />
                    Conectar carteira
                  </>
                )}
              </button>
              <p className="mt-4 text-center text-xs leading-relaxed text-whatsapp-text-secondary">
                {wcConfigured && !browserWallet
                  ? 'Fluxo em 3 passos: conectar (WalletConnect) → nome → assinar.'
                  : 'Fluxo em 3 passos: conectar, escolher um nome e assinar para entrar.'}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
