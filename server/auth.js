import { ethers } from "ethers";
import { createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";
import {
  denylistLoginSignature,
  isLoginSignatureDenylisted,
  pruneOldLoginSignatureDeny,
} from "./db.js";

/** Prefixos legíveis na carteira; aceitar legado MetaWhats para sessões já assinadas. */
const LOGIN_PREFIX_OPENZAP = "OpenZap Login\nNonce:";
const LOGIN_PREFIX_LEGACY_METAWHATS = "MetaWhats Login\nNonce:";

/** Tempo de vida e capacidade dos mapas de nonces (mitigar pressão de memória). */
const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutos
const NONCE_MAX_ENTRIES = 5000;

/** Comprimento máximo aceitável para a mensagem de login assinada. */
const MAX_LOGIN_MESSAGE_LEN = 512;

/** Comprimento máximo de uma assinatura EIP-191 hex (0x + 130). */
const MAX_SIGNATURE_LEN = 256;

const nonces = new Map();
const profileReadNonces = new Map();

function pruneExpired(map, now) {
  for (const [k, v] of map) {
    if (!v || typeof v.expiresAt !== "number" || v.expiresAt <= now) {
      map.delete(k);
    }
  }
}

function enforceCapacity(map) {
  if (map.size <= NONCE_MAX_ENTRIES) return;
  const overflow = map.size - NONCE_MAX_ENTRIES;
  let removed = 0;
  for (const k of map.keys()) {
    if (removed >= overflow) break;
    map.delete(k);
    removed += 1;
  }
}

function setNonce(map, address, nonce) {
  const now = Date.now();
  pruneExpired(map, now);
  map.set(address, { nonce, expiresAt: now + NONCE_TTL_MS });
  enforceCapacity(map);
}

function getActiveNonce(map, address) {
  const entry = map.get(address);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    map.delete(address);
    return null;
  }
  return entry.nonce;
}

setInterval(() => {
  pruneExpired(nonces, Date.now());
  pruneExpired(profileReadNonces, Date.now());
}, NONCE_TTL_MS).unref?.();

export function generateNonce(address) {
  const addr = String(address || "").toLowerCase();
  if (!addr) return null;
  const nonce = uuidv4();
  setNonce(nonces, addr, nonce);
  return nonce;
}

export function verifySignature(address, signature) {
  const addr = String(address || "").toLowerCase();
  const sig = String(signature || "").trim();
  if (!addr || !sig || sig.length > MAX_SIGNATURE_LEN) return false;
  const nonce = getActiveNonce(nonces, addr);
  if (!nonce) return false;

  const candidates = [
    `OpenZap Login\nNonce: ${nonce}`,
    `MetaWhats Login\nNonce: ${nonce}`,
  ];

  for (const message of candidates) {
    try {
      const recovered = ethers.verifyMessage(message, sig).toLowerCase();
      if (recovered === addr) return true;
    } catch {
      /* tentar formato legado */
    }
  }
  return false;
}

export function removeNonce(address) {
  nonces.delete(String(address || "").toLowerCase());
}

/** Normaliza quebras de linha (Windows / proxies) antes de verificar EIP-191. */
export function normalizeLoginMessageText(message) {
  if (typeof message !== "string") return "";
  return message.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function hashLoginSignature(signature) {
  return createHash("sha256").update(String(signature || "").trim()).digest("hex");
}

/**
 * Marca uma assinatura de login específica como inválida (logout).
 * Persistente em SQLite. Cada cliente devolve a sua (msg, sig) ao terminar sessão para
 * impedir reutilização posterior.
 */
export function denyLoginSignature(address, signature) {
  const addr = String(address || "").toLowerCase();
  if (!addr || !signature) return;
  try {
    denylistLoginSignature(addr, hashLoginSignature(signature));
  } catch {
    /* DB indisponível: tokens emitidos já foram revogados em paralelo */
  }
}

let _lastSigDenyPrune = 0;
function maybePruneSigDeny() {
  const now = Date.now();
  if (now - _lastSigDenyPrune < 6 * 60 * 60 * 1000) return;
  _lastSigDenyPrune = now;
  pruneOldLoginSignatureDeny("-30 days");
}

/** Valida assinatura EIP-191 da mensagem exata (usado no WebSocket após o nonce REST já ter sido consumido). */
export function verifyLoginMessage(address, message, signature) {
  if (!message || typeof message !== "string" || !signature) return false;
  if (message.length > MAX_LOGIN_MESSAGE_LEN) return false;
  const sig = String(signature).trim();
  if (!sig || sig.length > MAX_SIGNATURE_LEN) return false;
  const normalized = normalizeLoginMessageText(message);
  if (
    !normalized.startsWith(LOGIN_PREFIX_OPENZAP) &&
    !normalized.startsWith(LOGIN_PREFIX_LEGACY_METAWHATS)
  ) {
    return false;
  }
  const addr = String(address).toLowerCase();
  try {
    const recovered = ethers.verifyMessage(normalized, sig).toLowerCase();
    if (recovered !== addr) return false;
  } catch {
    return false;
  }
  maybePruneSigDeny();
  if (isLoginSignatureDenylisted(addr, hashLoginSignature(sig))) return false;
  return true;
}

export function generateProfileReadNonce(address) {
  const addr = String(address || "").toLowerCase();
  if (!addr) return null;
  const nonce = uuidv4();
  setNonce(profileReadNonces, addr, nonce);
  return nonce;
}

/** Verifica assinatura, consome nonce e confirma que o signer é o dono do endereço. */
export function verifyAndConsumeProfileRead(address, message, signature) {
  const addr = String(address || "").toLowerCase();
  if (!addr) return false;
  if (typeof message !== "string" || message.length > MAX_LOGIN_MESSAGE_LEN) return false;
  const sig = String(signature || "").trim();
  if (!sig || sig.length > MAX_SIGNATURE_LEN) return false;
  const nonce = getActiveNonce(profileReadNonces, addr);
  if (!nonce) return false;
  const normalized = normalizeLoginMessageText(message);
  const expectedOpenZap = `OpenZap Profile Read\nNonce: ${nonce}`;
  const expectedLegacyMetaWhats = `MetaWhats Profile Read\nNonce: ${nonce}`;
  if (normalized !== expectedOpenZap && normalized !== expectedLegacyMetaWhats) return false;
  profileReadNonces.delete(addr);
  try {
    const recovered = ethers.verifyMessage(normalized, sig).toLowerCase();
    return recovered === addr;
  } catch {
    return false;
  }
}
