const LS_KEY = 'openzap_footer_reaction_counts_v1';

function readCountsRaw() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

/** Incrementa uso de um emoji (barra «Reagir» do chat). */
export function recordFooterReactionUsage(emoji) {
  if (!emoji || typeof emoji !== 'string') return;
  const counts = readCountsRaw();
  counts[emoji] = (Number(counts[emoji]) || 0) + 1;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(counts));
  } catch {
    /* quota / privado */
  }
}

/**
 * Ordena a lista fixa: mais usados primeiro; empate mantém a ordem original.
 * @param {string[]} defaultPool
 */
export function orderedQuickReactions(defaultPool) {
  if (!defaultPool?.length) return [];
  const counts = readCountsRaw();
  const idx = (e) => defaultPool.indexOf(e);
  return [...defaultPool].sort((a, b) => {
    const ca = Number(counts[a]) || 0;
    const cb = Number(counts[b]) || 0;
    if (cb !== ca) return cb - ca;
    return idx(a) - idx(b);
  });
}
