/**
 * Cofre local: AES-256-GCM com chave derivada de uma assinatura MetaMask/wallet
 * sobre mensagem fixa (separada da derivação E2E).
 * Requer assinatura determinística da mesma mensagem + conta para reabrir após fechar a app.
 */

import { ethers } from 'ethers';

const VAULT_WALLET = 3;
const VAULT_PIN_LEGACY = 2;

const te = new TextEncoder();

/** Não alterar: chaves e ciphertexts guardados dependem disto. */
export const E2E_STORAGE_WRAP_MESSAGE = 'MetaWhats Local Vault Wrap v1';

function b64encode(bytes) {
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin);
}

function b64decode(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function isHexSignatureString(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  return t.startsWith('0x') && t.length > 130 && /^0x[0-9a-fA-F]+$/.test(t);
}

/**
 * Deriva 32 bytes para AES-256 a partir da assinatura de «wrap» + endereço canónico.
 */
export function deriveStorageAesRawKey(address, wrapSignature) {
  const addr = ethers.getAddress(String(address));
  const wr = String(wrapSignature || '').trim();
  const digest = ethers.solidityPackedKeccak256(['string', 'address'], [wr, addr]);
  return ethers.getBytes(digest);
}

async function importAesKey(raw32) {
  return crypto.subtle.importKey('raw', raw32, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * @param {string} raw localStorage value
 * @returns {{ kind: 'wallet_vault', json: object } | { kind: 'pin_vault' } | { kind: 'legacy', signature: string } | { kind: 'unknown' }}
 */
export function classifyE2eLocalStorageValue(raw) {
  if (raw == null || raw === '') return { kind: 'unknown' };
  const t = String(raw).trim();
  if (isHexSignatureString(t)) {
    return { kind: 'legacy', signature: t };
  }
  try {
    const j = JSON.parse(t);
    if (j && Number(j.v) === VAULT_WALLET && j.iv && j.ct) {
      return { kind: 'wallet_vault', json: j };
    }
    if (j && Number(j.v) === VAULT_PIN_LEGACY && j.pbkdf2 && j.iv && j.ct) {
      return { kind: 'pin_vault' };
    }
  } catch {
    /* ignore */
  }
  return { kind: 'unknown' };
}

/**
 * @param {string} address
 * @param {string} derivationSignature assinatura da mensagem E2E
 * @param {string} wrapSignature assinatura de E2E_STORAGE_WRAP_MESSAGE
 * @returns {Promise<string>} JSON para localStorage
 */
export async function sealDerivationWithWrapSig(address, derivationSignature, wrapSignature) {
  const addr = String(address || '').toLowerCase();
  const sig = String(derivationSignature || '').trim();
  if (!addr || !sig || !wrapSignature) throw new Error('e2e_vault_invalid_args');

  const rawKey = deriveStorageAesRawKey(addr, wrapSignature);
  const aesKey = await importAesKey(rawKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = te.encode(`openzap_e2e_v3|${addr}`);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    aesKey,
    te.encode(sig)
  );

  return JSON.stringify({
    v: VAULT_WALLET,
    iv: b64encode(iv),
    ct: b64encode(new Uint8Array(ct)),
  });
}

/**
 * @param {string} address
 * @param {string} vaultJson
 * @param {string} wrapSignature
 * @returns {Promise<string>} derivationSignature
 */
export async function openDerivationWithWrapSig(address, vaultJson, wrapSignature) {
  const addr = String(address || '').toLowerCase();
  if (!addr || !vaultJson || !wrapSignature) throw new Error('e2e_vault_invalid_args');

  const j = JSON.parse(vaultJson);
  if (Number(j.v) !== VAULT_WALLET || !j.iv || !j.ct) {
    throw new Error('e2e_vault_format');
  }

  const rawKey = deriveStorageAesRawKey(addr, wrapSignature);
  const aesKey = await importAesKey(rawKey);
  const iv = b64decode(j.iv);
  const ct = b64decode(j.ct);
  const aad = te.encode(`openzap_e2e_v3|${addr}`);

  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, aesKey, ct);
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error('e2e_vault_bad_wrap_sig');
  }
}
