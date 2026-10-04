import dotenv from "dotenv";
import express from "express";
import { createServer as createHttpServer } from "http";
import { createServer as createHttpsServer } from "https";
import { Server } from "socket.io";
import cors from "cors";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { dirname, join, extname } from "path";
import { fileURLToPath } from "url";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "fs";

import {
  createOrUpdateUser,
  getUser,
  upsertContact,
  removeContact,
  getContacts,
  createConversation,
  getUserConversations,
  attachPrivatePeerFields,
  getMessages,
  getConversationMembers,
  getConversationMembersForViewer,
  createMessage,
  updateMessageStatus,
  getOrCreatePrivateConversation,
  addConversationMember,
  removeConversationMember,
  updateLastSeen,
  getConversation,
  updatePublicKey,
  getMessageById,
  mergeReactionsIntoMessages,
  addMessageReaction,
  removeMessageReaction,
  clearConversationMessages,
  leaveConversation,
  canDeleteConversationForEveryone,
  deleteConversationCompletely,
  deleteMessageIfSender,
  isConversationMember,
  memberAddressesShareConversation,
  getConversationDekWrap,
  getConversationDekWrappedAddresses,
  insertConversationDekWrapsAtomic,
  deleteConversationDekWrapForMember,
  canPostMessage,
  isGroupAdmin,
  setGroupMemberRole,
  updateGroupOnlyAdminsPost,
  countGroupAdmins,
  getMemberRole,
  deleteUserCompletely,
} from "./db.js";

import {
  generateNonce,
  verifySignature,
  removeNonce,
  verifyLoginMessage,
  generateProfileReadNonce,
  verifyAndConsumeProfileRead,
  denyLoginSignature,
} from "./auth.js";
import {
  issueApiToken,
  verifyApiToken,
  revokeTokensForAddress,
  forgetTokenRevocationCacheFor,
} from "./authTokens.js";
import {
  buildHelmet,
  buildRateLimiters,
  sendError,
  sanitizeProfileText,
  sanitizeAvatar,
  isSafeUploadFilename,
  PROFILE_LIMITS,
} from "./security.js";
import { startTurnServer, buildIceServers } from "./turn.js";

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), ".env") });

const __dirname = dirname(fileURLToPath(import.meta.url));
const uploadsDir = join(__dirname, "uploads");

if (!existsSync(uploadsDir)) {
  mkdirSync(uploadsDir, { recursive: true });
}

/** Caminhos PEM do Let's Encrypt (ou outro CA). Em Linux, LETSENCRYPT_DOMAIN preenche /etc/letsencrypt/live/<dominio>/. */
function resolveTlsFilePaths() {
  const envKey = process.env.SSL_KEY_PATH?.trim();
  const envCert = process.env.SSL_CERT_PATH?.trim();
  if (envKey && envCert) {
    return { keyPath: envKey, certPath: envCert };
  }

  const domain = process.env.LETSENCRYPT_DOMAIN?.trim();
  if (domain && process.platform !== "win32") {
    const base = join("/etc/letsencrypt/live", domain);
    return {
      keyPath: join(base, "privkey.pem"),
      certPath: join(base, "fullchain.pem"),
    };
  }

  // Raiz do projeto: …/cert/privkey.pem e fullchain.pem
  const defaultKey = join(__dirname, "..", "cert", "privkey.pem");
  const defaultCert = join(__dirname, "..", "cert", "fullchain.pem");
  if (existsSync(defaultKey) && existsSync(defaultCert)) {
    return { keyPath: defaultKey, certPath: defaultCert };
  }

  return { keyPath: envKey || null, certPath: envCert || null };
}

function loadTlsOptions() {
  const { keyPath, certPath } = resolveTlsFilePaths();
  if (!keyPath || !certPath) return null;
  if (!existsSync(keyPath) || !existsSync(certPath)) {
    console.warn(
      "MetaWhats: TLS em falta — verifique SSL_KEY_PATH e SSL_CERT_PATH (ex.: privkey.pem e fullchain.pem do Let's Encrypt)."
    );
    return null;
  }
  try {
    const opts = { key: readFileSync(keyPath), cert: readFileSync(certPath) };
    const caPath = process.env.SSL_CHAIN_PATH?.trim();
    if (caPath && existsSync(caPath)) opts.ca = readFileSync(caPath);
    return opts;
  } catch (err) {
    console.error("MetaWhats: erro ao ler certificados TLS:", err.message);
    return null;
  }
}

// ── Express setup ───────────────────────────────────────────────────

const app = express();
const tlsOptions = loadTlsOptions();
const httpServer = tlsOptions
  ? createHttpsServer(tlsOptions, app)
  : createHttpServer(app);

const isProduction = process.env.NODE_ENV === "production";

const allowedCorsOrigins = (
  process.env.METAWHATS_ALLOWED_ORIGINS || process.env.OPENZAP_ALLOWED_ORIGINS || ""
)
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);

if (isProduction && allowedCorsOrigins.length === 0) {
  throw new Error(
    "METAWHATS_ALLOWED_ORIGINS (ou OPENZAP_ALLOWED_ORIGINS) é obrigatório em produção (lista separada por vírgulas)."
  );
}

/** Em desenvolvimento, sem env definida, autoriza apenas hosts locais comuns. */
const devFallbackOrigins = [
  "http://localhost:5174",
  "http://127.0.0.1:5174",
  "https://localhost:5174",
  "https://127.0.0.1:5174",
];
const effectiveAllowedOrigins =
  allowedCorsOrigins.length > 0 ? allowedCorsOrigins : devFallbackOrigins;

const corsOptions = {
  origin(origin, callback) {
    // Em produção, exigir origem explícita (rejeita pedidos cross-origin sem header
    // Origin, p.ex. ataques CSRF clássicos a partir de páginas locais ou file://).
    if (!origin) {
      if (isProduction) return callback(null, false);
      return callback(null, true);
    }
    if (effectiveAllowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
};

app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 1));
app.use(buildHelmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));

const limiters = buildRateLimiters();
app.use("/api/", limiters.apiGeneral);

const uploadsRouter = express.Router();
uploadsRouter.use((req, res, next) => {
  // Bloqueia path traversal e dotfiles; só permite ficheiros de primeiro nível.
  const requested = decodeURIComponent(req.path.replace(/^\/+/, ""));
  if (!requested || requested.includes("/") || requested.includes("\\")) {
    return res.status(404).end();
  }
  if (!isSafeUploadFilename(requested)) {
    return res.status(404).end();
  }
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  next();
});
uploadsRouter.use(
  express.static(uploadsDir, {
    dotfiles: "deny",
    fallthrough: false,
    index: false,
    redirect: false,
    setHeaders(res) {
      res.setHeader("Cache-Control", "private, no-store, max-age=0");
    },
  })
);
app.use("/uploads", uploadsRouter);

/**
 * Tipos MIME aceitáveis para upload.
 * - `application/octet-stream` é necessário para anexos cifrados E2E (blob opaco).
 * - Categorias media (image/audio/video) e alguns documentos seguros.
 */
const ALLOWED_UPLOAD_MIME_PREFIXES = ["image/", "audio/", "video/"];
const ALLOWED_UPLOAD_MIME_EXACT = new Set([
  "application/octet-stream",
  "application/pdf",
  "application/zip",
  "application/x-zip-compressed",
  "application/json",
  "text/plain",
]);

/**
 * Extensões EXPLICITAMENTE bloqueadas (defesa em profundidade).
 * Embora os ficheiros sejam servidos com `nosniff` e CSP `sandbox`, evitar guardar
 * tipos executáveis no disco reduz superfície a outros vetores (download/abertura).
 */
const BLOCKED_UPLOAD_EXTENSIONS = new Set([
  ".html", ".htm", ".xhtml", ".svg", ".js", ".mjs", ".cjs",
  ".php", ".phtml", ".php3", ".php4", ".php5",
  ".asp", ".aspx", ".jsp", ".jspx",
  ".sh", ".bash", ".zsh", ".ps1", ".psm1", ".bat", ".cmd",
  ".exe", ".dll", ".com", ".scr", ".msi", ".jar", ".apk", ".vbs", ".wsh",
]);

function isAllowedUploadMime(mime) {
  const m = String(mime || "").toLowerCase().trim();
  if (!m) return false;
  if (ALLOWED_UPLOAD_MIME_EXACT.has(m)) return true;
  return ALLOWED_UPLOAD_MIME_PREFIXES.some((p) => m.startsWith(p));
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname || "");
    const safeExt = /^\.[A-Za-z0-9]{1,8}$/.test(ext) ? ext.toLowerCase() : "";
    const finalExt = BLOCKED_UPLOAD_EXTENSIONS.has(safeExt) ? "" : safeExt;
    cb(null, `${uuidv4()}${finalExt}`);
  },
});
const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 1,
    fields: 5,
    fieldSize: 1024,
    parts: 10,
  },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedUploadMime(file.mimetype)) {
      cb(Object.assign(new Error("unsupported_media_type"), { status: 415 }));
      return;
    }
    const ext = extname(file.originalname || "").toLowerCase();
    if (BLOCKED_UPLOAD_EXTENSIONS.has(ext)) {
      cb(Object.assign(new Error("blocked_extension"), { status: 415 }));
      return;
    }
    cb(null, true);
  },
});

function parseBearerToken(req) {
  const h = req.headers.authorization;
  if (!h || typeof h !== "string") return null;
  const m = /^Bearer\s+(\S+)/i.exec(h.trim());
  return m ? m[1] : null;
}

/** Utilizador autenticado via JWT REST, ou responde 401 e devolve null. */
function requireApiUser(req, res) {
  const raw = parseBearerToken(req);
  const auth = raw ? verifyApiToken(raw) : null;
  if (!auth) {
    res.status(401).json({ error: "authentication_required" });
    return null;
  }
  return auth.sub;
}

/** Dados de perfil para listas (membros/contactos) — sem chave E2E nem campos internos. */
function userRowForPeerList(row) {
  if (!row || typeof row !== "object") return row;
  const out = {
    address: row.address,
    nickname: row.nickname ?? null,
    apelido: row.contact_apelido ?? row.apelido ?? null,
    avatar: row.avatar ?? null,
    bio: row.bio ?? null,
    created_at: row.created_at ?? null,
    last_seen: row.last_seen ?? null,
  };
  if (row.member_role != null) {
    out.role = row.member_role === "admin" ? "admin" : "member";
  }
  return out;
}

function contactSharesConversationOrListed(me, target) {
  const t = String(target).toLowerCase();
  if (memberAddressesShareConversation(me, t)) return true;
  try {
    const contacts = getContacts(me);
    return contacts.some((u) => String(u.address).toLowerCase() === t);
  } catch {
    return false;
  }
}

// ── REST endpoints ──────────────────────────────────────────────────

function isValidAddress(addr) {
  return typeof addr === "string" && /^0x[0-9a-fA-F]{40}$/.test(addr);
}

const turnRuntime = startTurnServer();
const iceServersForClients = buildIceServers(turnRuntime);

/** Público: configuração ICE/TURN para chamadas WebRTC. */
app.get("/api/ice-servers", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ iceServers: iceServersForClients });
});

app.get("/api/auth/nonce/:address", limiters.auth, (req, res) => {
  try {
    if (!isValidAddress(req.params.address)) {
      return res.status(400).json({ error: "invalid_address" });
    }
    const nonce = generateNonce(req.params.address);
    if (!nonce) return res.status(400).json({ error: "invalid_address" });
    res.json({ nonce });
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

app.post("/api/auth/verify", limiters.auth, (req, res) => {
  try {
    const { address, signature, nickname } = req.body || {};
    if (!isValidAddress(address) || typeof signature !== "string") {
      return res.status(400).json({ error: "invalid_request" });
    }

    const valid = verifySignature(address, signature);
    if (!valid) {
      return res.status(401).json({ success: false, error: "invalid_signature" });
    }

    removeNonce(address);
    const updates = {};
    if (nickname != null) {
      const safe = sanitizeProfileText(nickname, PROFILE_LIMITS.nickname);
      if (safe === null) return res.status(400).json({ error: "invalid_nickname" });
      if (safe) updates.nickname = safe;
    }
    const user = createOrUpdateUser(address, updates);
    const apiToken = issueApiToken(address);
    res.json({ success: true, user, apiToken });
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

/** Novo token REST a partir da assinatura de login já guardada (sem novo nonce). */
app.post("/api/auth/token", limiters.tokenRefresh, (req, res) => {
  try {
    const { address, signature, message } = req.body || {};
    if (!isValidAddress(address) || typeof signature !== "string" || typeof message !== "string") {
      return res.status(400).json({ error: "invalid_request" });
    }
    if (!verifyLoginMessage(address, message, signature)) {
      return res.status(401).json({ error: "invalid_signature" });
    }
    res.json({ apiToken: issueApiToken(address) });
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

/**
 * Logout: invalida todos os tokens emitidos para o utilizador autenticado.
 * Aceita opcionalmente { message, signature } para também marcar a assinatura
 * de login específica como inválida (impede o cliente de pedir um novo token).
 */
app.post("/api/auth/logout", (req, res) => {
  try {
    const me = requireApiUser(req, res);
    if (!me) return;
    revokeTokensForAddress(me);
    const { message, signature } = req.body || {};
    if (
      typeof message === "string" &&
      typeof signature === "string" &&
      verifyLoginMessage(me, message, signature)
    ) {
      denyLoginSignature(me, signature);
    }
    res.json({ success: true });
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

/**
 * Apaga DEFINITIVAMENTE a conta do utilizador autenticado: perfil, conversas privadas,
 * mensagens, reações, contactos, ficheiros enviados, dek wraps e tokens.
 *
 * Requer { confirm: "DELETE" } no corpo (defesa-em-profundidade contra cliques acidentais).
 *
 * Em grupos, o utilizador é apenas removido (mensagens dele apagadas) e — caso fosse o
 * único administrador — outro membro é promovido automaticamente a administrador para
 * o grupo continuar funcional. Se o grupo ficar sem membros, é apagado por completo.
 *
 * Após apagar, todos os sockets do utilizador são desconectados e os outros participantes
 * recebem `conversation_deleted`/`member_removed` para que as suas listas se atualizem.
 */
app.delete("/api/account", (req, res) => {
  try {
    const me = requireApiUser(req, res);
    if (!me) return;

    const { confirm } = req.body || {};
    if (confirm !== "DELETE") {
      return res.status(400).json({ error: "missing_confirmation" });
    }

    let result;
    try {
      result = deleteUserCompletely(me);
    } catch (err) {
      return sendError(res, 500, "internal_error", err);
    }

    if (!result?.ok) {
      const status = result?.reason === "not_found" ? 404 : 400;
      return res.status(status).json({ error: result?.reason || "delete_failed" });
    }

    revokeTokensForAddress(me);
    forgetTokenRevocationCacheFor(me);

    for (const url of result.fileUrls || []) {
      try {
        const fileName = String(url || "").replace(/^\/uploads\//, "");
        if (!fileName || fileName.includes("/") || fileName.includes("\\")) continue;
        if (!isSafeUploadFilename(fileName)) continue;
        const filePath = join(uploadsDir, fileName);
        if (existsSync(filePath)) unlinkSync(filePath);
      } catch {
        /* best-effort: continuar com os restantes ficheiros */
      }
    }

    for (const item of result.privateConvsAffected || []) {
      if (!item?.peer) continue;
      io.to(item.peer).emit("conversation_deleted", { conversationId: item.convId });
    }

    for (const g of result.groupsAffected || []) {
      const others = Array.isArray(g?.others) ? g.others : [];
      if (g.action === "deleted") {
        for (const m of others) {
          io.to(m).emit("conversation_deleted", { conversationId: g.id });
        }
        continue;
      }
      const conv = getConversation(g.id);
      for (const m of others) {
        io.to(m).emit("member_removed", { conversationId: g.id, memberAddress: me });
        if (conv) {
          io.to(m).emit("group_meta_updated", { conversationId: g.id, conversation: conv });
        }
      }
    }

    io.to(me).emit("account_deleted", { address: me });

    try {
      io.in(me).disconnectSockets(true);
    } catch {
      /* ignore */
    }

    res.json({ success: true });
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

app.get("/api/auth/profile-read-nonce/:address", limiters.auth, (req, res) => {
  try {
    if (!isValidAddress(req.params.address)) {
      return res.status(400).json({ error: "invalid_address" });
    }
    const nonce = generateProfileReadNonce(req.params.address);
    if (!nonce) return res.status(400).json({ error: "invalid_address" });
    res.json({ nonce });
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

/** Ler perfil completo sem JWT: exige assinatura EIP-191 (ex.: assistente de login). */
app.post("/api/users/profile", limiters.auth, (req, res) => {
  try {
    const { address, message, signature } = req.body || {};
    if (!isValidAddress(address) || typeof message !== "string" || typeof signature !== "string") {
      return res.status(400).json({ error: "invalid_request" });
    }
    const addr = String(address).toLowerCase();
    if (!verifyAndConsumeProfileRead(addr, message, signature)) {
      return res.status(401).json({ error: "invalid_profile_read" });
    }
    const user = getUser(addr);
    if (!user) return res.status(404).json({ error: "user_not_found" });
    res.json(user);
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

app.get("/api/users/:address", (req, res) => {
  try {
    const me = requireApiUser(req, res);
    if (!me) return;
    if (!isValidAddress(req.params.address)) {
      return res.status(400).json({ error: "invalid_address" });
    }
    const target = String(req.params.address).toLowerCase();
    if (me !== target) {
      return res.status(403).json({ error: "forbidden" });
    }
    const user = getUser(target);
    if (!user) return res.status(404).json({ error: "user_not_found" });
    res.json(user);
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

app.put("/api/users/:address", (req, res) => {
  try {
    const me = requireApiUser(req, res);
    if (!me) return;
    if (!isValidAddress(req.params.address)) {
      return res.status(400).json({ error: "invalid_address" });
    }
    const target = String(req.params.address).toLowerCase();
    if (me !== target) {
      return res.status(403).json({ error: "forbidden" });
    }
    const body = req.body || {};
    const updates = {};
    if (body.nickname !== undefined) {
      const v = sanitizeProfileText(body.nickname, PROFILE_LIMITS.nickname);
      if (v === null) return res.status(400).json({ error: "invalid_nickname" });
      updates.nickname = v;
    }
    if (body.bio !== undefined) {
      const v = sanitizeProfileText(body.bio, PROFILE_LIMITS.bio);
      if (v === null) return res.status(400).json({ error: "invalid_bio" });
      updates.bio = v;
    }
    if (body.avatar !== undefined) {
      const v = sanitizeAvatar(body.avatar);
      if (v === null) return res.status(400).json({ error: "invalid_avatar" });
      updates.avatar = v;
    }
    const user = createOrUpdateUser(target, updates);
    res.json(user);
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

app.put("/api/users/:address/public-key", (req, res) => {
  try {
    const me = requireApiUser(req, res);
    if (!me) return;
    if (!isValidAddress(req.params.address)) {
      return res.status(400).json({ error: "invalid_address" });
    }
    const target = String(req.params.address).toLowerCase();
    if (me !== target) {
      return res.status(403).json({ error: "forbidden" });
    }
    const { publicKey } = req.body || {};
    if (
      typeof publicKey !== "string" ||
      publicKey.length === 0 ||
      publicKey.length > PROFILE_LIMITS.publicKey
    ) {
      return res.status(400).json({ error: "invalid_public_key" });
    }
    updatePublicKey(target, publicKey.trim());
    res.json({ success: true });
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

/** Resumo público mínimo para sugerir apelido ao adicionar à agenda (autenticado). */
app.get("/api/users/:address/peer-summary", (req, res) => {
  try {
    const me = requireApiUser(req, res);
    if (!me) return;
    if (!isValidAddress(req.params.address)) {
      return res.status(400).json({ error: "invalid_address" });
    }
    const target = String(req.params.address).toLowerCase();
    const u = getUser(target);
    res.json(
      u
        ? userRowForPeerList(u)
        : {
            address: target,
            nickname: null,
            apelido: null,
            avatar: null,
            bio: null,
            created_at: null,
            last_seen: null,
          }
    );
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

app.get("/api/users/:address/public-key", (req, res) => {
  try {
    const me = requireApiUser(req, res);
    if (!me) return;
    if (!isValidAddress(req.params.address)) {
      return res.status(400).json({ error: "invalid_address" });
    }
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
    const target = String(req.params.address).toLowerCase();
    if (me !== target && !contactSharesConversationOrListed(me, target)) {
      return res.status(403).json({ error: "forbidden" });
    }
    const user = getUser(target);
    if (!user) return res.status(404).json({ error: "user_not_found" });
    res.json({ publicKey: user.public_key ?? null });
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

app.get("/api/contacts/:ownerAddress", (req, res) => {
  try {
    const me = requireApiUser(req, res);
    if (!me) return;
    if (!isValidAddress(req.params.ownerAddress)) {
      return res.status(400).json({ error: "invalid_address" });
    }
    const owner = String(req.params.ownerAddress).toLowerCase();
    if (me !== owner) {
      return res.status(403).json({ error: "forbidden" });
    }
    const contacts = getContacts(owner);
    res.json(contacts.map(userRowForPeerList));
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

app.post("/api/contacts", (req, res) => {
  try {
    const me = requireApiUser(req, res);
    if (!me) return;
    const { ownerAddress, contactAddress, apelido } = req.body || {};
    if (!isValidAddress(ownerAddress) || !isValidAddress(contactAddress)) {
      return res.status(400).json({ error: "invalid_address" });
    }
    if (me !== String(ownerAddress).toLowerCase()) {
      return res.status(403).json({ error: "forbidden" });
    }
    const ap = sanitizeProfileText(apelido, PROFILE_LIMITS.nickname);
    if (!ap) return res.status(400).json({ error: "invalid_apelido" });
    createOrUpdateUser(contactAddress, {});
    upsertContact(ownerAddress, contactAddress, ap);
    res.json({ success: true });
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

app.put("/api/contacts", (req, res) => {
  try {
    const me = requireApiUser(req, res);
    if (!me) return;
    const { ownerAddress, contactAddress, apelido } = req.body || {};
    if (!isValidAddress(ownerAddress) || !isValidAddress(contactAddress)) {
      return res.status(400).json({ error: "invalid_address" });
    }
    if (me !== String(ownerAddress).toLowerCase()) {
      return res.status(403).json({ error: "forbidden" });
    }
    const ap = sanitizeProfileText(apelido, PROFILE_LIMITS.nickname);
    if (!ap) return res.status(400).json({ error: "invalid_apelido" });
    upsertContact(ownerAddress, contactAddress, ap);
    res.json({ success: true });
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

app.delete("/api/contacts", (req, res) => {
  try {
    const me = requireApiUser(req, res);
    if (!me) return;
    const { ownerAddress, contactAddress } = req.body || {};
    if (!isValidAddress(ownerAddress) || !isValidAddress(contactAddress)) {
      return res.status(400).json({ error: "invalid_address" });
    }
    if (me !== String(ownerAddress).toLowerCase()) {
      return res.status(403).json({ error: "forbidden" });
    }
    removeContact(ownerAddress, contactAddress);
    res.json({ success: true });
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

app.get("/api/conversations/:address", (req, res) => {
  try {
    const me = requireApiUser(req, res);
    if (!me) return;
    if (!isValidAddress(req.params.address)) {
      return res.status(400).json({ error: "invalid_address" });
    }
    if (me !== String(req.params.address).toLowerCase()) {
      return res.status(403).json({ error: "forbidden" });
    }
    const conversations = getUserConversations(req.params.address);
    res.json(conversations);
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

app.get("/api/conversations/:id/messages", (req, res) => {
  try {
    const me = requireApiUser(req, res);
    if (!me) return;
    if (!isConversationMember(req.params.id, me)) {
      return res.status(403).json({ error: "forbidden" });
    }
    const { before, limit } = req.query;
    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    const safeLimit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 200)
      : 50;
    const messages = getMessages(req.params.id, safeLimit, before || null);
    res.json(mergeReactionsIntoMessages(messages));
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

app.get("/api/conversations/:id/members", (req, res) => {
  try {
    const me = requireApiUser(req, res);
    if (!me) return;
    if (!isConversationMember(req.params.id, me)) {
      return res.status(403).json({ error: "forbidden" });
    }
    const members = getConversationMembersForViewer(req.params.id, me);
    res.json(members.map(userRowForPeerList));
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

app.delete("/api/conversations/:id/membership", (req, res) => {
  try {
    const me = requireApiUser(req, res);
    if (!me) return;
    const { address } = req.body || {};
    if (!isValidAddress(address)) {
      return res.status(400).json({ error: "invalid_address" });
    }
    if (String(address).toLowerCase() !== me) {
      return res.status(403).json({ error: "forbidden" });
    }
    const left = leaveConversation(req.params.id, address);
    if (!left.ok) {
      return res.status(403).json({
        error: left.reason === "sole_admin" ? "sole_admin" : "forbidden",
        message:
          left.reason === "sole_admin"
            ? "Promova outro administrador antes de sair do grupo."
            : "Não foi possível sair.",
      });
    }
    res.json({ success: true });
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

/** Preferir este endpoint: o corpo em DELETE por vezes é descartado por proxies. */
app.post("/api/conversations/:id/leave", (req, res) => {
  try {
    const me = requireApiUser(req, res);
    if (!me) return;
    const { address } = req.body || {};
    if (!isValidAddress(address)) {
      return res.status(400).json({ error: "invalid_address" });
    }
    if (String(address).toLowerCase() !== me) {
      return res.status(403).json({ error: "forbidden" });
    }
    const left = leaveConversation(req.params.id, address);
    if (!left.ok) {
      return res.status(403).json({
        error: left.reason === "sole_admin" ? "sole_admin" : "forbidden",
        message:
          left.reason === "sole_admin"
            ? "Promova outro administrador antes de sair do grupo."
            : "Não foi possível sair.",
      });
    }
    res.json({ success: true });
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

app.post("/api/conversations/private", (req, res) => {
  try {
    const me = requireApiUser(req, res);
    if (!me) return;
    const { participants } = req.body || {};
    if (
      !Array.isArray(participants) ||
      participants.length !== 2 ||
      !participants.every(isValidAddress)
    ) {
      return res.status(400).json({ error: "invalid_participants" });
    }
    const [a1, a2] = participants.map((p) => String(p).toLowerCase());
    if (me !== a1 && me !== a2) {
      return res.status(403).json({ error: "forbidden" });
    }
    createOrUpdateUser(a1, {});
    createOrUpdateUser(a2, {});
    const id = uuidv4();
    const { conversation } = getOrCreatePrivateConversation(a1, a2, id);
    res.json(attachPrivatePeerFields(conversation, me));
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

/**
 * Multer corre antes de qualquer middleware seu — autenticamos primeiro num
 * preflight para evitar gravar ficheiros de utilizadores não autenticados.
 */
function preflightUploadAuth(req, res, next) {
  const me = requireApiUser(req, res);
  if (!me) return;
  req._uploader = me;
  next();
}

app.post(
  "/api/upload",
  limiters.upload,
  preflightUploadAuth,
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) {
        const code = err?.code || err?.message || "upload_failed";
        const status = Number(err?.status) || (err?.code === "LIMIT_FILE_SIZE" ? 413 : 400);
        return res.status(status).json({ error: code });
      }
      next();
    });
  },
  (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "no_file" });
      res.json({
        url: `/uploads/${req.file.filename}`,
        size: req.file.size,
        mimetype: req.file.mimetype,
      });
    } catch (err) {
      sendError(res, 500, "internal_error", err);
    }
  }
);

// ── Socket.IO setup ─────────────────────────────────────────────────

const io = new Server(httpServer, {
  cors: {
    origin: effectiveAllowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
  maxHttpBufferSize: 5e6,
});

app.delete("/api/conversations/:id/messages", (req, res) => {
  try {
    const me = requireApiUser(req, res);
    if (!me) return;
    const id = req.params.id;
    if (!isConversationMember(id, me)) {
      return res.status(403).json({ error: "forbidden" });
    }
    const conv = getConversation(id);
    if (conv?.type === "group" && !isGroupAdmin(id, me)) {
      return res.status(403).json({ error: "forbidden", code: "group_admin_required" });
    }
    clearConversationMessages(id);
    io.to(id).emit("conversation_cleared", { conversationId: id });
    res.json({ success: true });
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

app.get("/api/conversations/:id/dek-wrap", (req, res) => {
  try {
    const me = requireApiUser(req, res);
    if (!me) return;
    const id = req.params.id;
    if (!isConversationMember(id, me)) {
      return res.status(403).json({ error: "forbidden" });
    }
    const row = getConversationDekWrap(id, me);
    if (!row) {
      return res.json({ wrappedBy: null, payload: null });
    }
    res.json({ wrappedBy: row.wrappedBy, payload: row.payload });
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

app.get("/api/conversations/:id/dek-wraps/meta", (req, res) => {
  try {
    const me = requireApiUser(req, res);
    if (!me) return;
    const id = req.params.id;
    if (!isConversationMember(id, me)) {
      return res.status(403).json({ error: "forbidden" });
    }
    res.json({ wrappedMembers: getConversationDekWrappedAddresses(id) });
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

app.post("/api/conversations/:id/dek-wraps", (req, res) => {
  try {
    const me = requireApiUser(req, res);
    if (!me) return;
    const id = req.params.id;
    if (!isConversationMember(id, me)) {
      return res.status(403).json({ error: "forbidden" });
    }
    const wraps = req.body?.wraps;
    if (!Array.isArray(wraps)) {
      return res.status(400).json({ error: "wraps required" });
    }
    const memberList = getConversationMembers(id).map((m) =>
      String(m.address).toLowerCase()
    );
    const memberSet = new Set(memberList);
    const existing = new Set(getConversationDekWrappedAddresses(id));
    const others = memberList.filter((m) => m !== me);
    if (wraps.length === 0) {
      if (others.length === 0) {
        return res.json({ success: true });
      }
      return res.status(400).json({ error: "wraps required" });
    }

    for (const w of wraps) {
      const ma = String(w.memberAddress || "").toLowerCase();
      const wb = String(w.wrappedBy || "").toLowerCase();
      if (!w?.payload || typeof w.payload !== "string") {
        return res.status(400).json({ error: "invalid wrap" });
      }
      if (wb !== me) {
        return res.status(403).json({ error: "wrapped_by must match caller" });
      }
      if (!memberSet.has(ma)) {
        return res.status(400).json({ error: "member_not_in_conversation" });
      }
      if (existing.has(ma)) {
        return res.status(409).json({ error: "wrap_already_exists" });
      }
    }

    if (existing.size === 0) {
      const got = new Set(wraps.map((w) => String(w.memberAddress).toLowerCase()));
      for (const m of others) {
        if (!got.has(m)) {
          return res.status(400).json({ error: "initial_wrap_incomplete" });
        }
      }
    }

    insertConversationDekWrapsAtomic(id, wraps);
    res.json({ success: true });
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

function broadcastGroupMetaUpdated(conversationId) {
  const conv = getConversation(conversationId);
  if (!conv) return;
  const members = getConversationMembers(conversationId);
  const payload = { conversationId, conversation: conv };
  io.to(conversationId).emit("group_meta_updated", payload);
  for (const m of members) {
    io.to(String(m.address).toLowerCase()).emit("group_meta_updated", payload);
  }
}

app.put("/api/conversations/:id/group-settings", (req, res) => {
  try {
    const me = requireApiUser(req, res);
    if (!me) return;
    const id = req.params.id;
    if (!isConversationMember(id, me)) {
      return res.status(403).json({ error: "forbidden" });
    }
    if (!isGroupAdmin(id, me)) {
      return res.status(403).json({ error: "forbidden" });
    }
    const only = req.body?.onlyAdminsPost;
    if (typeof only !== "boolean") {
      return res.status(400).json({ error: "onlyAdminsPost boolean required" });
    }
    const r = updateGroupOnlyAdminsPost(id, only);
    if (!r.ok) {
      return res.status(400).json({ error: r.reason });
    }
    broadcastGroupMetaUpdated(id);
    res.json({ success: true, conversation: getConversation(id) });
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

app.put("/api/conversations/:id/members/:memberAddress/role", (req, res) => {
  try {
    const me = requireApiUser(req, res);
    if (!me) return;
    const id = req.params.id;
    let target;
    try {
      target = decodeURIComponent(String(req.params.memberAddress || "")).toLowerCase();
    } catch {
      return res.status(400).json({ error: "invalid_address" });
    }
    if (!isValidAddress(target)) {
      return res.status(400).json({ error: "invalid_address" });
    }
    if (!isConversationMember(id, me)) {
      return res.status(403).json({ error: "forbidden" });
    }
    if (!isGroupAdmin(id, me)) {
      return res.status(403).json({ error: "forbidden" });
    }
    const role = req.body?.role;
    if (role !== "admin" && role !== "member") {
      return res.status(400).json({ error: "role must be admin or member" });
    }
    const previousRole = getMemberRole(id, target);
    const result = setGroupMemberRole(id, target, role);
    if (!result.ok) {
      const st = result.reason === "not_member" ? 404 : 400;
      return res.status(st).json({ error: result.reason });
    }
    if (role === "admin" && previousRole !== "admin") {
      const shortAddr = (a) =>
        a && a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-4)}` : String(a || "");
      const line = `${shortAddr(target)} passou a ser administrador do grupo (promovido por ${shortAddr(me)}).`;
      const msgId = uuidv4();
      const systemMsg = createMessage(msgId, id, me, line, "system");
      io.to(id).emit("new_message", { ...systemMsg, reactions: [] });
      const conv = getConversation(id);
      const memberList = getConversationMembers(id);
      for (const m of memberList) {
        io.to(String(m.address).toLowerCase()).emit("conversation_updated", {
          conversationId: id,
          lastMessage: systemMsg,
          conversation: conv,
        });
      }
      io.to(target).emit("group_role_changed", {
        conversationId: id,
        role: "admin",
        groupName: conv?.name ?? null,
      });
    }
    broadcastGroupMetaUpdated(id);
    res.json({ success: true, conversation: getConversation(id) });
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

app.post("/api/conversations/:id/delete-for-everyone", (req, res) => {
  try {
    const me = requireApiUser(req, res);
    if (!me) return;
    const { address } = req.body || {};
    if (!isValidAddress(address)) {
      return res.status(400).json({ error: "invalid_address" });
    }
    if (String(address).toLowerCase() !== me) {
      return res.status(403).json({ error: "forbidden" });
    }
    const id = req.params.id;
    if (!canDeleteConversationForEveryone(id, address)) {
      return res.status(403).json({ error: "forbidden" });
    }
    const members = getConversationMembers(id);
    deleteConversationCompletely(id);
    const payload = { conversationId: id };
    for (const m of members) {
      io.to(String(m.address).toLowerCase()).emit("conversation_deleted", payload);
    }
    res.json({ success: true });
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

app.post("/api/messages/:messageId/delete-for-everyone", (req, res) => {
  try {
    const me = requireApiUser(req, res);
    if (!me) return;
    const { address } = req.body || {};
    if (!isValidAddress(address)) {
      return res.status(400).json({ error: "invalid_address" });
    }
    if (String(address).toLowerCase() !== me) {
      return res.status(403).json({ error: "forbidden" });
    }
    const result = deleteMessageIfSender(req.params.messageId, address);
    if (!result.ok) {
      const status = result.reason === "not_found" ? 404 : 403;
      return res.status(status).json({ error: result.reason });
    }
    io.to(result.conversationId).emit("message_deleted", {
      messageId: req.params.messageId,
      conversationId: result.conversationId,
    });
    res.json({ success: true });
  } catch (err) {
    sendError(res, 500, "internal_error", err);
  }
});

const socketToAddress = new Map();
/** Número de sockets ligados por endereço (vários separadores / dispositivos). */
const addressConnectionCount = new Map();
const onlineUsers = new Set();
/** Chamadas de grupo WebRTC: conversationId -> { type, members:Set<address> } */
const activeGroupCalls = new Map();

/** Endereço autenticado deste socket, ou null. Usar SEMPRE antes de operações sensíveis. */
function socketAddress(socket) {
  const a = socketToAddress.get(socket.id);
  return typeof a === "string" && a ? a : null;
}

/** Devolve o endereço se for membro da conversa; caso contrário, null e silencia. */
function requireSocketMember(socket, conversationId) {
  const addr = socketAddress(socket);
  if (!addr) return null;
  if (typeof conversationId !== "string" || !conversationId) return null;
  if (!isConversationMember(conversationId, addr)) return null;
  return addr;
}

// ── Static client (produção / single-process) ──────────────────────
//
// Quando existe um build do cliente em `client/dist`, servimos ficheiros estáticos
// e fallback SPA na mesma origem do servidor. Útil para deploys de processo único.
//
const clientDistDir = join(__dirname, "..", "client", "dist");
const serveClientStatic = existsSync(clientDistDir);
if (serveClientStatic) {
  app.use(
    express.static(clientDistDir, {
      index: false,
      setHeaders(res, filePath) {
        // Assets com hash no nome podem ter cache longo; index.html nunca é servido aqui
        // (entregue pelo fallback abaixo, sempre fresco).
        if (/\.(?:js|css|woff2?|png|jpg|jpeg|webp|svg|gif|ico)$/i.test(filePath)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else {
          res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
        }
      },
    })
  );
  // Fallback SPA: qualquer GET fora de /api e /uploads devolve index.html.
  app.get(/^\/(?!api\/|uploads\/|socket\.io\/).*/, (_req, res, next) => {
    const indexHtml = join(clientDistDir, "index.html");
    if (!existsSync(indexHtml)) return next();
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(indexHtml);
  });
  console.log(`MetaWhats: a servir cliente est\u00e1tico de ${clientDistDir}`);
}

io.on("connection", (socket) => {
  socket.on("authenticate", ({ address, signature, message: loginMessage } = {}) => {
    try {
      if (!isValidAddress(address) || typeof signature !== "string") {
        socket.emit("auth_error", { error: "invalid_request" });
        return;
      }
      const wallet = String(address).toLowerCase();
      const valid =
        (loginMessage && verifyLoginMessage(wallet, loginMessage, signature)) ||
        verifySignature(wallet, signature);
      if (!valid) {
        socket.emit("auth_error", { error: "invalid_signature" });
        return;
      }

      const addr = wallet;
      removeNonce(wallet);
      createOrUpdateUser(addr, {});

      const previousAddr = socketToAddress.get(socket.id) || null;
      if (previousAddr && previousAddr !== addr) {
        // Reauth com endereço diferente: decrementa o anterior e sai da sala antiga.
        const prev = addressConnectionCount.get(previousAddr) ?? 0;
        const next = Math.max(0, prev - 1);
        if (next === 0) {
          addressConnectionCount.delete(previousAddr);
          if (onlineUsers.delete(previousAddr)) {
            io.emit("user_offline", { address: previousAddr });
          }
        } else {
          addressConnectionCount.set(previousAddr, next);
        }
        try { socket.leave(previousAddr); } catch { /* ignore */ }
      }

      socketToAddress.set(socket.id, addr);

      // Idempotente: se este socket já estava autenticado para o mesmo endereço, não incrementa.
      if (previousAddr !== addr) {
        const prevCount = addressConnectionCount.get(addr) ?? 0;
        addressConnectionCount.set(addr, prevCount + 1);
        if (prevCount === 0) {
          onlineUsers.add(addr);
          io.emit("user_online", { address: addr });
        }
      }

      socket.join(addr);
      socket.emit("authenticated", { address: addr });
    } catch (err) {
      console.error("[ws] authenticate:", err?.stack || err);
      socket.emit("auth_error", { error: "internal_error" });
    }
  });

  socket.on("join_conversation", ({ conversationId } = {}) => {
    const addr = requireSocketMember(socket, conversationId);
    if (!addr) return;
    socket.join(conversationId);
  });

  socket.on("leave_conversation", ({ conversationId } = {}) => {
    if (!socketAddress(socket)) return;
    if (typeof conversationId !== "string" || !conversationId) return;
    socket.leave(conversationId);
  });

  socket.on(
    "send_message",
    ({ conversationId, content, type = "text", replyTo = null, encrypted = false, fileName = null, fileSize = null } = {}) => {
      try {
        const senderAddress = requireSocketMember(socket, conversationId);
        if (!senderAddress) return;

        const ALLOWED_TYPES = new Set([
          "text",
          "image",
          "audio",
          "video",
          "file",
          "payment",
        ]);
        if (typeof type !== "string" || !ALLOWED_TYPES.has(type)) {
          socket.emit("error", { error: "invalid_type" });
          return;
        }
        if (!canPostMessage(conversationId, senderAddress)) {
          socket.emit("error", {
            error: "not_allowed_post",
            code: "group_admin_only",
          });
          return;
        }
        if (content != null && typeof content !== "string") {
          socket.emit("error", { error: "invalid_content" });
          return;
        }
        if (typeof content === "string" && content.length > 64 * 1024) {
          socket.emit("error", { error: "content_too_large" });
          return;
        }
        if (fileName != null && (typeof fileName !== "string" || fileName.length > 256)) {
          socket.emit("error", { error: "invalid_file_name" });
          return;
        }
        if (
          fileSize != null &&
          (!Number.isFinite(Number(fileSize)) || Number(fileSize) < 0 || Number(fileSize) > 1024 * 1024 * 1024)
        ) {
          socket.emit("error", { error: "invalid_file_size" });
          return;
        }

        let safeReplyTo = null;
        if (replyTo != null) {
          if (typeof replyTo !== "string" || replyTo.length > 64) {
            socket.emit("error", { error: "invalid_reply_to" });
            return;
          }
          const target = getMessageById(replyTo);
          if (!target || target.conversation_id !== conversationId) {
            socket.emit("error", { error: "invalid_reply_to" });
            return;
          }
          safeReplyTo = replyTo;
        }

        const id = uuidv4();
        const message = createMessage(
          id,
          conversationId,
          senderAddress,
          content,
          type,
          safeReplyTo,
          encrypted,
          fileName,
          fileSize
        );

        io.to(conversationId).emit("new_message", { ...message, reactions: [] });

        const members = getConversationMembers(conversationId);
        const conversation = getConversation(conversationId);
        for (const member of members) {
          io.to(member.address).emit("conversation_updated", {
            conversationId,
            lastMessage: message,
            conversation,
          });
        }
      } catch (err) {
        console.error("[ws] send_message:", err?.stack || err);
        socket.emit("error", { error: "internal_error" });
      }
    }
  );

  socket.on("typing", ({ conversationId } = {}) => {
    const address = requireSocketMember(socket, conversationId);
    if (!address) return;
    socket.to(conversationId).emit("user_typing", { address, conversationId });
  });

  socket.on("stop_typing", ({ conversationId } = {}) => {
    const address = requireSocketMember(socket, conversationId);
    if (!address) return;
    socket.to(conversationId).emit("user_stop_typing", { address, conversationId });
  });

  socket.on("message_read", ({ messageId, conversationId } = {}) => {
    try {
      const address = requireSocketMember(socket, conversationId);
      if (!address || !messageId) return;

      const row = getMessageById(messageId);
      if (!row || row.conversation_id !== conversationId) return;
      if (String(row.sender_address).toLowerCase() === address) return;

      updateMessageStatus(messageId, "read");
      const payload = { messageId, status: "read", readBy: address };
      io.to(conversationId).emit("message_status_updated", payload);
      io.to(String(row.sender_address).toLowerCase()).emit("message_status_updated", payload);
    } catch (err) {
      console.error("[ws] message_read:", err?.stack || err);
    }
  });

  /** Quem vê a conversa aberta confirma entrega (duplo visto cinza). */
  socket.on("ack_message_delivery", ({ messageId, conversationId } = {}) => {
    try {
      const address = requireSocketMember(socket, conversationId);
      if (!address || !messageId) return;

      const row = getMessageById(messageId);
      if (!row || row.conversation_id !== conversationId) return;
      if (String(row.sender_address).toLowerCase() === address) return;
      if (row.status !== "sent") return;

      updateMessageStatus(messageId, "delivered");
      const payload = { messageId, status: "delivered" };
      io.to(conversationId).emit("message_status_updated", payload);
      io.to(String(row.sender_address).toLowerCase()).emit("message_status_updated", payload);
    } catch (err) {
      console.error("[ws] ack_message_delivery:", err?.stack || err);
    }
  });

  socket.on("add_message_reaction", ({ messageId, conversationId, emoji } = {}) => {
    try {
      const address = requireSocketMember(socket, conversationId);
      if (!address || !messageId || emoji == null) return;
      const msg = getMessageById(messageId);
      if (!msg || msg.conversation_id !== conversationId) return;
      const row = addMessageReaction(messageId, address, emoji);
      if (!row) return;
      io.to(conversationId).emit("message_reaction_event", {
        conversationId,
        messageId,
        action: "add",
        reaction: {
          id: row.id,
          user_address: row.user_address,
          emoji: row.emoji,
          created_at: row.created_at,
        },
      });
    } catch (err) {
      console.error("[ws] add_message_reaction:", err?.stack || err);
    }
  });

  socket.on("remove_message_reaction", ({ reactionId, conversationId } = {}) => {
    try {
      const address = requireSocketMember(socket, conversationId);
      if (!address || reactionId == null) return;
      const result = removeMessageReaction(reactionId, address);
      if (!result.ok) return;
      io.to(conversationId).emit("message_reaction_event", {
        conversationId,
        messageId: result.messageId,
        action: "remove",
        reactionId,
      });
    } catch (err) {
      console.error("[ws] remove_message_reaction:", err?.stack || err);
    }
  });

  socket.on("create_group", ({ name, members } = {}) => {
    try {
      const creatorAddress = socketAddress(socket);
      if (!creatorAddress) return;
      if (typeof name !== "string") return;
      const safeName = sanitizeProfileText(name, 80);
      if (!safeName) {
        socket.emit("error", { error: "invalid_name", code: "group_invalid_name" });
        return;
      }
      if (!Array.isArray(members) || members.length === 0 || members.length > 256) {
        socket.emit("error", { error: "invalid_members", code: "group_invalid_members" });
        return;
      }
      if (!members.every(isValidAddress)) {
        socket.emit("error", { error: "invalid_members", code: "group_invalid_members" });
        return;
      }

      const allMembers = [
        ...new Set([creatorAddress, ...members.map((m) => m.toLowerCase())]),
      ];
      const id = uuidv4();
      const conversation = createConversation(id, "group", safeName, creatorAddress, allMembers);

      const systemMsgId = uuidv4();
      createMessage(systemMsgId, id, creatorAddress, `Group "${safeName}" created`, "system");

      for (const member of allMembers) {
        io.to(member).emit("new_conversation", conversation);
      }
    } catch (err) {
      console.error("[ws] create_group:", err?.stack || err);
      socket.emit("error", { error: "internal_error" });
    }
  });

  socket.on("add_group_member", ({ conversationId, memberAddress } = {}) => {
    try {
      const address = socketAddress(socket);
      if (!address) return;
      if (typeof conversationId !== "string" || !conversationId) return;
      if (!isValidAddress(memberAddress)) {
        socket.emit("error", { error: "invalid_address" });
        return;
      }

      const conv = getConversation(conversationId);
      if (!conv || conv.type !== "group") return;
      if (!isGroupAdmin(conversationId, address)) {
        socket.emit("error", { error: "forbidden", code: "group_admin_required" });
        return;
      }

      const addr = memberAddress.toLowerCase();
      addConversationMember(conversationId, addr);

      const msgId = uuidv4();
      const systemMsg = createMessage(
        msgId,
        conversationId,
        address,
        `${addr} was added to the group`,
        "system"
      );

      io.to(conversationId).emit("new_message", { ...systemMsg, reactions: [] });
      io.to(conversationId).emit("member_added", { conversationId, memberAddress: addr });

      const conversation = getConversation(conversationId);
      io.to(addr).emit("new_conversation", conversation);
    } catch (err) {
      console.error("[ws] add_group_member:", err?.stack || err);
      socket.emit("error", { error: "internal_error" });
    }
  });

  socket.on("remove_group_member", ({ conversationId, memberAddress } = {}) => {
    try {
      const address = socketAddress(socket);
      if (!address) return;
      if (typeof conversationId !== "string" || !conversationId) return;
      if (!isValidAddress(memberAddress)) {
        socket.emit("error", { error: "invalid_address" });
        return;
      }

      const conv = getConversation(conversationId);
      if (!conv) return;
      if (conv.type !== "group") {
        socket.emit("error", { error: "not_group", code: "not_group_conversation" });
        return;
      }

      const addr = memberAddress.toLowerCase();
      const actor = address.toLowerCase();
      if (!isConversationMember(conversationId, actor)) {
        socket.emit("error", { error: "forbidden" });
        return;
      }
      const isSelf = addr === actor;
      if (!isSelf && !isGroupAdmin(conversationId, actor)) {
        socket.emit("error", { error: "forbidden", code: "group_admin_required" });
        return;
      }
      if (
        isSelf &&
        isGroupAdmin(conversationId, actor) &&
        countGroupAdmins(conversationId) <= 1
      ) {
        socket.emit("error", { error: "sole_admin", code: "sole_admin_cannot_leave" });
        return;
      }

      removeConversationMember(conversationId, addr);
      deleteConversationDekWrapForMember(conversationId, addr);

      const msgId = uuidv4();
      const systemMsg = createMessage(
        msgId,
        conversationId,
        address,
        `${addr} was removed from the group`,
        "system"
      );

      io.to(conversationId).emit("new_message", { ...systemMsg, reactions: [] });
      io.to(conversationId).emit("member_removed", { conversationId, memberAddress: addr });
      io.to(addr).emit("removed_from_group", { conversationId });
    } catch (err) {
      console.error("[ws] remove_group_member:", err?.stack || err);
      socket.emit("error", { error: "internal_error" });
    }
  });

  // ── WebRTC call signaling ──────────────────────────────────────────

  const callLog = (event, detail = {}) => {
    try {
      console.log(`[webrtc] ${event}`, JSON.stringify(detail));
    } catch {
      console.log(`[webrtc] ${event}`);
    }
  };

  socket.on("call_initiate", async ({ to, type, conversationId } = {}) => {
    const fromL = requireSocketMember(socket, conversationId);
    if (!fromL || !type) {
      callLog("initiate_reject", { reason: "not_member_or_no_type", conversationId, type });
      return;
    }
    const conv = getConversation(conversationId);
    if (!conv) {
      callLog("initiate_reject", { reason: "no_conv", from: fromL, conversationId });
      return;
    }

    if (conv.type === "group") {
      if (!activeGroupCalls.has(conversationId)) {
        activeGroupCalls.set(conversationId, { type, members: new Set() });
      }
      const session = activeGroupCalls.get(conversationId);
      session.type = type;
      session.members.add(fromL);
      socket.to(conversationId).emit("incoming_call", {
        from: fromL,
        type,
        conversationId,
        isGroup: true,
      });
      io.to(conversationId).emit("group_call_roster", {
        conversationId,
        members: [...session.members],
      });
      callLog("initiate_group", { from: fromL, type, conversationId, members: [...session.members] });
      return;
    }

    if (!isValidAddress(to)) {
      callLog("initiate_reject", { reason: "bad_to", from: fromL, to });
      return;
    }
    const room = String(to).toLowerCase();
    if (conv.type !== "private") return;
    if (!isConversationMember(conversationId, room)) {
      callLog("initiate_reject", { reason: "peer_not_member", from: fromL, to: room, conversationId });
      return;
    }
    try {
      const remoteSockets = await io.in(room).fetchSockets();
      callLog("initiate_private", {
        from: fromL,
        to: room,
        type,
        conversationId,
        peerSockets: remoteSockets.length,
      });
      if (!remoteSockets.length) {
        socket.emit("call_unavailable", { to: room });
        return;
      }
    } catch {
      callLog("initiate_private", { from: fromL, to: room, type, conversationId, peerSockets: "unknown" });
    }
    io.to(room).emit("incoming_call", { from: fromL, type, conversationId });
  });

  socket.on("call_accept", ({ to, conversationId } = {}) => {
    const fromL = socketAddress(socket);
    if (!fromL) {
      callLog("accept_reject", { reason: "unauth" });
      return;
    }
    if (!isValidAddress(to)) {
      callLog("accept_reject", { reason: "bad_to", from: fromL, to });
      return;
    }
    const target = String(to).toLowerCase();
    if (!memberAddressesShareConversation(fromL, target)) {
      callLog("accept_reject", { reason: "no_shared_conv", from: fromL, to: target });
      return;
    }
    io.to(target).emit("call_accepted", {
      from: fromL,
      conversationId: conversationId || null,
    });
    callLog("accept", { from: fromL, to: target, conversationId: conversationId || null });

    if (conversationId) {
      const conv = getConversation(conversationId);
      if (conv && conv.type === "group") {
        if (!isConversationMember(conversationId, fromL)) return;
        if (!activeGroupCalls.has(conversationId)) {
          activeGroupCalls.set(conversationId, { type: null, members: new Set() });
        }
        const s = activeGroupCalls.get(conversationId);
        s.members.add(fromL);
        io.to(conversationId).emit("group_call_roster", {
          conversationId,
          members: [...s.members],
        });
      }
    }
  });

  socket.on("group_call_leave", ({ conversationId } = {}) => {
    const fromL = requireSocketMember(socket, conversationId);
    if (!fromL) return;
    const s = activeGroupCalls.get(conversationId);
    if (!s) return;
    s.members.delete(fromL);
    const members = [...s.members];
    io.to(conversationId).emit("group_call_roster", { conversationId, members });
    io.to(conversationId).emit("group_call_peer_left", {
      conversationId,
      address: fromL,
    });
    if (members.length === 0) activeGroupCalls.delete(conversationId);
  });

  socket.on("call_reject", ({ to } = {}) => {
    const fromL = socketAddress(socket);
    if (!fromL) return;
    if (!isValidAddress(to)) return;
    const target = String(to).toLowerCase();
    if (!memberAddressesShareConversation(fromL, target)) return;
    io.to(target).emit("call_rejected", { from: fromL });
    callLog("reject", { from: fromL, to: target });
  });

  socket.on("call_offer", ({ to, sdp } = {}) => {
    const fromL = socketAddress(socket);
    if (!fromL || !isValidAddress(to)) {
      callLog("offer_reject", { reason: "unauth_or_bad_to", to });
      return;
    }
    const toL = String(to).toLowerCase();
    if (!memberAddressesShareConversation(fromL, toL)) {
      callLog("offer_reject", { reason: "no_shared_conv", from: fromL, to: toL });
      return;
    }
    const sdpType = sdp && typeof sdp === "object" ? sdp.type : typeof sdp;
    const hasAudio =
      typeof sdp?.sdp === "string" ? /m=audio/i.test(sdp.sdp) : null;
    const hasVideo =
      typeof sdp?.sdp === "string" ? /m=video/i.test(sdp.sdp) : null;
    callLog("offer", { from: fromL, to: toL, sdpType, hasAudio, hasVideo });
    io.to(toL).emit("call_offer", { from: fromL, sdp });
  });

  socket.on("call_answer", ({ to, sdp } = {}) => {
    const fromL = socketAddress(socket);
    if (!fromL || !isValidAddress(to)) {
      callLog("answer_reject", { reason: "unauth_or_bad_to", to });
      return;
    }
    const toL = String(to).toLowerCase();
    if (!memberAddressesShareConversation(fromL, toL)) {
      callLog("answer_reject", { reason: "no_shared_conv", from: fromL, to: toL });
      return;
    }
    const sdpType = sdp && typeof sdp === "object" ? sdp.type : typeof sdp;
    const hasAudio =
      typeof sdp?.sdp === "string" ? /m=audio/i.test(sdp.sdp) : null;
    const hasVideo =
      typeof sdp?.sdp === "string" ? /m=video/i.test(sdp.sdp) : null;
    callLog("answer", { from: fromL, to: toL, sdpType, hasAudio, hasVideo });
    io.to(toL).emit("call_answer", { from: fromL, sdp });
  });

  socket.on("call_ice_candidate", ({ to, candidate } = {}) => {
    const fromL = socketAddress(socket);
    if (!fromL || !isValidAddress(to)) return;
    const toL = String(to).toLowerCase();
    if (!memberAddressesShareConversation(fromL, toL)) {
      callLog("ice_reject", { reason: "no_shared_conv", from: fromL, to: toL });
      return;
    }
    const cand = candidate && typeof candidate === "object" ? candidate.candidate : null;
    const kind =
      typeof cand === "string"
        ? cand.includes(" typ relay")
          ? "relay"
          : cand.includes(" typ srflx")
            ? "srflx"
            : cand.includes(" typ host")
              ? "host"
              : "other"
        : "empty";
    callLog("ice", { from: fromL, to: toL, kind });
    io.to(toL).emit("call_ice_candidate", { from: fromL, candidate });
  });

  socket.on("call_end", ({ to } = {}) => {
    const fromL = socketAddress(socket);
    if (!fromL || !isValidAddress(to)) return;
    const target = String(to).toLowerCase();
    if (!memberAddressesShareConversation(fromL, target)) return;
    io.to(target).emit("call_ended", { from: fromL });
    callLog("end", { from: fromL, to: target });
  });

  socket.on("call_debug", ({ to, connectionState, iceConnectionState, iceGatheringState } = {}) => {
    const fromL = socketAddress(socket);
    if (!fromL) return;
    callLog("peer_state", {
      from: fromL,
      to: to ? String(to).toLowerCase() : null,
      connectionState: connectionState || null,
      iceConnectionState: iceConnectionState || null,
      iceGatheringState: iceGatheringState || null,
    });
  });

  /**
   * Quem partilhou o ecrã avisa o(s) interlocutor(es) que parou.
   * - Privado: notifica apenas o `to`.
   * - Grupo: notifica todos os outros membros da sala da conversa.
   * O receptor mostra um aviso transitório na UI da chamada.
   */
  socket.on("screen_share_stopped", ({ to, conversationId } = {}) => {
    const fromL = socketAddress(socket);
    if (!fromL) return;

    if (typeof conversationId === "string" && conversationId) {
      if (!isConversationMember(conversationId, fromL)) return;
      socket.to(conversationId).emit("screen_share_stopped", {
        from: fromL,
        conversationId,
      });
      return;
    }

    if (!isValidAddress(to)) return;
    const target = String(to).toLowerCase();
    if (!memberAddressesShareConversation(fromL, target)) return;
    io.to(target).emit("screen_share_stopped", { from: fromL });
  });

  socket.on("disconnect", () => {
    const address = socketToAddress.get(socket.id);
    if (address) {
      try {
        updateLastSeen(address);
      } catch {
        /* best-effort */
      }
      socketToAddress.delete(socket.id);
      const n = (addressConnectionCount.get(address) ?? 1) - 1;
      if (n <= 0) {
        addressConnectionCount.delete(address);
        onlineUsers.delete(address);
        io.emit("user_offline", { address });
      } else {
        addressConnectionCount.set(address, n);
      }
    }
  });
});

// ── Start server ────────────────────────────────────────────────────

const PORT = Number(process.env.PORT || 3001);
httpServer.listen(PORT, () => {
  const mode = tlsOptions ? "HTTPS (TLS)" : "HTTP";
  console.log(`MetaWhats server running on port ${PORT} (${mode})`);
});
