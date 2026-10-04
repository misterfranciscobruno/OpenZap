import helmet from "helmet";
import rateLimit from "express-rate-limit";

const isProd = () => process.env.NODE_ENV === "production";

/** Cabeçalhos HTTP de defesa em profundidade (sem CSP por defeito — o cliente é uma SPA externa). */
export function buildHelmet() {
  return helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: isProd() ? undefined : false,
    referrerPolicy: { policy: "no-referrer" },
  });
}

/** Limites de pedidos para mitigar brute-force / abuso. */
export function buildRateLimiters() {
  const common = {
    standardHeaders: "draft-7",
    legacyHeaders: false,
  };

  const auth = rateLimit({
    ...common,
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { error: "rate_limited" },
  });

  const tokenRefresh = rateLimit({
    ...common,
    windowMs: 60 * 60 * 1000,
    max: 30,
    message: { error: "rate_limited" },
  });

  const upload = rateLimit({
    ...common,
    windowMs: 60 * 1000,
    max: 30,
    message: { error: "rate_limited" },
  });

  const apiGeneral = rateLimit({
    ...common,
    windowMs: 60 * 1000,
    max: 600,
    message: { error: "rate_limited" },
  });

  return { auth, tokenRefresh, upload, apiGeneral };
}

/** Códigos genéricos para o cliente; detalhes ficam no log do servidor. */
export function sendError(res, status, code, err) {
  if (err) {
    try {
      console.error(`[api] ${code}:`, err?.stack || err?.message || err);
    } catch {
      /* ignore */
    }
  }
  if (!res.headersSent) {
    res.status(status).json({ error: code });
  }
}

/** Validações de campos de perfil — limites consistentes em todos os endpoints. */
export const PROFILE_LIMITS = {
  nickname: 64,
  bio: 280,
  avatar: 2048,
  publicKey: 256,
};

/** Valida e normaliza um valor textual de perfil; devolve null se inválido. */
export function sanitizeProfileText(value, maxLen) {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.length > maxLen) return null;
  // Sem caracteres de controlo (excepto LF/CR/TAB já saneados na bio).
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(trimmed)) return null;
  return trimmed;
}

/** Avatar pode ser uma URL https/data ou caminho `/uploads/<uuid>.ext` gerado pelo próprio servidor. */
export function sanitizeAvatar(value) {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.length > PROFILE_LIMITS.avatar) return null;
  if (trimmed.startsWith("/uploads/")) {
    return /^\/uploads\/[A-Za-z0-9._-]+$/.test(trimmed) ? trimmed : null;
  }
  if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(trimmed)) {
    return trimmed;
  }
  if (/^https:\/\/[^\s<>"']+$/.test(trimmed)) return trimmed;
  return null;
}

/** Verifica que o nome de ficheiro pedido em /uploads não contém path traversal. */
export function isSafeUploadFilename(name) {
  if (typeof name !== "string" || !name) return false;
  if (name.length > 255) return false;
  if (name.startsWith(".")) return false;
  return /^[A-Za-z0-9._-]+$/.test(name);
}
