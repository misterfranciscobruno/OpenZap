/**
 * Pesquisa na conversa: ignora maiúsculas e acentos; várias palavras = todas têm de aparecer (qualquer ordem).
 */

export function foldString(s) {
  return String(s)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

function searchTokens(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  return q.split(/\s+/).filter((t) => t.length > 0).map(foldString);
}

/** Texto agregado da mensagem para filtrar (conteúdo + remetente + nome de ficheiro). */
export function messageSearchHaystack(message) {
  if (!message) return '';
  const type = message.type ?? 'text';
  const parts = [];
  if (type === 'text') parts.push(message.content ?? '');
  if (type === 'payment') {
    parts.push(message.content ?? '');
    parts.push('pagamento');
  }
  if (message.file_name) parts.push(String(message.file_name));
  const sender = message.sender ?? message.sender_address ?? '';
  parts.push(sender);
  return parts.join('\n');
}

export function smartMessageMatches(message, query) {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return true;
  const hay = foldString(messageSearchHaystack(message));
  return tokens.every((t) => hay.includes(t));
}

/** Comprimento do prefixo fold(text[0..strEnd)) em índices de string UTF-16. */
function buildFoldPrefixLenByStringIndex(text) {
  const n = text.length;
  const pref = new Array(n + 1);
  pref[0] = 0;
  for (let i = 0; i < n; i++) {
    pref[i + 1] = foldString(text.slice(0, i + 1)).length;
  }
  return pref;
}

/** Primeiro índice de carácter em `text` cuja posição fold >= `foldPos`. */
function origIndexForFoldStart(text, pref, foldPos) {
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pref[mid] < foldPos) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Primeiro índice em `text` onde o prefixo fold tem comprimento > foldEnd (fim exclusivo). */
function origIndexForFoldEnd(text, pref, foldEnd) {
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pref[mid] <= foldEnd) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function mergeRanges(ranges) {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const [s, e] = sorted[i];
    const last = out[out.length - 1];
    if (s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/**
 * Intervalos [start, end) em índices UTF-16 de `text` a realçar para `query` (tokens em OU).
 */
export function getHighlightRangesForText(text, query) {
  const tokens = searchTokens(query);
  if (!tokens.length || !text) return [];
  const folded = foldString(text);
  const pref = buildFoldPrefixLenByStringIndex(text);
  const ranges = [];

  for (const token of tokens) {
    if (!token) continue;
    let pos = 0;
    while (pos < folded.length) {
      const i = folded.indexOf(token, pos);
      if (i === -1) break;
      const a = origIndexForFoldStart(text, pref, i);
      const b = origIndexForFoldEnd(text, pref, i + token.length);
      ranges.push([a, b]);
      pos = i + 1;
    }
  }

  return mergeRanges(ranges);
}
