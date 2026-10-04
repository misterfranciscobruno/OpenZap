/**
 * Aceita apenas referências a `/uploads/<nome-seguro>` no host atual.
 *
 * O conteúdo desencriptado é fornecido por outro participante: sem isto, um remetente
 * malicioso poderia injetar uma URL absoluta arbitrária (ex.: `https://evil.example/x`)
 * e o cliente fá-la-ia download/exibição, expondo IP e cookies do destinatário ou
 * permitindo deteção de leitura ("read receipt" externo).
 */
export function isSafeAttachmentUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 1024) return false;
  // Exigir caminho absoluto local começando por /uploads/
  if (!trimmed.startsWith('/uploads/')) return false;
  // Bloquear escape de path / esquemas / autoridade
  if (trimmed.includes('..')) return false;
  if (trimmed.includes('//')) return false;
  if (trimmed.includes('\\')) return false;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return false;
  // Apenas caracteres comuns de filename + opcional querystring/hash
  // Nome do ficheiro: letras/digitos/dash/underscore/ponto (após /uploads/)
  const tail = trimmed.slice('/uploads/'.length);
  if (!tail) return false;
  // Permite querystring/hash mas valida o filename antes deles.
  const fname = tail.split(/[?#]/, 1)[0];
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(fname)) return false;
  return true;
}

/**
 * Metadados no campo de texto desencriptado após assinatura E2E (anexo encriptado no servidor).
 * _e2ef: 1 — ficheiro em /uploads é ciphertext AES-GCM com a mesma chave da mensagem.
 *
 * Filtra `u` para que apenas caminhos seguros locais sejam aceites.
 */
export function parseE2eAttachmentMeta(decryptedContent) {
  if (decryptedContent == null || typeof decryptedContent !== 'string') return null;
  const t = decryptedContent.trim();
  if (!t.startsWith('{')) return null;
  if (t.length > 8 * 1024) return null;
  try {
    const o = JSON.parse(t);
    if (!o || o._e2ef !== 1 || typeof o.u !== 'string') return null;
    if (!isSafeAttachmentUrl(o.u)) return null;
    return o;
  } catch {
    return null;
  }
}

export function detectAttachmentKind(file) {
  const mime = file?.type || '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}
