import { ethers } from 'ethers';

/** Provider EIP-1193 ativo (ex.: sessão WalletConnect no Safari). */
let eip1193Override = null;

/** Fila simples para evitar pedidos `personal_sign` em paralelo (MetaMask mobile / WC: «Invalid Id»). */
let walletRpcQueue = Promise.resolve();

/**
 * Executa `task` depois dos pedidos anteriores à carteira — reduz erros de JSON-RPC por IDs em conflito.
 * @template T
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
export function withWalletRpcQueue(task) {
  const run = () => task();
  const out = walletRpcQueue.then(run, run);
  walletRpcQueue = out.then(
    () => undefined,
    () => undefined
  );
  return out;
}

/**
 * `personal_sign` via EIP-1193 (sem `BrowserProvider.getSigner()`), mais fiável com WalletConnect e MM mobile.
 * @param {import('ethers').Eip1193Provider} eth
 * @param {string} address
 * @param {string} utf8Message
 */
export async function eip1193PersonalSign(eth, address, utf8Message) {
  return withWalletRpcQueue(async () => {
    if (!eth || typeof eth.request !== 'function') {
      throw new Error('Carteira sem método request().');
    }
    const a = ethers.getAddress(String(address).trim());
    const hexMsg = ethers.hexlify(ethers.toUtf8Bytes(utf8Message));
    return eth.request({
      method: 'personal_sign',
      params: [hexMsg, a],
    });
  });
}

export function setEip1193ProviderOverride(provider) {
  eip1193Override = provider || null;
}

export function clearEip1193ProviderOverride() {
  eip1193Override = null;
}

/** Extensão / in-app browser com `window.ethereum` (não inclui WalletConnect). */
export function hasBrowserWalletInjection() {
  if (typeof window === 'undefined') return false;
  return Boolean(window.ethereum);
}

/** `VITE_WALLETCONNECT_PROJECT_ID` definido — WalletConnect (recomendado no Safari iOS / telemóvel sem extensão). */
export function walletConnectProjectIdConfigured() {
  try {
    const v = import.meta.env?.VITE_WALLETCONNECT_PROJECT_ID;
    return typeof v === 'string' && v.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * EIP-1193 provider (WalletConnect em sessão, ou extensão / navegador MetaMask).
 */
export function getEthereumProvider() {
  if (eip1193Override) return eip1193Override;
  if (typeof window === 'undefined') return null;
  const eth = window.ethereum;
  if (!eth) return null;
  if (Array.isArray(eth.providers) && eth.providers.length > 0) {
    const mm = eth.providers.find((p) => p?.isMetaMask);
    return mm || eth;
  }
  return eth;
}

export function hasEthereumProvider() {
  return Boolean(getEthereumProvider());
}

/** iPhone / iPad (inclui iPadOS 13+ com “MacIntel” + touch). */
export function isIOS() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

/** Dispositivos móveis típicos sem extensão de browser — usar navegador integrado MetaMask. */
export function isMobileOrTablet() {
  if (typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent || ''
  );
}

/**
 * URL desta página (sem #hash), normalizado.
 */
export function getCanonicalDappUrl(pageUrl) {
  if (typeof window === 'undefined') {
    return typeof pageUrl === 'string' ? pageUrl.split('#')[0] : '';
  }
  try {
    const u = new URL(pageUrl || window.location.href);
    u.hash = '';
    return u.toString();
  } catch {
    const raw = pageUrl || (typeof window !== 'undefined' ? window.location.href : '');
    return String(raw).split('#')[0];
  }
}

/**
 * Abre o site no browser integrado da MetaMask (`link.metamask.io/dapp/...`).
 * Sem WalletConnect, é o caminho para injetar `window.ethereum` no telemóvel.
 * @see https://docs.metamask.io/metamask-connect/evm/guides/metamask-exclusive/use-deeplinks/
 */
export function getMetaMaskDappUniversalLink(pageUrl) {
  const dapp = getCanonicalDappUrl(pageUrl);
  if (!dapp) return '';
  return `https://link.metamask.io/dapp/${encodeURIComponent(dapp)}`;
}

/**
 * Esquema nativo quando o link universal abre a app mas o browser fica vazio (comum no iOS).
 * HTTPS na raiz: formato tipo app.uniswap.org; caso contrário URL completa codificada (inclui http).
 * @see https://github.com/MetaMask/metamask-mobile/pull/4167
 */
export function getMetaMaskDappNativeFallbackLink(pageUrl) {
  const dapp = getCanonicalDappUrl(pageUrl);
  if (!dapp) return '';
  try {
    const u = new URL(dapp);
    const isRoot = (u.pathname === '/' || u.pathname === '') && !u.search;
    if (u.protocol === 'https:' && isRoot) {
      return `metamask://dapp/${u.host}`;
    }
    return `metamask://dapp/${encodeURIComponent(dapp)}`;
  } catch {
    return '';
  }
}

/** @deprecated Use getMetaMaskDappUniversalLink — mantido para imports existentes. */
export function getMetaMaskDappDeepLink(pageUrl) {
  return getMetaMaskDappUniversalLink(pageUrl);
}

export function isInsecureHttpDapp(pageUrl) {
  try {
    const u = new URL(getCanonicalDappUrl(pageUrl));
    return u.protocol === 'http:' && !/^localhost$/i.test(u.hostname) && u.hostname !== '127.0.0.1';
  } catch {
    return false;
  }
}
