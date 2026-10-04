import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import { deriveEncryptionKeys, deriveKeyPairFromSignature } from '../utils/encryption';
import {
  getEthereumProvider,
  setEip1193ProviderOverride,
  clearEip1193ProviderOverride,
  eip1193PersonalSign,
} from '../utils/ethereumProvider';
import { apiFetch, setStoredApiToken } from '../utils/apiFetch';
import {
  classifyE2eLocalStorageValue,
  sealDerivationWithWrapSig,
  openDerivationWithWrapSig,
  E2E_STORAGE_WRAP_MESSAGE,
} from '../utils/e2eLocalVault';
import E2eWalletUnlockGate from '../components/E2eWalletUnlockGate';

const AuthContext = createContext(null);

/** Prefixos openzap_* mantidos para não invalidar sessões e tokens já guardados. */
const SS_SIG = 'openzap_auth_signature';
const SS_MSG = 'openzap_auth_message';
const SS_E2E_SIG = 'openzap_e2e_derivation_sig';
const SS_LOGIN_WIZARD = 'openzap_login_wizard';

function authLocalKey(address) {
  return `openzap_wallet_auth_${(address || '').toLowerCase()}`;
}

/** Cofre local (JSON encriptado) ou legado em hex — mesma chave para migração suave. */
function e2eDerivationLocalKey(address) {
  return `openzap_e2e_derivation_${(address || '').toLowerCase()}`;
}

function readLinkedLoginFromSession() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SS_LOGIN_WIZARD);
    if (!raw) return null;
    const o = JSON.parse(raw);
    const address = typeof o.address === 'string' ? o.address.trim().toLowerCase() : '';
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) return null;
    const en = o.existingNickname;
    const existingNickname =
      en != null && String(en).trim() !== '' ? String(en).trim() : null;
    return { address, existingNickname };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [signature, setSignature] = useState(null);
  const [loginMessage, setLoginMessage] = useState(null);
  const [encryptionKeys, setEncryptionKeys] = useState(null);
  const [loading, setLoading] = useState(true);
  /** Durante o assistente de login: endereço ligado + nickname já na BD (se houver), para saltar o passo do nome. */
  const [linkedLogin, setLinkedLogin] = useState(() => readLinkedLoginFromSession());
  const [e2eWalletUnlockOpen, setE2eWalletUnlockOpen] = useState(false);
  const [e2eWalletUnlockBusy, setE2eWalletUnlockBusy] = useState(false);
  const [e2eWalletUnlockError, setE2eWalletUnlockError] = useState('');
  /** Após tentar ler cofre/sessão E2E (evita faixa «assinar» a piscar antes da hidratação). */
  const [e2eHydrated, setE2eHydrated] = useState(false);
  const wcProviderRef = useRef(null);

  const fetchUser = useCallback(async (address) => {
    const addr = String(address || '').toLowerCase();
    if (!addr) return null;
    const tryGet = async () => {
      const res = await apiFetch(`/api/users/${addr}`);
      if (res.ok) return res.json();
      return { __status: res.status };
    };
    try {
      let data = await tryGet();
      if (data.__status === 401) {
        let sig = null;
        let msg = null;
        try {
          const ssSig = sessionStorage.getItem(SS_SIG);
          const ssMsg = sessionStorage.getItem(SS_MSG);
          if (ssSig && ssMsg) {
            sig = ssSig;
            msg = ssMsg;
          } else {
            const raw = localStorage.getItem(authLocalKey(addr));
            if (raw) {
              const o = JSON.parse(raw);
              if (o?.sig && o?.msg) {
                sig = o.sig;
                msg = o.msg;
              }
            }
          }
        } catch {
          /* ignore */
        }
        if (sig && msg) {
          const tr = await fetch('/api/auth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: addr, signature: sig, message: msg }),
          });
          if (tr.ok) {
            const tj = await tr.json();
            if (tj.apiToken) setStoredApiToken(tj.apiToken);
            data = await tryGet();
          }
        }
      }
      if (data && data.__status >= 500) {
        return { __authNetworkError: true };
      }
      if (data && !data.__status) return data;
    } catch (err) {
      console.error('Erro ao buscar utilizador:', err);
      return { __authNetworkError: true };
    }
    return null;
  }, []);

  const storePublicKey = useCallback(async (address, publicKey) => {
    try {
      await apiFetch(`/api/users/${address}/public-key`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKey }),
      });
    } catch (err) {
      console.error('Erro ao guardar chave pública:', err);
    }
  }, []);

  const clearSessionAuthStorage = useCallback(() => {
    try {
      sessionStorage.removeItem(SS_SIG);
      sessionStorage.removeItem(SS_MSG);
      sessionStorage.removeItem(SS_E2E_SIG);
    } catch { /* ignore */ }
  }, []);

  const hydrateKeysFromSignature = useCallback((addr, derivationSignature) => {
    const s = String(derivationSignature || '').trim();
    if (!s) return;
    try {
      sessionStorage.setItem(SS_E2E_SIG, s);
    } catch {
      /* ignore */
    }
    try {
      setEncryptionKeys(deriveKeyPairFromSignature(s));
    } catch {
      /* ignore */
    }
  }, []);

  const saveWalletCredentials = useCallback((address, sig, msg) => {
    const a = (address || '').toLowerCase();
    if (!a || !sig || !msg) return;
    try {
      sessionStorage.setItem(SS_SIG, sig);
      sessionStorage.setItem(SS_MSG, msg);
      localStorage.setItem(authLocalKey(a), JSON.stringify({ sig, msg, v: 1 }));
    } catch (err) {
      console.warn('MetaWhats: não foi possível guardar credenciais do socket:', err);
    }
  }, []);

  const loadWalletCredentials = useCallback((savedAddress, userAddress) => {
    const addr = (userAddress || savedAddress || '').toLowerCase();
    if (!addr) return { sig: null, msg: null };
    try {
      const ssSig = sessionStorage.getItem(SS_SIG);
      const ssMsg = sessionStorage.getItem(SS_MSG);
      if (ssSig && ssMsg) return { sig: ssSig, msg: ssMsg };
      const raw = localStorage.getItem(authLocalKey(addr));
      if (raw) {
        const o = JSON.parse(raw);
        if (o?.sig && o?.msg) return { sig: o.sig, msg: o.msg };
      }
    } catch { /* ignore */ }
    return { sig: null, msg: null };
  }, []);

  const clearPersistedWalletCredentials = useCallback((address) => {
    const a = (address || '').toLowerCase();
    clearSessionAuthStorage();
    try {
      if (a) localStorage.removeItem(authLocalKey(a));
    } catch { /* ignore */ }
    try {
      if (a) localStorage.removeItem(e2eDerivationLocalKey(a));
    } catch { /* ignore */ }
  }, [clearSessionAuthStorage]);

  /** Credenciais do socket inválidas no servidor — limpa e força novo ecrã de assinatura. */
  const invalidateSocketAuth = useCallback(() => {
    const a = user?.address;
    clearPersistedWalletCredentials(a);
    setStoredApiToken(null);
    setSignature(null);
    setLoginMessage(null);
    setE2eWalletUnlockOpen(false);
    setE2eWalletUnlockError('');
  }, [user?.address, clearPersistedWalletCredentials]);

  useEffect(() => {
    try {
      if (linkedLogin?.address) {
        sessionStorage.setItem(
          SS_LOGIN_WIZARD,
          JSON.stringify({
            address: linkedLogin.address,
            existingNickname: linkedLogin.existingNickname ?? null,
          })
        );
      } else {
        sessionStorage.removeItem(SS_LOGIN_WIZARD);
      }
    } catch {
      /* ignore */
    }
  }, [linkedLogin]);

  useEffect(() => {
    const savedAddress = localStorage.getItem('openzap_address');
    if (!savedAddress) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;

    (async () => {
      try {
        const userData = await fetchUser(savedAddress);
        if (cancelled) return;
        if (userData && userData.__authNetworkError) {
          /* iOS / rede: não apagar sessão por timeout ou falha transitória */
        } else if (userData) {
          setUser(userData);
          const addr = userData.address?.toLowerCase();
          if (addr === savedAddress.toLowerCase()) {
            const { sig, msg } = loadWalletCredentials(savedAddress, userData.address);
            if (sig && msg) {
              setSignature(sig);
              setLoginMessage(msg);
            }
          }
        } else {
          localStorage.removeItem('openzap_address');
          clearPersistedWalletCredentials(savedAddress);
        }
      } catch (e) {
        if (!cancelled) console.error('MetaWhats: falha ao restaurar sessão:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchUser, loadWalletCredentials, clearPersistedWalletCredentials]);

  /**
   * Passo 1 (e reconexão): extensão / browser MetaMask (injeção), ou WalletConnect no telemóvel sem extensão.
   * Não obtém nonce nem assina. Reutiliza sessão WC se já existir.
   */
  const ensureWalletConnected = useCallback(async (expectedAddress) => {
    const hasInjected = typeof window !== 'undefined' && Boolean(window.ethereum);
    let eth = getEthereumProvider();

    if (hasInjected) {
      clearEip1193ProviderOverride();
      if (wcProviderRef.current) {
        try {
          await wcProviderRef.current.disconnect();
        } catch {
          /* ignore */
        }
        wcProviderRef.current = null;
      }
      eth = getEthereumProvider();
    } else {
      const projectId = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '').trim();
      if (!projectId) {
        throw new Error(
          'Defina VITE_WALLETCONNECT_PROJECT_ID no build do cliente (grátis em https://cloud.reown.com) e inclua o domínio do site em «Allowed domains». Sem isso, o Safari no celular não consegue conectar com a MetaMask. Alternativa: abrir o MetaWhats no navegador integrado do app MetaMask.'
        );
      }

      const { default: EthereumProvider } = await import('@walletconnect/ethereum-provider');

      let wc = wcProviderRef.current;
      if (!wc) {
        wc = await EthereumProvider.init({
          projectId,
          chains: [1],
          optionalChains: [137, 42161, 8453, 56, 10],
          showQrModal: true,
          qrModalOptions: {
            themeMode: 'dark',
            themeVariables: {
              // Modal WC usa z-index ~89 por defeito; ficava atrás de overlays da app no iOS.
              '--wcm-z-index': '2147483646',
            },
          },
          metadata: {
            name: 'MetaWhats',
            description: 'Mensagens descentralizadas',
            url: window.location.origin,
            icons: [`${window.location.origin}/favicon.ico`],
          },
        });
        wc.on('disconnect', () => {
          clearEip1193ProviderOverride();
          wcProviderRef.current = null;
        });
        wcProviderRef.current = wc;
        setEip1193ProviderOverride(wc);
      }

      try {
        await wc.enable();
      } catch (e) {
        const m = String(e?.message ?? e ?? '');
        if (
          /origin not allowed/i.test(m) ||
          /Unauthorized.*origin/i.test(m) ||
          /\b3000\b/.test(m)
        ) {
          const origin = typeof window !== 'undefined' ? window.location.origin : '';
          throw new Error(
            `OZ_WC_ORIGIN: O URL «${origin}» não está permitido no Reown. Em cloud.reown.com → projeto → Domain (Allowed origins), adicione esse endereço completo, incluindo a porta se existir (ex.: https://zap.bix.ltda:5174). Guarde, aguarde ~1 min e tente de novo.`
          );
        }
        throw e;
      }
      eth = wc;
    }

    if (!eth) {
      throw new Error('Não foi possível obter uma carteira.');
    }

    const provider = new ethers.BrowserProvider(eth);
    let accounts = await provider.send('eth_accounts', []);
    if (!accounts || accounts.length === 0) {
      accounts = await provider.send('eth_requestAccounts', []);
    }
    if (!accounts || accounts.length === 0) {
      throw new Error('Nenhuma conta autorizada.');
    }
    const address = accounts[0].toLowerCase();

    if (expectedAddress) {
      const exp = String(expectedAddress).toLowerCase();
      if (address !== exp) {
        throw new Error(
          'Use a mesma carteira desta conta. Desconecte na MetaMask e conecte novamente se tiver escolhido outra conta.'
        );
      }
    }

    return { provider, address };
  }, []);

  /** Sessão + cofre local encriptado com assinatura da mensagem E2E_STORAGE_WRAP_MESSAGE. */
  const finalizeE2eAfterDerive = useCallback(
    async (address, derivationSignature) => {
      const a = String(address || '').toLowerCase();
      const sig = String(derivationSignature || '').trim();
      if (!a || !sig) return;
      hydrateKeysFromSignature(a, sig);
      try {
        await ensureWalletConnected(a);
        const eth = getEthereumProvider();
        if (!eth) return;
        const wrapSig = await eip1193PersonalSign(eth, a, E2E_STORAGE_WRAP_MESSAGE);
        const json = await sealDerivationWithWrapSig(a, sig, wrapSig);
        localStorage.setItem(e2eDerivationLocalKey(a), json);
      } catch (err) {
        console.warn('MetaWhats: cofre local não guardado (assinatura cancelada ou erro):', err);
      }
    },
    [hydrateKeysFromSignature, ensureWalletConnected]
  );

  const handleE2eWalletUnlock = useCallback(async () => {
    const addr = String(user?.address || '').toLowerCase();
    if (!addr) return;
    setE2eWalletUnlockBusy(true);
    setE2eWalletUnlockError('');
    try {
      let raw = null;
      try {
        raw = localStorage.getItem(e2eDerivationLocalKey(addr));
      } catch {
        raw = null;
      }
      if (!raw) {
        setE2eWalletUnlockError('Cofre local em falta.');
        return;
      }
      await ensureWalletConnected(addr);
      const eth = getEthereumProvider();
      if (!eth) {
        setE2eWalletUnlockError('Carteira não disponível.');
        return;
      }
      const wrapSig = await eip1193PersonalSign(eth, addr, E2E_STORAGE_WRAP_MESSAGE);
      const dec = await openDerivationWithWrapSig(addr, raw, wrapSig);
      hydrateKeysFromSignature(addr, dec);
      setE2eWalletUnlockOpen(false);
    } catch (e) {
      const m = String(e?.message || e || '');
      if (m.includes('e2e_vault_bad_wrap_sig')) {
        setE2eWalletUnlockError('A assinatura não corresponde ao cofre. Use a mesma carteira.');
      } else if (/user rejected|denied|cancel/i.test(m)) {
        setE2eWalletUnlockError('Assinatura cancelada.');
      } else {
        setE2eWalletUnlockError(m.length > 160 ? `${m.slice(0, 160)}…` : m);
      }
    } finally {
      setE2eWalletUnlockBusy(false);
    }
  }, [user?.address, ensureWalletConnected, hydrateKeysFromSignature]);

  /**
   * Reconstroi E2E: sessão (SS_E2E_SIG), cofre com assinatura «wrap», legado em claro, ou nada.
   * Dados inválidos no localStorage são removidos para poder voltar a derivar com a MetaMask.
   */
  useEffect(() => {
    if (!user?.address) {
      setE2eHydrated(false);
      return;
    }

    if (encryptionKeys) {
      setE2eHydrated(true);
      return;
    }

    if (e2eWalletUnlockOpen) {
      setE2eHydrated(true);
      return;
    }

    const addr = String(user.address).toLowerCase();

    try {
      const ss = sessionStorage.getItem(SS_E2E_SIG);
      if (ss) {
        setEncryptionKeys(deriveKeyPairFromSignature(ss));
        setE2eHydrated(true);
        return;
      }
    } catch {
      /* ignore */
    }

    let raw = null;
    try {
      raw = localStorage.getItem(e2eDerivationLocalKey(addr));
    } catch {
      raw = null;
    }
    if (raw == null || raw === '') {
      setE2eHydrated(true);
      return;
    }

    const cls = classifyE2eLocalStorageValue(raw);
    if (cls.kind === 'pin_vault') {
      try {
        localStorage.removeItem(e2eDerivationLocalKey(addr));
      } catch {
        /* ignore */
      }
      setE2eHydrated(true);
      return;
    }
    if (cls.kind === 'wallet_vault') {
      setE2eWalletUnlockOpen(true);
      setE2eHydrated(true);
      return;
    }
    if (cls.kind === 'legacy') {
      hydrateKeysFromSignature(addr, cls.signature);
      void finalizeE2eAfterDerive(addr, cls.signature);
      setE2eHydrated(true);
      return;
    }
    try {
      localStorage.removeItem(e2eDerivationLocalKey(addr));
    } catch {
      /* ignore */
    }
    setE2eHydrated(true);
  }, [user?.address, encryptionKeys, e2eWalletUnlockOpen, hydrateKeysFromSignature, finalizeE2eAfterDerive]);

  /** Passo final: nonce + assinatura de login + verify; opcionalmente nickname. Depois chaves E2E. */
  const signVerifyAndSetupSession = useCallback(
    async (address, nicknameOrNull) => {
      const addr = String(address || '').toLowerCase();
      if (!addr.startsWith('0x') || addr.length !== 42) {
        throw new Error('Endereço de carteira inválido.');
      }
      /* iOS Safari: ao voltar da MetaWallet o override WC em memória pode estar vazio; ensureWalletConnected reabre sessão persistida. */
      await ensureWalletConnected(addr);
      const eth = getEthereumProvider();
      if (!eth) {
        throw new Error('Carteira não disponível. Volte ao primeiro passo e conecte novamente.');
      }

      const nonceRes = await fetch(`/api/auth/nonce/${encodeURIComponent(addr)}`);
      if (!nonceRes.ok) throw new Error('Erro ao obter nonce');
      const { nonce } = await nonceRes.json();

      const message = `MetaWhats Login\nNonce: ${nonce}`;
      const sig = await eip1193PersonalSign(eth, addr, message);

      const body = { address: addr, signature: sig };
      if (nicknameOrNull != null && String(nicknameOrNull).trim() !== '') {
        body.nickname = String(nicknameOrNull).trim();
      }

      const verifyRes = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!verifyRes.ok) throw new Error('Erro na verificação da assinatura');
      const userData = await verifyRes.json();
      if (userData.apiToken) setStoredApiToken(userData.apiToken);

      localStorage.setItem('openzap_address', addr);
      saveWalletCredentials(addr, sig, message);
      setSignature(sig);
      setLoginMessage(message);
      setUser(userData.user || userData);

      try {
        const keyMaterial = await deriveEncryptionKeys();
        const { derivationSignature, ...keysOnly } = keyMaterial;
        await finalizeE2eAfterDerive(addr, derivationSignature);
        await storePublicKey(addr, keysOnly.publicKey);
      } catch (err) {
        console.error('Aviso: não foi possível derivar chaves E2E:', err);
      }
    },
    [ensureWalletConnected, storePublicKey, saveWalletCredentials, finalizeE2eAfterDerive]
  );

  const fetchUserProfileWithWalletSignature = useCallback(async (address) => {
    const addr = String(address).toLowerCase();
    if (!addr.startsWith('0x') || addr.length !== 42) return null;
    try {
      await ensureWalletConnected(addr);
    } catch {
      return null;
    }
    const eth = getEthereumProvider();
    if (!eth) return null;
    const nr = await fetch(`/api/auth/profile-read-nonce/${addr}`);
    if (!nr.ok) {
      return null;
    }
    const { nonce } = await nr.json();
    const message = `MetaWhats Profile Read\nNonce: ${nonce}`;
    const signature = await eip1193PersonalSign(eth, addr, message);
    const res = await fetch('/api/users/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: addr, message, signature }),
    });
    if (!res.ok) {
      return null;
    }
    return res.json();
  }, [ensureWalletConnected]);

  /** Só ligação WC / extensão — termina quando a sessão tem conta (útil para desbloquear o UI antes da 2.ª assinatura). */
  const connectWalletOnly = useCallback(async () => {
    const { address } = await ensureWalletConnected(null);
    return address;
  }, [ensureWalletConnected]);

  /** Depois de ligado: pede uma assinatura para ler nickname existente (ou ignora se cancelar). */
  const completeLoginProfileRead = useCallback(
    async (address) => {
      let existingNickname = null;
      try {
        const profile = await fetchUserProfileWithWalletSignature(address);
        if (profile?.nickname != null) {
          const n = String(profile.nickname).trim();
          if (n.length > 0) existingNickname = n;
        }
      } catch {
        /* ignore */
      }
      setLinkedLogin({ address, existingNickname });
    },
    [fetchUserProfileWithWalletSignature]
  );

  const completeLoginWithSignature = useCallback(
    async (nickname) => {
      if (!linkedLogin?.address) {
        throw new Error('Conecte primeiro a carteira (passo 1).');
      }
      const { address, existingNickname } = linkedLogin;
      if (existingNickname) {
        await signVerifyAndSetupSession(address, null);
      } else {
        const nick = typeof nickname === 'string' ? nickname.trim() : '';
        if (nick.length < 2) {
          throw new Error('Informe um nome de usuário com pelo menos 2 caracteres.');
        }
        await signVerifyAndSetupSession(address, nick);
      }
      setLinkedLogin(null);
    },
    [linkedLogin, signVerifyAndSetupSession]
  );

  const cancelWalletLinking = useCallback(() => {
    setLinkedLogin(null);
  }, []);

  /** Reconexão (já existe utilizador em memória, falta assinatura no socket). */
  const reconnectSession = useCallback(async () => {
    const expected = user?.address;
    if (!expected) {
      throw new Error('Sessão inválida.');
    }
    await ensureWalletConnected(expected);
    await signVerifyAndSetupSession(String(expected).toLowerCase(), null);
  }, [user?.address, ensureWalletConnected, signVerifyAndSetupSession]);

  const initEncryption = useCallback(async () => {
    if (encryptionKeys || !user) {
      return { ok: false, error: 'already' };
    }
    try {
      await ensureWalletConnected(String(user.address).toLowerCase());
      const keyMaterial = await deriveEncryptionKeys();
      const { derivationSignature, ...keysOnly } = keyMaterial;
      await finalizeE2eAfterDerive(String(user.address).toLowerCase(), derivationSignature);
      await storePublicKey(user.address, keysOnly.publicKey);
      return { ok: true };
    } catch (err) {
      console.error('Erro ao inicializar encriptação:', err);
      const m = String(err?.message || err || 'Erro desconhecido');
      return { ok: false, error: m };
    }
  }, [encryptionKeys, user, storePublicKey, ensureWalletConnected, finalizeE2eAfterDerive]);

  const updateProfile = useCallback(async (data) => {
    if (!user) return;

    const res = await apiFetch(`/api/users/${user.address}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) throw new Error('Erro ao atualizar perfil');
    const updated = await res.json();
    setUser(updated);
    return updated;
  }, [user]);

  /**
   * Limpa todo o estado e armazenamento ligado a uma conta.
   * Partilhado entre `disconnect` e `deleteAccount` para garantir que ambos
   * deixam o cliente num estado idêntico (próximo login = conta nova/limpa).
   */
  const wipeLocalSessionFor = useCallback(
    async (address) => {
      const a = (address || '').toLowerCase();

      setUser(null);
      setSignature(null);
      setLoginMessage(null);
      setEncryptionKeys(null);
      setE2eWalletUnlockOpen(false);
      setE2eWalletUnlockBusy(false);
      setE2eWalletUnlockError('');
      setLinkedLogin(null);
      setStoredApiToken(null);

      try {
        localStorage.removeItem('openzap_address');
      } catch {
        /* ignore */
      }
      clearPersistedWalletCredentials(a);

      clearEip1193ProviderOverride();
      const wc = wcProviderRef.current;
      wcProviderRef.current = null;
      if (wc) {
        try {
          await wc.disconnect();
        } catch {
          /* ignore */
        }
      }
    },
    [clearPersistedWalletCredentials]
  );

  /**
   * Apaga a conta no servidor (perfil, conversas privadas, mensagens, ficheiros, contactos)
   * e em seguida limpa toda a sessão local. Se voltar a entrar com a mesma carteira,
   * é criado um perfil novo e vazio.
   */
  const deleteAccount = useCallback(async () => {
    const a = user?.address;
    if (!a) {
      throw new Error('Sem sessão ativa.');
    }

    let res;
    try {
      res = await apiFetch('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE' }),
      });
    } catch {
      throw new Error('Não foi possível conectar ao servidor. Verifique sua ligação e tente de novo.');
    }

    if (!res.ok) {
      let detail = '';
      try {
        const j = await res.json();
        detail = j?.error ? ` (${j.error})` : '';
      } catch {
        /* ignore */
      }
      throw new Error(`Não foi possível excluir a conta${detail}.`);
    }

    /* Após apagar, qualquer chave guardada com o endereço apagado deixa de fazer sentido. */
    try {
      const aLow = (a || '').toLowerCase();
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.toLowerCase().includes(aLow)) toRemove.push(k);
      }
      for (const k of toRemove) localStorage.removeItem(k);
    } catch {
      /* ignore */
    }

    try {
      sessionStorage.clear();
    } catch {
      /* ignore */
    }

    await wipeLocalSessionFor(a);
  }, [user?.address, wipeLocalSessionFor]);

  const disconnect = useCallback(async () => {
    const a = user?.address;
    const sigSnapshot = signature;
    const msgSnapshot = loginMessage;

    // Best-effort: revogar tokens no servidor + denylist da assinatura específica.
    try {
      await apiFetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          sigSnapshot && msgSnapshot
            ? { message: msgSnapshot, signature: sigSnapshot }
            : {}
        ),
      });
    } catch {
      /* logout local procede mesmo offline */
    }

    setUser(null);
    setSignature(null);
    setLoginMessage(null);
    setEncryptionKeys(null);
    setE2eWalletUnlockOpen(false);
    setE2eWalletUnlockBusy(false);
    setE2eWalletUnlockError('');
    setLinkedLogin(null);
    setStoredApiToken(null);
    localStorage.removeItem('openzap_address');
    clearPersistedWalletCredentials(a);
    clearEip1193ProviderOverride();
    const wc = wcProviderRef.current;
    wcProviderRef.current = null;
    if (wc) {
      try {
        await wc.disconnect();
      } catch {
        /* ignore */
      }
    }
  }, [user?.address, signature, loginMessage, clearPersistedWalletCredentials]);

  const needsE2eDerivation = Boolean(
    user && e2eHydrated && !encryptionKeys && !e2eWalletUnlockOpen
  );

  return (
    <AuthContext.Provider value={{
      user,
      signature,
      loginMessage,
      encryptionKeys,
      loading,
      linkedLogin,
      connectWalletOnly,
      completeLoginProfileRead,
      completeLoginWithSignature,
      cancelWalletLinking,
      reconnectSession,
      initEncryption,
      needsE2eDerivation,
      updateProfile,
      disconnect,
      deleteAccount,
      invalidateSocketAuth,
    }}>
      {children}
      {e2eWalletUnlockOpen ? (
        <E2eWalletUnlockGate
          error={e2eWalletUnlockError}
          busy={e2eWalletUnlockBusy}
          onSign={handleE2eWalletUnlock}
        />
      ) : null}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  }
  return context;
}
