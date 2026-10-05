import { createHmac, timingSafeEqual } from "crypto";
import {
  getTokenMinIat,
  setTokenMinIat,
  listTokenRevocations,
} from "./db.js";

/** Tempo de vida da sessão REST. Mais curto = janela menor caso uma assinatura/JWT seja roubado. */
const TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24 h

/** Tamanho máximo aceitável de um token HMAC para evitar DoS na verificação. */
const MAX_TOKEN_LENGTH = 4096;

/**
 * Cache em memória das revogações (sincronizado com SQLite).
 * SQLite é a fonte de verdade — sobrevive a reinícios. A cache evita um SELECT por pedido.
 */
const minIatByAddress = new Map();
let cacheLoaded = false;

function ensureCacheLoaded() {
  if (cacheLoaded) return;
  try {
    for (const row of listTokenRevocations()) {
      if (row?.address && Number.isFinite(Number(row.min_iat))) {
        minIatByAddress.set(String(row.address).toLowerCase(), Number(row.min_iat));
      }
    }
  } catch {
    /* DB indisponível: continuamos sem cache pré-carregada */
  }
  cacheLoaded = true;
}

function getMinIatCached(address) {
  ensureCacheLoaded();
  const sub = String(address || "").toLowerCase();
  if (minIatByAddress.has(sub)) return minIatByAddress.get(sub) || 0;
  const v = getTokenMinIat(sub);
  minIatByAddress.set(sub, v);
  return v;
}

function getJwtSecret() {
  const s =
    process.env.OPENZAP_JWT_SECRET?.trim() || process.env.METAWHATS_JWT_SECRET?.trim();
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "OPENZAP_JWT_SECRET (legado: METAWHATS_JWT_SECRET) deve estar definido em produção (mín. 16 caracteres)."
    );
  }
  return "openzap-dev-only-insecure-secret";
}

/**
 * Token de sessão REST (HMAC). Não substitui assinatura de carteira no WebSocket.
 * Payload: { sub: endereço lower, iat, exp: unix segundos }
 */
export function issueApiToken(address) {
  const sub = String(address || "").toLowerCase();
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TOKEN_TTL_SECONDS;
  const payload = Buffer.from(
    JSON.stringify({ sub, iat, exp }),
    "utf8"
  ).toString("base64url");
  const sig = createHmac("sha256", getJwtSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyApiToken(token) {
  if (!token || typeof token !== "string") return null;
  if (token.length > MAX_TOKEN_LENGTH) return null;
  const i = token.lastIndexOf(".");
  if (i <= 0) return null;
  const payloadB64 = token.slice(0, i);
  const sig = token.slice(i + 1);
  if (!payloadB64 || !sig) return null;
  const expected = createHmac("sha256", getJwtSecret()).update(payloadB64).digest("base64url");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload?.sub || typeof payload.sub !== "string") return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) return null;
  if (typeof payload.iat !== "number" || payload.iat > now + 60) return null;
  const sub = payload.sub.toLowerCase();
  const minIat = getMinIatCached(sub);
  if (payload.iat < minIat) return null;
  return { sub, iat: payload.iat, exp: payload.exp };
}

/**
 * Limpa qualquer entrada em cache para o endereço.
 * Usar após apagar a conta (a linha em SQLite também é removida pelo caller).
 */
export function forgetTokenRevocationCacheFor(address) {
  const sub = String(address || "").toLowerCase();
  if (!sub) return;
  minIatByAddress.delete(sub);
}

/** Invalida todos os tokens emitidos até agora para o endereço (logout/global). Persistente. */
export function revokeTokensForAddress(address) {
  const sub = String(address || "").toLowerCase();
  if (!sub) return;
  const newMin = Math.floor(Date.now() / 1000) + 1;
  const prev = getMinIatCached(sub);
  if (newMin <= prev) return;
  minIatByAddress.set(sub, newMin);
  try {
    setTokenMinIat(sub, newMin);
  } catch {
    /* DB indisponível: cache em memória ainda protege a janela atual */
  }
}
