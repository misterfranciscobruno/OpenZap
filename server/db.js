import Database from "better-sqlite3";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, "openzap.db"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    address       TEXT PRIMARY KEY,
    nickname      TEXT,
    avatar        TEXT,
    bio           TEXT,
    public_key    TEXT,
    created_at    TEXT DEFAULT (datetime('now')),
    last_seen     TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_address   TEXT NOT NULL,
    contact_address TEXT NOT NULL,
    UNIQUE(owner_address, contact_address)
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL CHECK(type IN ('private','group')),
    name        TEXT,
    avatar      TEXT,
    created_by  TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id TEXT NOT NULL,
    member_address  TEXT NOT NULL,
    joined_at       TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (conversation_id, member_address)
  );
`);

// Migration: expand message types + add encrypted column
const msgSchema = db.prepare(
  "SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'"
).get();

if (!msgSchema) {
  db.exec(`
    CREATE TABLE messages (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_address  TEXT NOT NULL,
      content         TEXT,
      type            TEXT NOT NULL DEFAULT 'text',
      status          TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','delivered','read')),
      created_at      TEXT DEFAULT (datetime('now')),
      reply_to        TEXT,
      encrypted       INTEGER DEFAULT 0,
      file_name       TEXT,
      file_size       INTEGER
    );
  `);
} else if (!msgSchema.sql.includes("encrypted")) {
  try {
    db.exec(`
      CREATE TABLE messages_new (
        id              TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        sender_address  TEXT NOT NULL,
        content         TEXT,
        type            TEXT NOT NULL DEFAULT 'text',
        status          TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','delivered','read')),
        created_at      TEXT DEFAULT (datetime('now')),
        reply_to        TEXT,
        encrypted       INTEGER DEFAULT 0,
        file_name       TEXT,
        file_size       INTEGER
      );
      INSERT INTO messages_new (id, conversation_id, sender_address, content, type, status, created_at, reply_to)
        SELECT id, conversation_id, sender_address, content, type, status, created_at, reply_to FROM messages;
      DROP TABLE messages;
      ALTER TABLE messages_new RENAME TO messages;
    `);
  } catch {
    /* migration already done or not needed */
  }
}

// Migration: add public_key to users if missing
try {
  db.exec(`ALTER TABLE users ADD COLUMN public_key TEXT`);
} catch {
  /* column already exists */
}

try {
  db.exec(`ALTER TABLE contacts ADD COLUMN apelido TEXT`);
} catch {
  /* column already exists */
}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_dek_wraps (
      conversation_id     TEXT NOT NULL,
      member_address      TEXT NOT NULL,
      wrapped_by_address  TEXT NOT NULL,
      payload             TEXT NOT NULL,
      PRIMARY KEY (conversation_id, member_address)
    );
  `);
} catch {
  /* ignore */
}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL,
      user_address TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_message_reactions_msg ON message_reactions(message_id);
  `);
} catch {
  /* ignore */
}

try {
  db.exec(`ALTER TABLE conversation_members ADD COLUMN role TEXT NOT NULL DEFAULT 'member'`);
} catch {
  /* column already exists */
}

try {
  db.exec(`
    UPDATE conversation_members SET role = 'admin'
    WHERE EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_members.conversation_id
        AND c.type = 'group'
        AND LOWER(c.created_by) = LOWER(conversation_members.member_address)
    )
  `);
} catch {
  /* ignore */
}

try {
  db.exec(
    `ALTER TABLE conversations ADD COLUMN group_only_admins_post INTEGER NOT NULL DEFAULT 0`
  );
} catch {
  /* column already exists */
}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_token_revocations (
      address  TEXT PRIMARY KEY,
      min_iat  INTEGER NOT NULL
    );
  `);
} catch {
  /* ignore */
}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_login_signature_denylist (
      address     TEXT NOT NULL,
      sig_hash    TEXT NOT NULL,
      created_at  TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (address, sig_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_auth_login_sig_addr
      ON auth_login_signature_denylist(address);
  `);
} catch {
  /* ignore */
}


function normalizeReactionEmoji(raw) {
  if (raw == null || typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  return t.length > 32 ? t.slice(0, 32) : t;
}

function reactionsForMessageIds(messageIds) {
  const ids = [...new Set((messageIds || []).filter(Boolean))];
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id, message_id, user_address, emoji, created_at FROM message_reactions WHERE message_id IN (${placeholders}) ORDER BY id ASC`
    )
    .all(...ids);
  const map = new Map();
  for (const id of ids) map.set(id, []);
  for (const r of rows) {
    const list = map.get(r.message_id);
    if (list) {
      list.push({
        id: r.id,
        message_id: r.message_id,
        user_address: r.user_address,
        emoji: r.emoji,
        created_at: r.created_at,
      });
    }
  }
  return map;
}

// ── Prepared statements ─────────────────────────────────────────────

const stmts = {
  upsertUser: db.prepare(`
    INSERT INTO users (address, nickname, avatar, bio, public_key)
    VALUES (@address, @nickname, @avatar, @bio, @publicKey)
    ON CONFLICT(address) DO UPDATE SET
      nickname   = COALESCE(@nickname,  users.nickname),
      avatar     = COALESCE(@avatar,    users.avatar),
      bio        = COALESCE(@bio,       users.bio),
      public_key = COALESCE(@publicKey, users.public_key),
      last_seen  = datetime('now')
  `),

  getUser: db.prepare("SELECT * FROM users WHERE address = ?"),

  upsertContact: db.prepare(`
    INSERT INTO contacts (owner_address, contact_address, apelido)
    VALUES (?, ?, ?)
    ON CONFLICT(owner_address, contact_address) DO UPDATE SET
      apelido = excluded.apelido
  `),

  removeContact: db.prepare(
    "DELETE FROM contacts WHERE owner_address = ? AND contact_address = ?"
  ),

  getContacts: db.prepare(`
    SELECT
      u.address,
      u.nickname,
      u.avatar,
      u.bio,
      u.created_at,
      u.last_seen,
      u.public_key,
      c.apelido AS contact_apelido
    FROM contacts c
    JOIN users u ON u.address = c.contact_address
    WHERE c.owner_address = ?
    ORDER BY COALESCE(c.apelido, u.nickname, u.address)
  `),

  getContactApelido: db.prepare(`
    SELECT apelido FROM contacts
    WHERE owner_address = ? AND contact_address = ?
  `),

  getConversationMembersForViewer: db.prepare(`
    SELECT
      u.address,
      u.nickname,
      u.avatar,
      u.bio,
      u.created_at,
      u.last_seen,
      u.public_key,
      c.apelido AS contact_apelido,
      cm.role AS member_role
    FROM conversation_members cm
    JOIN users u ON u.address = cm.member_address
    LEFT JOIN contacts c
      ON c.contact_address = u.address AND c.owner_address = @viewer
    WHERE cm.conversation_id = @conversationId
  `),

  createConversation: db.prepare(`
    INSERT INTO conversations (id, type, name, created_by)
    VALUES (@id, @type, @name, @createdBy)
  `),

  getConversation: db.prepare("SELECT * FROM conversations WHERE id = ?"),

  deleteConversation: db.prepare("DELETE FROM conversations WHERE id = ?"),

  countConversationMembers: db.prepare(
    "SELECT COUNT(*) AS n FROM conversation_members WHERE conversation_id = ?"
  ),

  getUserConversations: db.prepare(`
    SELECT
      c.*,
      cm.role AS my_member_role,
      CASE WHEN COALESCE(m.encrypted, 0) = 1 THEN '🔒 Mensagem protegida' ELSE m.content END AS last_message_content,
      m.type      AS last_message_type,
      m.sender_address AS last_message_sender,
      m.created_at     AS last_message_at,
      (
        SELECT cm2.member_address FROM conversation_members cm2
        WHERE cm2.conversation_id = c.id
          AND c.type = 'private'
          AND LOWER(cm2.member_address) != LOWER(@address)
        LIMIT 1
      ) AS peer_address,
      (
        SELECT u.nickname FROM conversation_members cm2
        JOIN users u ON u.address = cm2.member_address
        WHERE cm2.conversation_id = c.id
          AND c.type = 'private'
          AND LOWER(cm2.member_address) != LOWER(@address)
        LIMIT 1
      ) AS peer_nickname,
      (
        SELECT u.avatar FROM conversation_members cm2
        JOIN users u ON u.address = cm2.member_address
        WHERE cm2.conversation_id = c.id
          AND c.type = 'private'
          AND LOWER(cm2.member_address) != LOWER(@address)
        LIMIT 1
      ) AS peer_avatar,
      (
        SELECT COUNT(*) FROM messages
        WHERE conversation_id = c.id
          AND status != 'read'
          AND sender_address != @address
      ) AS unread_count
    FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id
    LEFT JOIN messages m ON m.id = (
      SELECT id FROM messages
      WHERE conversation_id = c.id
      ORDER BY created_at DESC
      LIMIT 1
    )
    WHERE cm.member_address = @address
    ORDER BY COALESCE(m.created_at, c.created_at) DESC
  `),

  privatePeerPreview: db.prepare(`
    SELECT cm.member_address AS address, u.nickname, u.avatar
    FROM conversation_members cm
    JOIN users u ON u.address = cm.member_address
    WHERE cm.conversation_id = ?
      AND LOWER(cm.member_address) != LOWER(?)
    LIMIT 1
  `),

  addMember: db.prepare(
    `INSERT OR IGNORE INTO conversation_members (conversation_id, member_address, role) VALUES (?, ?, ?)`
  ),

  removeMember: db.prepare(
    "DELETE FROM conversation_members WHERE conversation_id = ? AND member_address = ?"
  ),

  getConversationMembers: db.prepare(`
    SELECT u.*, cm.role AS member_role FROM conversation_members cm
    JOIN users u ON u.address = cm.member_address
    WHERE cm.conversation_id = ?
  `),

  setMemberRole: db.prepare(
    `UPDATE conversation_members SET role = ? WHERE conversation_id = ? AND member_address = ?`
  ),

  updateGroupOnlyAdminsPost: db.prepare(
    `UPDATE conversations SET group_only_admins_post = ? WHERE id = ? AND type = 'group'`
  ),

  countGroupAdmins: db.prepare(
    `SELECT COUNT(*) AS n FROM conversation_members WHERE conversation_id = ? AND role = 'admin'`
  ),

  memberRoleRow: db.prepare(
    `SELECT role FROM conversation_members WHERE conversation_id = ? AND member_address = ?`
  ),

  createMessage: db.prepare(`
    INSERT INTO messages (id, conversation_id, sender_address, content, type, reply_to, encrypted, file_name, file_size)
    VALUES (@id, @conversationId, @senderAddress, @content, @type, @replyTo, @encrypted, @fileName, @fileSize)
  `),

  getMessages: db.prepare(`
    SELECT * FROM messages
    WHERE conversation_id = @conversationId
      AND (@before IS NULL OR created_at < @before)
    ORDER BY created_at DESC
    LIMIT @limit
  `),

  updateMessageStatus: db.prepare(
    "UPDATE messages SET status = ? WHERE id = ?"
  ),

  clearMessagesForConversation: db.prepare(
    "DELETE FROM messages WHERE conversation_id = ?"
  ),

  deleteMessageById: db.prepare("DELETE FROM messages WHERE id = ?"),

  deleteAllMembersForConversation: db.prepare(
    "DELETE FROM conversation_members WHERE conversation_id = ?"
  ),

  getDekWrapForMember: db.prepare(`
    SELECT wrapped_by_address AS wrappedBy, payload
    FROM conversation_dek_wraps
    WHERE conversation_id = ? AND member_address = ?
  `),

  listDekWrappedMembers: db.prepare(
    "SELECT member_address FROM conversation_dek_wraps WHERE conversation_id = ?"
  ),

  insertDekWrap: db.prepare(`
    INSERT INTO conversation_dek_wraps (conversation_id, member_address, wrapped_by_address, payload)
    VALUES (?, ?, ?, ?)
  `),

  deleteDekWrapsForConversation: db.prepare(
    "DELETE FROM conversation_dek_wraps WHERE conversation_id = ?"
  ),

  deleteDekWrapForMember: db.prepare(
    "DELETE FROM conversation_dek_wraps WHERE conversation_id = ? AND member_address = ?"
  ),

  findPrivateConversation: db.prepare(`
    SELECT c.id FROM conversations c
    JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.member_address = ?
    JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.member_address = ?
    WHERE c.type = 'private'
    LIMIT 1
  `),

  getMessage: db.prepare("SELECT * FROM messages WHERE id = ?"),

  updateLastSeen: db.prepare(
    "UPDATE users SET last_seen = datetime('now') WHERE address = ?"
  ),

  updatePublicKey: db.prepare(
    "UPDATE users SET public_key = ? WHERE address = ?"
  ),

  isConversationMember: db.prepare(
    "SELECT 1 AS x FROM conversation_members WHERE conversation_id = ? AND member_address = ? LIMIT 1"
  ),

  memberAddressesShareConversation: db.prepare(`
    SELECT 1 AS x FROM conversation_members c1
    JOIN conversation_members c2 ON c1.conversation_id = c2.conversation_id
    WHERE c1.member_address = ? AND c2.member_address = ?
    LIMIT 1
  `),

  insertMessageReaction: db.prepare(`
    INSERT INTO message_reactions (message_id, user_address, emoji)
    VALUES (@messageId, @userAddress, @emoji)
  `),

  getMessageReactionById: db.prepare(`SELECT * FROM message_reactions WHERE id = ?`),

  deleteMessageReactionById: db.prepare(`DELETE FROM message_reactions WHERE id = ?`),

  getTokenMinIat: db.prepare(
    "SELECT min_iat FROM auth_token_revocations WHERE address = ?"
  ),

  upsertTokenMinIat: db.prepare(`
    INSERT INTO auth_token_revocations (address, min_iat) VALUES (?, ?)
    ON CONFLICT(address) DO UPDATE SET min_iat = excluded.min_iat
      WHERE excluded.min_iat > auth_token_revocations.min_iat
  `),

  listTokenRevocations: db.prepare(
    "SELECT address, min_iat FROM auth_token_revocations"
  ),

  insertSignatureDeny: db.prepare(`
    INSERT OR IGNORE INTO auth_login_signature_denylist (address, sig_hash)
    VALUES (?, ?)
  `),

  hasSignatureDeny: db.prepare(`
    SELECT 1 AS x FROM auth_login_signature_denylist
    WHERE address = ? AND sig_hash = ? LIMIT 1
  `),

  pruneSignatureDeny: db.prepare(
    "DELETE FROM auth_login_signature_denylist WHERE created_at < datetime('now', ?)"
  ),

};

// ── Exported functions ──────────────────────────────────────────────

function clipString(value, maxLen) {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t.length === 0) return null;
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

export function createOrUpdateUser(address, data = {}) {
  const addr = address.toLowerCase();
  stmts.upsertUser.run({
    address: addr,
    nickname: clipString(data.nickname, 64),
    avatar: clipString(data.avatar, 2048),
    bio: clipString(data.bio, 280),
    publicKey: clipString(data.publicKey, 256),
  });
  return stmts.getUser.get(addr);
}

export function getUser(address) {
  return stmts.getUser.get(address.toLowerCase()) ?? null;
}

export function upsertContact(ownerAddress, contactAddress, apelido) {
  const o = ownerAddress.toLowerCase();
  const c = contactAddress.toLowerCase();
  const a = String(apelido ?? "").trim().slice(0, 64);
  stmts.upsertContact.run(o, c, a);
}

export function removeContact(ownerAddress, contactAddress) {
  stmts.removeContact.run(ownerAddress.toLowerCase(), contactAddress.toLowerCase());
}

export function getContacts(ownerAddress) {
  return stmts.getContacts.all(ownerAddress.toLowerCase());
}

export function createConversation(id, type, name, createdBy, members) {
  const addr = createdBy.toLowerCase();
  const txn = db.transaction(() => {
    stmts.createConversation.run({ id, type, name: name ?? null, createdBy: addr });
    for (const m of members) {
      const mAddr = m.toLowerCase();
      const role = type === "group" && mAddr === addr ? "admin" : "member";
      stmts.addMember.run(id, mAddr, role);
    }
  });
  txn();
  return stmts.getConversation.get(id);
}

export function getConversation(id) {
  return stmts.getConversation.get(id) ?? null;
}

export function getUserConversations(address) {
  return stmts.getUserConversations.all({ address: address.toLowerCase() });
}

/** Para conversas privadas: endereço, nome público e avatar do outro participante (vista do utilizador). */
export function attachPrivatePeerFields(conversation, viewerAddress) {
  if (!conversation || conversation.type !== "private") return conversation;
  const row = stmts.privatePeerPreview.get(
    conversation.id,
    String(viewerAddress).toLowerCase()
  );
  if (!row?.address) return conversation;
  return {
    ...conversation,
    peer_address: row.address,
    peer_nickname: row.nickname ?? null,
    peer_avatar: row.avatar ?? null,
  };
}

export function addConversationMember(conversationId, address, role = "member") {
  const r = role === "admin" ? "admin" : "member";
  stmts.addMember.run(conversationId, address.toLowerCase(), r);
}

export function removeConversationMember(conversationId, address) {
  stmts.removeMember.run(conversationId, address.toLowerCase());
}

export function getConversationMembers(conversationId) {
  return stmts.getConversationMembers.all(conversationId);
}

export function getConversationMembersForViewer(conversationId, viewerAddress) {
  return stmts.getConversationMembersForViewer.all({
    conversationId,
    viewer: viewerAddress.toLowerCase(),
  });
}

export function isConversationMember(conversationId, memberAddress) {
  const row = stmts.isConversationMember.get(conversationId, memberAddress.toLowerCase());
  return Boolean(row);
}

export function getMemberRole(conversationId, memberAddress) {
  const row = stmts.memberRoleRow.get(conversationId, memberAddress.toLowerCase());
  return row?.role === "admin" ? "admin" : "member";
}

export function isGroupAdmin(conversationId, memberAddress) {
  const conv = getConversation(conversationId);
  if (!conv || conv.type !== "group") return false;
  return getMemberRole(conversationId, memberAddress) === "admin";
}

export function countGroupAdmins(conversationId) {
  const row = stmts.countGroupAdmins.get(conversationId);
  return Number(row?.n ?? 0);
}

export function canPostMessage(conversationId, senderAddress) {
  const conv = getConversation(conversationId);
  if (!conv) return false;
  if (!isConversationMember(conversationId, senderAddress)) return false;
  if (conv.type !== "group") return true;
  if (!Number(conv.group_only_admins_post)) return true;
  return getMemberRole(conversationId, senderAddress) === "admin";
}

export function setGroupMemberRole(conversationId, targetAddress, newRole) {
  const tid = String(targetAddress).toLowerCase();
  if (newRole !== "admin" && newRole !== "member") {
    return { ok: false, reason: "invalid_role" };
  }
  if (!isConversationMember(conversationId, tid)) {
    return { ok: false, reason: "not_member" };
  }
  const current = getMemberRole(conversationId, tid);
  if (newRole === "member" && current === "admin" && countGroupAdmins(conversationId) <= 1) {
    return { ok: false, reason: "last_admin" };
  }
  stmts.setMemberRole.run(newRole, conversationId, tid);
  return { ok: true };
}

export function updateGroupOnlyAdminsPost(conversationId, flag) {
  const conv = getConversation(conversationId);
  if (!conv || conv.type !== "group") {
    return { ok: false, reason: "not_group" };
  }
  stmts.updateGroupOnlyAdminsPost.run(flag ? 1 : 0, conversationId);
  return { ok: true };
}

/** True se ambos participam na mesma conversa (ou é o mesmo endereço). */
export function memberAddressesShareConversation(addrA, addrB) {
  const a = String(addrA || "").toLowerCase();
  const b = String(addrB || "").toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  return Boolean(stmts.memberAddressesShareConversation.get(a, b));
}

export function createMessage(id, conversationId, senderAddress, content, type = "text", replyTo = null, encrypted = 0, fileName = null, fileSize = null) {
  stmts.createMessage.run({
    id,
    conversationId,
    senderAddress: senderAddress.toLowerCase(),
    content,
    type,
    replyTo,
    encrypted: encrypted ? 1 : 0,
    fileName: fileName ?? null,
    fileSize: fileSize ?? null,
  });
  return stmts.getMessage.get(id);
}

export function getMessages(conversationId, limit = 50, before = null) {
  return stmts.getMessages.all({
    conversationId,
    limit,
    before,
  });
}

/** Anexa `reactions: [...]` a cada mensagem (lista ordenada por id). */
export function mergeReactionsIntoMessages(messages) {
  if (!messages || messages.length === 0) return messages || [];
  const byMsg = reactionsForMessageIds(messages.map((m) => m.id));
  return messages.map((m) => ({
    ...m,
    reactions: byMsg.get(m.id) || [],
  }));
}

export function addMessageReaction(messageId, userAddress, emoji) {
  const e = normalizeReactionEmoji(emoji);
  if (!e) return null;
  const addr = String(userAddress).toLowerCase();
  const info = stmts.insertMessageReaction.run({
    messageId,
    userAddress: addr,
    emoji: e,
  });
  const rid = Number(info.lastInsertRowid);
  if (!Number.isFinite(rid)) return null;
  return stmts.getMessageReactionById.get(rid) ?? null;
}

export function removeMessageReaction(reactionId, userAddress) {
  const id = Number(reactionId);
  if (!Number.isFinite(id)) return { ok: false, reason: "invalid" };
  const row = stmts.getMessageReactionById.get(id);
  if (!row) return { ok: false, reason: "not_found" };
  if (String(row.user_address).toLowerCase() !== String(userAddress).toLowerCase()) {
    return { ok: false, reason: "forbidden" };
  }
  stmts.deleteMessageReactionById.run(id);
  return { ok: true, messageId: row.message_id };
}

export function getMessageById(id) {
  return stmts.getMessage.get(id) ?? null;
}

export function updateMessageStatus(messageId, status) {
  stmts.updateMessageStatus.run(status, messageId);
}

export function clearConversationMessages(conversationId) {
  return stmts.clearMessagesForConversation.run(conversationId);
}

/**
 * Remove o utilizador da conversa; se não ficarem membros, apaga mensagens e a conversa.
 * Grupos: o único administrador não pode sair sem promover outro antes.
 */
export function leaveConversation(conversationId, memberAddress) {
  const id = conversationId;
  const addr = memberAddress.toLowerCase();
  const conv = getConversation(id);
  if (
    conv?.type === "group" &&
    isGroupAdmin(id, addr) &&
    countGroupAdmins(id) <= 1
  ) {
    return { ok: false, reason: "sole_admin" };
  }
  stmts.removeMember.run(id, addr);
  const row = stmts.countConversationMembers.get(id);
  const n = row?.n ?? 0;
  if (n === 0) {
    stmts.clearMessagesForConversation.run(id);
    stmts.deleteConversation.run(id);
  }
  return { ok: true };
}

/** Apaga uma mensagem se o pedido for do remetente. */
export function deleteMessageIfSender(messageId, requesterAddress) {
  const row = getMessageById(messageId);
  if (!row) return { ok: false, reason: "not_found" };
  const req = String(requesterAddress).toLowerCase();
  if (String(row.sender_address).toLowerCase() !== req) {
    return { ok: false, reason: "forbidden" };
  }
  stmts.deleteMessageById.run(messageId);
  return { ok: true, conversationId: row.conversation_id };
}

/** Privado: qualquer membro. Grupo: qualquer administrador. */
export function canDeleteConversationForEveryone(conversationId, requesterAddress) {
  const conv = getConversation(conversationId);
  if (!conv) return false;
  const req = String(requesterAddress).toLowerCase();
  if (!isConversationMember(conversationId, req)) return false;
  if (conv.type === "group") {
    return isGroupAdmin(conversationId, req);
  }
  return true;
}

export function getConversationDekWrap(conversationId, memberAddress) {
  return (
    stmts.getDekWrapForMember.get(conversationId, memberAddress.toLowerCase()) ?? null
  );
}

export function getConversationDekWrappedAddresses(conversationId) {
  const rows = stmts.listDekWrappedMembers.all(conversationId);
  return rows.map((r) => String(r.member_address).toLowerCase());
}

export function insertConversationDekWrapsAtomic(conversationId, wraps) {
  const txn = db.transaction((rows) => {
    for (const w of rows) {
      stmts.insertDekWrap.run(
        conversationId,
        String(w.memberAddress).toLowerCase(),
        String(w.wrappedBy).toLowerCase(),
        String(w.payload)
      );
    }
  });
  txn(wraps);
}

export function deleteConversationDekWraps(conversationId) {
  stmts.deleteDekWrapsForConversation.run(conversationId);
}

export function deleteConversationDekWrapForMember(conversationId, memberAddress) {
  stmts.deleteDekWrapForMember.run(conversationId, memberAddress.toLowerCase());
}

export function deleteConversationCompletely(conversationId) {
  const id = conversationId;
  deleteConversationDekWraps(id);
  stmts.clearMessagesForConversation.run(id);
  stmts.deleteAllMembersForConversation.run(id);
  stmts.deleteConversation.run(id);
}

export function updateLastSeen(address) {
  stmts.updateLastSeen.run(address.toLowerCase());
}

export function updatePublicKey(address, publicKey) {
  stmts.updatePublicKey.run(publicKey, address.toLowerCase());
}

// ── Auth persistence helpers ────────────────────────────────────────

export function getTokenMinIat(address) {
  const row = stmts.getTokenMinIat.get(String(address || "").toLowerCase());
  const v = Number(row?.min_iat ?? 0);
  return Number.isFinite(v) ? v : 0;
}

export function setTokenMinIat(address, minIat) {
  const a = String(address || "").toLowerCase();
  if (!a) return;
  const v = Math.floor(Number(minIat));
  if (!Number.isFinite(v) || v <= 0) return;
  stmts.upsertTokenMinIat.run(a, v);
}

export function listTokenRevocations() {
  return stmts.listTokenRevocations.all();
}

export function denylistLoginSignature(address, sigHash) {
  const a = String(address || "").toLowerCase();
  const h = String(sigHash || "").toLowerCase();
  if (!a || !h || h.length > 128) return;
  stmts.insertSignatureDeny.run(a, h);
}

export function isLoginSignatureDenylisted(address, sigHash) {
  const a = String(address || "").toLowerCase();
  const h = String(sigHash || "").toLowerCase();
  if (!a || !h) return false;
  return Boolean(stmts.hasSignatureDeny.get(a, h));
}

export function pruneOldLoginSignatureDeny(intervalSqlite = "-30 days") {
  try {
    stmts.pruneSignatureDeny.run(intervalSqlite);
  } catch {
    /* ignore */
  }
}

/**
 * Apaga completamente um utilizador e tudo que lhe está associado.
 *
 * Estratégia:
 * - Conversas privadas onde participa: apagadas inteiras (membros, mensagens, dek_wraps).
 * - Grupos onde participa: removido como membro e mensagens dele apagadas. Se ficar sem membros,
 *   o grupo é apagado. Se era único administrador, promove o membro mais antigo a admin antes de sair.
 * - Reações em qualquer mensagem.
 * - Contactos onde aparece como dono ou alvo.
 * - Tokens revogados e denylist de assinaturas de login.
 *
 * Antes da transação, recolhe URLs de uploads (avatar e mensagens dele + mensagens das
 * conversas privadas que vão ser apagadas) para que o caller possa removê-los do disco.
 *
 * @returns { ok: true, fileUrls: string[], privateConvsAffected: [{convId, peer}], groupsAffected: [{id, action, others: string[]}] }
 *   ou { ok: false, reason }.
 */
export function deleteUserCompletely(address) {
  const addr = String(address || "").toLowerCase();
  if (!addr) return { ok: false, reason: "invalid_address" };

  const user = stmts.getUser.get(addr);
  if (!user) return { ok: false, reason: "not_found" };

  const fileUrls = new Set();
  const collectUploadUrl = (raw) => {
    if (typeof raw !== "string") return;
    const v = raw.trim();
    if (v.startsWith("/uploads/")) fileUrls.add(v);
  };

  collectUploadUrl(user.avatar);

  for (const m of db
    .prepare("SELECT content FROM messages WHERE LOWER(sender_address) = ?")
    .all(addr)) {
    collectUploadUrl(m?.content);
  }

  const privateConvs = db
    .prepare(
      `SELECT c.id FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id = c.id
       WHERE LOWER(cm.member_address) = ? AND c.type = 'private'`
    )
    .all(addr)
    .map((r) => r.id);

  if (privateConvs.length > 0) {
    const placeholders = privateConvs.map(() => "?").join(",");
    for (const m of db
      .prepare(`SELECT content FROM messages WHERE conversation_id IN (${placeholders})`)
      .all(...privateConvs)) {
      collectUploadUrl(m?.content);
    }
  }

  const privateConvsAffected = privateConvs.map((id) => {
    const peerRow = db
      .prepare(
        `SELECT member_address FROM conversation_members
         WHERE conversation_id = ? AND LOWER(member_address) != ?
         LIMIT 1`
      )
      .get(id, addr);
    return {
      convId: id,
      peer: peerRow?.member_address ? String(peerRow.member_address).toLowerCase() : null,
    };
  });

  const groupConvs = db
    .prepare(
      `SELECT c.id, cm.role FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id = c.id
       WHERE LOWER(cm.member_address) = ? AND c.type = 'group'`
    )
    .all(addr);

  const groupOthers = new Map();
  for (const g of groupConvs) {
    const others = db
      .prepare(
        `SELECT member_address FROM conversation_members
         WHERE conversation_id = ? AND LOWER(member_address) != ?`
      )
      .all(g.id, addr)
      .map((r) => String(r.member_address).toLowerCase());
    groupOthers.set(g.id, others);
  }

  const deleteContacts = db.prepare(
    "DELETE FROM contacts WHERE LOWER(owner_address) = ? OR LOWER(contact_address) = ?"
  );
  const deleteUserMessages = db.prepare(
    "DELETE FROM messages WHERE LOWER(sender_address) = ?"
  );
  const deleteUserGroupMessages = db.prepare(
    "DELETE FROM messages WHERE conversation_id = ? AND LOWER(sender_address) = ?"
  );
  const deleteUserReactions = db.prepare(
    "DELETE FROM message_reactions WHERE LOWER(user_address) = ?"
  );
  const deleteUser = db.prepare("DELETE FROM users WHERE LOWER(address) = ?");
  const deleteTokenRev = db.prepare(
    "DELETE FROM auth_token_revocations WHERE LOWER(address) = ?"
  );
  const deleteSigDeny = db.prepare(
    "DELETE FROM auth_login_signature_denylist WHERE LOWER(address) = ?"
  );
  const findOldestOtherMember = db.prepare(
    `SELECT member_address FROM conversation_members
     WHERE conversation_id = ? AND LOWER(member_address) != ?
     ORDER BY joined_at ASC, member_address ASC LIMIT 1`
  );

  const groupsAffected = [];

  const txn = db.transaction(() => {
    for (const id of privateConvs) {
      stmts.deleteDekWrapsForConversation.run(id);
      stmts.clearMessagesForConversation.run(id);
      stmts.deleteAllMembersForConversation.run(id);
      stmts.deleteConversation.run(id);
    }

    for (const g of groupConvs) {
      const id = g.id;
      const wasAdmin = String(g.role || "").toLowerCase() === "admin";

      if (wasAdmin) {
        const adminRow = stmts.countGroupAdmins.get(id);
        const adminCount = Number(adminRow?.n ?? 0);
        if (adminCount <= 1) {
          const next = findOldestOtherMember.get(id, addr);
          if (next?.member_address) {
            stmts.setMemberRole.run("admin", id, String(next.member_address).toLowerCase());
          }
        }
      }

      stmts.removeMember.run(id, addr);
      stmts.deleteDekWrapForMember.run(id, addr);
      deleteUserGroupMessages.run(id, addr);

      const left = Number(stmts.countConversationMembers.get(id)?.n ?? 0);
      if (left === 0) {
        stmts.deleteDekWrapsForConversation.run(id);
        stmts.clearMessagesForConversation.run(id);
        stmts.deleteConversation.run(id);
        groupsAffected.push({ id, action: "deleted", others: groupOthers.get(id) || [] });
      } else {
        groupsAffected.push({ id, action: "left", others: groupOthers.get(id) || [] });
      }
    }

    deleteUserReactions.run(addr);
    deleteUserMessages.run(addr);
    deleteContacts.run(addr, addr);
    deleteTokenRev.run(addr);
    deleteSigDeny.run(addr);
    deleteUser.run(addr);
  });

  txn();

  return {
    ok: true,
    fileUrls: [...fileUrls],
    privateConvsAffected,
    groupsAffected,
  };
}

export function getOrCreatePrivateConversation(address1, address2, newId) {
  const a1 = address1.toLowerCase();
  const a2 = address2.toLowerCase();

  const existing = stmts.findPrivateConversation.get(a1, a2);
  if (existing) {
    return { conversation: stmts.getConversation.get(existing.id), created: false };
  }

  const conversation = createConversation(newId, "private", null, a1, [a1, a2]);
  return { conversation, created: true };
}

export default db;
