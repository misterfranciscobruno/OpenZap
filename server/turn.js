import { createRequire } from "module";
import { networkInterfaces } from "os";

const require = createRequire(import.meta.url);

/**
 * TURN/STUN local (UDP) para atravessar NAT quando host/srflx falham.
 * Credenciais vêm do .env; o cliente obtém iceServers via /api/ice-servers.
 */
export function startTurnServer() {
  const enabled = String(process.env.TURN_ENABLED || "1").trim() !== "0";
  if (!enabled) {
    console.log("OpenZap TURN: desativado (TURN_ENABLED=0)");
    return null;
  }

  let Turn;
  try {
    Turn = require("node-turn");
  } catch (err) {
    console.warn("OpenZap TURN: pacote node-turn indisponível:", err?.message || err);
    return null;
  }

  const listeningPort = Number(process.env.TURN_PORT || 3478);
  const username = (process.env.TURN_USERNAME || "openzap").trim();
  const credential = (process.env.TURN_PASSWORD || "openzap-turn-relay").trim();
  const realm = (process.env.TURN_REALM || "chat.franciscobruno.com").trim();
  const publicHost = (process.env.TURN_PUBLIC_HOST || "chat.franciscobruno.com").trim();
  const externalIp =
    (process.env.TURN_EXTERNAL_IP || "").trim() || detectPublicishIpv4() || null;

  const opts = {
    listeningPort,
    authMech: "long-term",
    credentials: { [username]: credential },
    realm,
    debugLevel: process.env.TURN_DEBUG || "ERROR",
    minPort: Number(process.env.TURN_MIN_PORT || 49152),
    maxPort: Number(process.env.TURN_MAX_PORT || 49300),
    // Alocações longas + refresh do browser — evita cair o relay a meio da chamada.
    maxAllocateLifetime: Number(process.env.TURN_MAX_LIFETIME || 3600),
    defaultAllocatetLifetime: Number(process.env.TURN_DEFAULT_LIFETIME || 1800),
  };
  if (externalIp) {
    opts.externalIps = externalIp;
  }

  try {
    const server = new Turn(opts);
    server.start();
    console.log(
      `OpenZap TURN: a escutar UDP :${listeningPort}` +
        (externalIp ? ` (external ${externalIp})` : "") +
        ` host=${publicHost}`
    );
    return {
      server,
      publicHost,
      listeningPort,
      username,
      credential,
      externalIp,
    };
  } catch (err) {
    console.error("OpenZap TURN: falha ao arrancar:", err?.message || err);
    return null;
  }
}

export function buildIceServers(turnInfo) {
  const stunGoogle = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
  if (!turnInfo) return stunGoogle;

  const host = turnInfo.publicHost;
  const port = turnInfo.listeningPort;
  return [
    ...stunGoogle,
    { urls: `stun:${host}:${port}` },
    {
      urls: [`turn:${host}:${port}`, `turn:${host}:${port}?transport=udp`],
      username: turnInfo.username,
      credential: turnInfo.credential,
    },
  ];
}

function detectPublicishIpv4() {
  const nets = networkInterfaces();
  for (const list of Object.values(nets)) {
    if (!list) continue;
    for (const n of list) {
      if (n.family !== "IPv4" && n.family !== 4) continue;
      if (n.internal) continue;
      const a = n.address;
      if (
        a.startsWith("10.") ||
        a.startsWith("192.168.") ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(a)
      ) {
        continue;
      }
      return a;
    }
  }
  // Prefer explicit public IP from earlier deploy context if only private NICs exist
  return process.env.TURN_EXTERNAL_IP || null;
}
