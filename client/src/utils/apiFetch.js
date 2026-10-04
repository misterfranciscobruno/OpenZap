/** Prefixos openzap_* alinhados com AuthContext (sessões existentes). */
const TOKEN_KEY = 'openzap_api_token';

/** Manter alinhado com AuthContext (credenciais da carteira para /api/auth/token). */
const SS_SIG = 'openzap_auth_signature';
const SS_MSG = 'openzap_auth_message';

function authLocalKey(address) {
  return `openzap_wallet_auth_${(address || '').toLowerCase()}`;
}

function decodeApiTokenSub(token) {
  if (!token || typeof token !== 'string') return '';
  const i = token.lastIndexOf('.');
  if (i <= 0) return '';
  const payloadB64url = token.slice(0, i);
  try {
    const pad = '='.repeat((4 - (payloadB64url.length % 4)) % 4);
    const b64 = payloadB64url.replace(/-/g, '+').replace(/_/g, '/') + pad;
    const json = JSON.parse(atob(b64));
    return String(json.sub || '').toLowerCase();
  } catch {
    return '';
  }
}

async function refreshStoredApiToken() {
  const token = getStoredApiToken();
  if (!token) return false;
  const addr = decodeApiTokenSub(token);
  if (!addr) return false;
  let sig = null;
  let msg = null;
  try {
    sig = sessionStorage.getItem(SS_SIG);
    msg = sessionStorage.getItem(SS_MSG);
    if (!sig || !msg) {
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
    return false;
  }
  if (!sig || !msg) return false;
  let tr;
  try {
    tr = await fetch('/api/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: addr, signature: sig, message: msg }),
    });
  } catch {
    return false;
  }
  if (!tr.ok) {
    // Servidor recusou explicitamente as credenciais (sig revogada, conta bloqueada, etc).
    // Limpa o token expirado e a credencial de carteira para forçar re-autenticação.
    if (tr.status === 401 || tr.status === 403) {
      try {
        setStoredApiToken('');
        localStorage.removeItem(authLocalKey(addr));
        sessionStorage.removeItem(SS_SIG);
        sessionStorage.removeItem(SS_MSG);
      } catch {
        /* ignore */
      }
    }
    return false;
  }
  let tj;
  try {
    tj = await tr.json();
  } catch {
    return false;
  }
  if (!tj?.apiToken) return false;
  setStoredApiToken(tj.apiToken);
  return true;
}

export function getStoredApiToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setStoredApiToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/** fetch com Authorization: Bearer; em 401 renova o JWT com a assinatura guardada e repete o pedido uma vez. */
export async function apiFetch(input, init = {}) {
  const run = async () => {
    const nextInit = { ...init };
    const headers = new Headers(init.headers ?? undefined);
    const t = getStoredApiToken();
    if (t && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${t}`);
    }
    nextInit.headers = headers;
    return fetch(input, nextInit);
  };
  const res = await run();
  if (res.status !== 401) return res;
  if (!getStoredApiToken()) return res;
  const renewed = await refreshStoredApiToken();
  if (!renewed) return res;
  return run();
}
