import { ethers } from 'ethers';
import { getEthereumProvider, eip1193PersonalSign } from './ethereumProvider';

/** Não alterar sem migração: chaves e mensagens E2E já derivadas dependem desta string exata. */
export const E2E_DERIVATION_MESSAGE = 'OpenZap E2E Encryption Key v1';

/** Conteúdo interno antes do AES: texto + assinatura ECDSA com a chave E2E (não a carteira). */
const E2E_PAYLOAD_VERSION = 2;

/**
 * Derives a secp256k1 key pair from a MetaMask signature.
 * The user signs a deterministic message, and the keccak256 hash
 * of that signature becomes the private key for ECDH operations.
 */
export function deriveKeyPairFromSignature(signature) {
  const privateKey = ethers.keccak256(ethers.toUtf8Bytes(signature));
  const signingKey = new ethers.SigningKey(privateKey);
  return {
    privateKey,
    publicKey: signingKey.publicKey,
    compressedPublicKey: signingKey.compressedPublicKey,
  };
}

/**
 * Requests the user to sign the E2E derivation message via MetaMask.
 * Returns the derived key pair plus the wallet signature (para reabrir sessão sem novo pedido).
 */
export async function deriveEncryptionKeys() {
  const eth = getEthereumProvider();
  if (!eth) {
    throw new Error('Carteira não disponível. Abra o OpenZap no navegador da MetaMask.');
  }
  let accounts = await eth.request({ method: 'eth_accounts' });
  if (!accounts || accounts.length === 0) {
    accounts = await eth.request({ method: 'eth_requestAccounts' });
  }
  if (!accounts || accounts.length === 0) {
    throw new Error('Nenhuma conta autorizada na carteira.');
  }
  const address = accounts[0];
  const derivationSignature = await eip1193PersonalSign(eth, address, E2E_DERIVATION_MESSAGE);
  return {
    ...deriveKeyPairFromSignature(derivationSignature),
    derivationSignature,
  };
}

/**
 * Embala o texto num JSON assinado com a chave E2E; o resultado é o que vai para AES-GCM.
 */
export function encodeSignedPlaintextPayload(plaintext, e2ePrivateKeyHex) {
  const ts = Date.now();
  const v = E2E_PAYLOAD_VERSION;
  const canonical = JSON.stringify({ v, t: plaintext, ts });
  const digest = ethers.keccak256(ethers.toUtf8Bytes(canonical));
  const signingKey = new ethers.SigningKey(e2ePrivateKeyHex);
  const sig = signingKey.sign(digest);
  return JSON.stringify({ v, t: plaintext, ts, s: sig.serialized });
}

/**
 * Após AES-GCM: verifica assinatura com a chave pública E2E do remetente (servidor).
 * Mensagens antigas sem JSON devolvem { ok, text, legacy }.
 */
export function decodeAndVerifySignedPayload(decryptedUtf8, senderE2EPublicKeyHex) {
  let obj;
  try {
    obj = JSON.parse(decryptedUtf8);
  } catch {
    return { ok: true, text: decryptedUtf8, legacy: true };
  }
  if (
    obj &&
    obj.v === E2E_PAYLOAD_VERSION &&
    typeof obj.t === 'string' &&
    typeof obj.s === 'string'
  ) {
    if (!senderE2EPublicKeyHex) {
      return { ok: false, text: '', legacy: false };
    }
    const canonical = JSON.stringify({ v: obj.v, t: obj.t, ts: obj.ts ?? null });
    const digest = ethers.keccak256(ethers.toUtf8Bytes(canonical));
    let sig;
    try {
      sig = ethers.Signature.from(obj.s);
    } catch {
      return { ok: false, text: '', legacy: false };
    }
    let recovered;
    try {
      recovered = ethers.SigningKey.recoverPublicKey(digest, sig);
    } catch {
      return { ok: false, text: '', legacy: false };
    }
    const expected = ethers.SigningKey.computePublicKey(senderE2EPublicKeyHex, true);
    const got = ethers.SigningKey.computePublicKey(recovered, true);
    if (expected !== got) {
      return { ok: false, text: '', legacy: false };
    }
    return { ok: true, text: obj.t, legacy: false };
  }
  return { ok: true, text: decryptedUtf8, legacy: true };
}

/**
 * Computes a shared AES-256 key from ECDH between our private key
 * and the other party's public key (secp256k1).
 */
export function computeSharedSecret(ourPrivateKey, theirPublicKey) {
  const signingKey = new ethers.SigningKey(ourPrivateKey);
  const raw = signingKey.computeSharedSecret(theirPublicKey);
  return ethers.keccak256(raw);
}

function uint8ToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encrypts plaintext using AES-256-GCM with the given shared secret.
 * Returns a base64 string: 12-byte IV || ciphertext || 16-byte auth tag.
 */
export async function encryptMessage(sharedSecretHex, plaintext) {
  const keyBytes = ethers.getBytes(sharedSecretHex);
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return uint8ToBase64(combined);
}

/**
 * Decrypts a base64-encoded AES-256-GCM ciphertext using the shared secret.
 */
export async function decryptMessage(sharedSecretHex, encryptedBase64) {
  const keyBytes = ethers.getBytes(sharedSecretHex);
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  const combined = base64ToUint8(encryptedBase64);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  return new TextDecoder().decode(decrypted);
}

/**
 * Encripta bytes (ficheiros) com AES-256-GCM. Formato: 12 bytes IV || ciphertext||tag.
 */
export async function encryptBinary(sharedSecretHex, plainBytes) {
  if (!(plainBytes instanceof Uint8Array)) {
    throw new TypeError('plainBytes must be Uint8Array');
  }
  const keyBytes = ethers.getBytes(sharedSecretHex);
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plainBytes);
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return combined;
}

/** Desencripta o formato produzido por encryptBinary. */
export async function decryptBinary(sharedSecretHex, encryptedBytes) {
  if (!(encryptedBytes instanceof Uint8Array)) {
    throw new TypeError('encryptedBytes must be Uint8Array');
  }
  if (encryptedBytes.length < 13) {
    throw new Error('Ciphertext demasiado curto');
  }
  const keyBytes = ethers.getBytes(sharedSecretHex);
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  const iv = encryptedBytes.slice(0, 12);
  const ciphertext = encryptedBytes.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new Uint8Array(decrypted);
}
