/** Prefixo openzap_ mantido para não perder conversas arquivadas já guardadas. */
const key = (userAddress) => `openzap_archived_${(userAddress || '').toLowerCase()}`;

export function loadArchivedConversationIds(userAddress) {
  if (!userAddress) return new Set();
  try {
    const raw = localStorage.getItem(key(userAddress));
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter(Boolean).map(String) : []);
  } catch {
    return new Set();
  }
}

export function saveArchivedConversationIds(userAddress, idSet) {
  if (!userAddress) return;
  localStorage.setItem(key(userAddress), JSON.stringify([...idSet]));
}

export function removeArchivedId(userAddress, conversationId) {
  if (!userAddress || !conversationId) return;
  const s = loadArchivedConversationIds(userAddress);
  s.delete(String(conversationId));
  saveArchivedConversationIds(userAddress, s);
}
