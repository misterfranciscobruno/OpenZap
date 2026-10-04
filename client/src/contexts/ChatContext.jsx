import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { ethers } from 'ethers';
import { useAuth } from './AuthContext';
import {
  computeSharedSecret,
  encryptMessage,
  decryptMessage,
  encryptBinary,
  decryptBinary,
  encodeSignedPlaintextPayload,
  decodeAndVerifySignedPayload,
} from '../utils/encryption';
import { detectAttachmentKind, isSafeAttachmentUrl } from '../utils/e2eAttachment';
import { apiFetch } from '../utils/apiFetch';
import { notifyNewMessageGeneric, showInfoNotification } from '../utils/browserNotifications';

const ChatContext = createContext(null);

function cid(entity) {
  if (entity == null) return undefined;
  return entity._id ?? entity.id;
}

function msgConversationId(message) {
  if (!message) return undefined;
  return message.conversation_id ?? message.conversationId;
}

function readHiddenMessageIdsFromStorage(address) {
  const addr = address ? String(address).toLowerCase() : '';
  if (!addr) return new Set();
  try {
    const raw = localStorage.getItem(`openzap_msgs_hidden_${addr}`);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeHiddenMessageIdsToStorage(address, set) {
  const addr = address ? String(address).toLowerCase() : '';
  if (!addr) return;
  try {
    localStorage.setItem(`openzap_msgs_hidden_${addr}`, JSON.stringify([...set].slice(-4000)));
  } catch {
    /* ignore */
  }
}

/** IDs de conversas em que o utilizador silenciou notificações de nova mensagem (só neste dispositivo). */
function readMutedNotificationConversations(address) {
  const addr = address ? String(address).toLowerCase() : '';
  if (!addr) return new Set();
  try {
    const raw = localStorage.getItem(`openzap_notif_muted_${addr}`);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeMutedNotificationConversations(address, set) {
  const addr = address ? String(address).toLowerCase() : '';
  if (!addr) return;
  try {
    localStorage.setItem(`openzap_notif_muted_${addr}`, JSON.stringify([...set].slice(-2000)));
  } catch {
    /* ignore */
  }
}

export function ChatProvider({ children }) {
  const navigate = useNavigate();
  const { user, signature, loginMessage, encryptionKeys, invalidateSocketAuth } = useAuth();
  const [conversations, setConversations] = useState([]);
  /** Primeiro GET /conversations concluído (para validar deep links). */
  const [conversationsReady, setConversationsReady] = useState(false);
  /** Agenda: endereço (lower) → contacto com apelido (GET /api/contacts) */
  const [agendaByAddress, setAgendaByAddress] = useState(() => new Map());
  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [typingUsers, setTypingUsers] = useState(new Map());
  /** Incrementado em cada selectConversation(com não-null) para refocar o compositor mesmo ao re-clicar a mesma conversa. */
  const [composerFocusNonce, setComposerFocusNonce] = useState(0);
  const [messagesLoading, setMessagesLoading] = useState(false);
  /** Geração do carregamento inicial de mensagens (evita desligar loading se uma resposta antiga chegar tarde). */
  const messagesLoadGenRef = useRef(0);
  /** Mensagens apagadas «para mim» (só neste dispositivo / conta). */
  const hiddenForMeMessageIdsRef = useRef(new Set());
  const [mutedNotificationConversations, setMutedNotificationConversations] = useState(() =>
    readMutedNotificationConversations(user?.address)
  );
  const notifMutedConversationsRef = useRef(readMutedNotificationConversations(user?.address));
  const socketRef = useRef(null);
  const [socket, setSocket] = useState(null);
  const activeConversationRef = useRef(null);
  const sharedSecretsRef = useRef(new Map());
  const publicKeyCacheRef = useRef(new Map());
  const groupDekCacheRef = useRef(new Map());
  /** Evita duas inicializações DEK em paralelo (segundo POST falha e apagava a cache). */
  const groupDekEnsureInflightRef = useRef(new Map());
  const hadEncryptionKeysRef = useRef(false);
  /** Outro participante em conversas privadas (UI / chamadas). */
  const privatePeerByConvRef = useRef(new Map());
  const membersByConvRef = useRef(new Map());
  /** Incrementado quando cargos/definições de grupo mudam (refetch da lista de membros na janela de chat). */
  const [groupMetaEpoch, setGroupMetaEpoch] = useState(0);

  useEffect(() => {
    activeConversationRef.current = activeConversation;
  }, [activeConversation]);

  const conversationsRef = useRef(conversations);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const fetchPublicKey = useCallback(async (address) => {
    const cached = publicKeyCacheRef.current.get(address.toLowerCase());
    if (cached !== undefined) return cached;
    try {
      const res = await apiFetch(`/api/users/${address}/public-key`);
      if (res.ok) {
        const data = await res.json();
        const pk = data.publicKey ?? null;
        publicKeyCacheRef.current.set(address.toLowerCase(), pk);
        return pk;
      }
    } catch { /* ignore */ }
    publicKeyCacheRef.current.set(address.toLowerCase(), null);
    return null;
  }, []);

  const getSharedSecret = useCallback(async (otherAddress) => {
    if (!encryptionKeys) return null;
    const addr = otherAddress.toLowerCase();
    const cached = sharedSecretsRef.current.get(addr);
    if (cached) return cached;
    const theirPublicKey = await fetchPublicKey(addr);
    if (!theirPublicKey) return null;
    try {
      const secret = computeSharedSecret(encryptionKeys.privateKey, theirPublicKey);
      sharedSecretsRef.current.set(addr, secret);
      return secret;
    } catch (err) {
      console.error('Erro ao calcular segredo partilhado:', err);
      return null;
    }
  }, [encryptionKeys, fetchPublicKey]);

  const fetchMembersForConv = useCallback(async (conversationId) => {
    if (!conversationId) return [];
    const cached = membersByConvRef.current.get(conversationId);
    if (cached) return cached;
    try {
      const res = await apiFetch(`/api/conversations/${conversationId}/members`);
      if (!res.ok) return [];
      const data = await res.json();
      const arr = Array.isArray(data) ? data : [];
      membersByConvRef.current.set(conversationId, arr);
      return arr;
    } catch {
      return [];
    }
  }, []);

  const isEncryptedPayload = (m) =>
    m && (Number(m.encrypted) === 1 || m.encrypted === true);

  const loadGroupDek = useCallback(
    async (conversationId) => {
      if (!conversationId || !encryptionKeys) return null;
      const hit = groupDekCacheRef.current.get(conversationId);
      if (hit) return hit;
      try {
        const r = await apiFetch(`/api/conversations/${conversationId}/dek-wrap`);
        if (!r.ok) return null;
        const j = await r.json();
        if (!j.wrappedBy || !j.payload) return null;
        const wb = String(j.wrappedBy).toLowerCase();
        const secret = await getSharedSecret(wb);
        if (!secret) return null;
        const dek = await decryptMessage(secret, j.payload);
        groupDekCacheRef.current.set(conversationId, dek);
        return dek;
      } catch {
        return null;
      }
    },
    [encryptionKeys, getSharedSecret]
  );

  /** Mesma chave AES usada para o envelope da mensagem e para o ficheiro (_e2ef). */
  const getAesKeyForMessage = useCallback(
    async (convId, senderAddress) => {
      const me = (user?.address || '').toLowerCase();
      const sender = String(senderAddress || '').toLowerCase();
      let aesKeyHex = null;
      if (convId) {
        const members = await fetchMembersForConv(convId);
        const convRow = (conversationsRef.current || []).find(
          (c) => c != null && String(cid(c)) === String(convId)
        );
        const usePairwiseEcdh =
          convRow?.type === 'private' &&
          Array.isArray(members) &&
          members.length === 2;
        if (usePairwiseEcdh) {
          const other = members.find((m) => (m.address || '').toLowerCase() !== me);
          const otherAddr = other ? String(other.address).toLowerCase() : null;
          const peerForPairwise = sender === me ? otherAddr : sender;
          if (peerForPairwise) {
            aesKeyHex = await getSharedSecret(peerForPairwise);
          }
        }
      }
      if (!aesKeyHex && convId) {
        try {
          aesKeyHex = await loadGroupDek(convId);
        } catch {
          aesKeyHex = null;
        }
      }
      return aesKeyHex;
    },
    [user?.address, fetchMembersForConv, getSharedSecret, loadGroupDek]
  );

  const tryDecryptMessage = useCallback(
    async (message) => {
      if (!isEncryptedPayload(message)) return message;
      if (!encryptionKeys) {
        return {
          ...message,
          content:
            '🔒 Chaves de leitura em falta — use «Assinar na carteira» abaixo ou a faixa no topo.',
          _decryptError: 'no_keys',
        };
      }
      const sender = (message.sender_address ?? message.senderAddress ?? '').toLowerCase();
      const convId = msgConversationId(message);

      const aesKeyHex = await getAesKeyForMessage(convId, sender);

      if (!aesKeyHex) {
        return {
          ...message,
          content: '🔒 Não foi possível obter a chave desta conversa.',
          _decryptError: 'no_aes_key',
        };
      }

      let decryptedUtf8;
      try {
        decryptedUtf8 = await decryptMessage(aesKeyHex, message.content);
      } catch {
        return {
          ...message,
          content: '🔒 Falha ao descriptografar o conteúdo.',
          _decryptError: 'aes_failed',
        };
      }

      const senderPk = await fetchPublicKey(sender);
      const verified = decodeAndVerifySignedPayload(decryptedUtf8, senderPk);
      if (!verified.ok) {
        return {
          ...message,
          content: '⚠️ Assinatura E2E inválida ou mensagem alterada.',
          _decryptError: 'verify_failed',
        };
      }
      const next = { ...message, content: verified.text, _decrypted: true };
      delete next._decryptError;
      return next;
    },
    [encryptionKeys, getAesKeyForMessage, fetchPublicKey]
  );

  const decryptMessages = useCallback(async (msgs) => {
    return Promise.all(msgs.map(tryDecryptMessage));
  }, [tryDecryptMessage]);

  const ensureGroupDek = useCallback(
    async (conversationId) => {
      if (!encryptionKeys || !user?.address || !conversationId) return null;
      const id = String(conversationId);
      const inflight = groupDekEnsureInflightRef.current.get(id);
      if (inflight) return inflight;

      let settle;
      const run = new Promise((resolve) => {
        settle = resolve;
      });
      groupDekEnsureInflightRef.current.set(id, run);

      void (async () => {
        let result = null;
        try {
          let dek = await loadGroupDek(conversationId);
          if (dek) {
            result = dek;
            return;
          }

          const metaRes = await apiFetch(`/api/conversations/${conversationId}/dek-wraps/meta`);
          if (!metaRes.ok) return;
          const meta = await metaRes.json();
          const wrapped = new Set(
            (meta.wrappedMembers || []).map((x) => String(x).toLowerCase())
          );
          const me = user.address.toLowerCase();
          if (wrapped.size > 0) {
            if (wrapped.has(me)) {
              groupDekCacheRef.current.delete(conversationId);
              result = await loadGroupDek(conversationId);
              return;
            }
            return;
          }

          const membersRes = await apiFetch(`/api/conversations/${conversationId}/members`);
          if (!membersRes.ok) return;
          const members = await membersRes.json();
          if (!Array.isArray(members)) return;

          const bytes = new Uint8Array(32);
          crypto.getRandomValues(bytes);
          const newDek = ethers.hexlify(bytes);
          const wraps = [];
          for (const m of members) {
            const addr = String(m.address || '').toLowerCase();
            if (addr === me) continue;
            const sec = await getSharedSecret(addr);
            if (!sec) return;
            const payload = await encryptMessage(sec, newDek);
            wraps.push({ memberAddress: addr, wrappedBy: user.address, payload });
          }

          if (wraps.length === 0) {
            groupDekCacheRef.current.set(conversationId, newDek);
            result = newDek;
            return;
          }

          const post = await apiFetch(`/api/conversations/${conversationId}/dek-wraps`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wraps }),
          });
          if (!post.ok) {
            if (post.status !== 409) {
              groupDekCacheRef.current.delete(conversationId);
            }
            const retry = await loadGroupDek(conversationId);
            if (retry) {
              result = retry;
            }
            return;
          }
          groupDekCacheRef.current.set(conversationId, newDek);
          result = newDek;
        } catch {
          result = null;
        } finally {
          groupDekEnsureInflightRef.current.delete(id);
          settle(result);
        }
      })();

      return run;
    },
    [encryptionKeys, user?.address, getSharedSecret, loadGroupDek]
  );

  useEffect(() => {
    if (!user) return;

    const walletAddress = (user.address || '').toLowerCase();

    const socket = io('/', {
      auth: {
        address: walletAddress,
        signature,
        message: loginMessage,
      },
    });

    socketRef.current = socket;
    setSocket(socket);

    socket.on('connect', () => {
      if (!signature || !loginMessage) {
        console.warn('MetaWhats: assinatura ou mensagem de login em falta; socket não autenticado.');
        return;
      }
      socket.emit('authenticate', {
        address: walletAddress,
        signature: String(signature).trim(),
        message: loginMessage,
      });
    });

    socket.on('auth_error', (payload) => {
      console.error('Socket auth:', payload?.error ?? payload);
      invalidateSocketAuth();
    });

    socket.on('new_message', async (message) => {
      const current = activeConversationRef.current;
      const mid = msgConversationId(message);
      const isActive = Boolean(current && mid === cid(current));
      if (isActive) {
        const incomingId = String(message.id ?? message._id ?? '');
        if (incomingId && hiddenForMeMessageIdsRef.current.has(incomingId)) {
          return;
        }
        const withReactions = {
          ...message,
          reactions: Array.isArray(message.reactions) ? message.reactions : [],
        };
        const decrypted = await tryDecryptMessage(withReactions);
        setMessages((prev) => [...prev, decrypted]);
        const sender = (
          message.sender_address ??
          message.senderAddress ??
          ''
        ).toLowerCase();
        const msgId = message.id ?? message._id;
        if (sender && sender !== walletAddress && msgId) {
          socket.emit('ack_message_delivery', {
            messageId: msgId,
            conversationId: mid,
          });
        }
      }
    });

    socket.on('conversation_updated', (payload) => {
      const convId = payload.conversationId ?? payload.conversation?.id;
      const lastMessage = payload.lastMessage;
      const conversation = payload.conversation;
      if (!convId) return;

      const active = activeConversationRef.current;
      const activeId = active ? String(cid(active)) : '';
      const convKey = convId != null ? String(convId) : '';
      const isOpen = Boolean(activeId && convKey && activeId === convKey);
      const sender = (
        lastMessage?.sender_address ??
        lastMessage?.senderAddress ??
        ''
      ).toLowerCase();
      const fromOther = Boolean(sender && sender !== walletAddress);

      if (fromOther && !isOpen && !notifMutedConversationsRef.current.has(convKey)) {
        notifyNewMessageGeneric(convId);
      }

      setConversations((prev) => {
        const filtered = prev.filter((c) => c != null);
        const unreadForNew = fromOther && !isOpen ? 1 : 0;
        const lastPreview =
          Number(lastMessage?.encrypted) === 1
            ? '🔒 Mensagem protegida'
            : lastMessage?.content;
        const mergedRow = {
          ...conversation,
          lastMessage,
          updatedAt: lastMessage?.created_at ?? lastMessage?.createdAt,
          last_message_at: lastMessage?.created_at ?? lastMessage?.createdAt,
          last_message_content: lastPreview,
          last_message_type: lastMessage?.type,
          last_message_sender:
            lastMessage?.sender_address ?? lastMessage?.senderAddress,
        };

        const hasConv = filtered.some((c) => cid(c) === convId);
        let next;
        if (!hasConv && conversation) {
          next = [
            {
              ...mergedRow,
              unread_count: unreadForNew,
              unreadCount: unreadForNew,
            },
            ...filtered,
          ];
        } else {
          next = filtered.map((conv) => {
            if (cid(conv) !== convId) return conv;
            const prevUnread =
              Number(conv.unread_count ?? conv.unreadCount ?? 0) || 0;
            let unread = prevUnread;
            if (fromOther) {
              unread = isOpen ? 0 : prevUnread + 1;
            }
            return {
              ...conv,
              ...mergedRow,
              unread_count: unread,
              unreadCount: unread,
            };
          });
        }
        return next.sort(
          (a, b) =>
            new Date(b.updatedAt || b.last_message_at || b.created_at || 0) -
            new Date(a.updatedAt || a.last_message_at || a.created_at || 0)
        );
      });
    });

    socket.on('new_conversation', (conversation) => {
      if (conversation == null || !(conversation.id || conversation._id)) return;
      const gid = String(conversation.id ?? conversation._id);
      setConversations((prev) => [conversation, ...prev.filter((c) => c != null)]);
      if (
        conversation.type === 'group' &&
        encryptionKeys &&
        String(conversation.created_by || '').toLowerCase() === walletAddress
      ) {
        membersByConvRef.current.delete(gid);
        void ensureGroupDek(gid);
      }
    });

    socket.on('user_typing', ({ conversationId, address }) => {
      setTypingUsers((prev) => {
        const next = new Map(prev);
        const users = new Set(next.get(conversationId) || []);
        users.add(address);
        next.set(conversationId, users);
        return next;
      });
    });

    socket.on('user_stop_typing', ({ conversationId, address }) => {
      setTypingUsers((prev) => {
        const next = new Map(prev);
        const users = new Set(next.get(conversationId) || []);
        users.delete(address);
        if (users.size === 0) next.delete(conversationId);
        else next.set(conversationId, users);
        return next;
      });
    });

    socket.on('user_online', (payload) => {
      const addr = typeof payload === 'string' ? payload : payload?.address;
      if (addr) setOnlineUsers((prev) => new Set([...prev, addr.toLowerCase()]));
    });

    socket.on('user_offline', (payload) => {
      const addr = typeof payload === 'string' ? payload : payload?.address;
      if (!addr) return;
      const key = addr.toLowerCase();
      setOnlineUsers((prev) => {
        const next = new Set(prev);
        next.delete(key);
        for (const x of prev) {
          if (typeof x === 'string' && x.toLowerCase() === key) next.delete(x);
        }
        return next;
      });
    });

    socket.on('message_status_updated', ({ messageId, status }) => {
      setMessages((prev) =>
        prev.map((msg) => {
          const id = msg.id ?? msg._id;
          return id === messageId ? { ...msg, status } : msg;
        })
      );
    });

    socket.on('message_reaction_event', (payload) => {
      const conversationId = payload?.conversationId;
      const messageId = payload?.messageId;
      const action = payload?.action;
      const active = activeConversationRef.current;
      if (!active || !conversationId || cid(active) !== conversationId || !messageId) return;

      setMessages((prev) =>
        prev.map((m) => {
          const mid = m.id ?? m._id;
          if (String(mid) !== String(messageId)) return m;
          const existing = Array.isArray(m.reactions) ? m.reactions : [];
          if (action === 'add' && payload.reaction) {
            const r = payload.reaction;
            return {
              ...m,
              reactions: [
                ...existing,
                {
                  id: r.id,
                  user_address: r.user_address,
                  emoji: r.emoji,
                  created_at: r.created_at,
                },
              ],
            };
          }
          if (action === 'remove' && payload.reactionId != null) {
            const rid = Number(payload.reactionId);
            return {
              ...m,
              reactions: existing.filter((x) => Number(x.id) !== rid),
            };
          }
          return m;
        })
      );
    });

    socket.on('conversation_cleared', ({ conversationId }) => {
      const active = activeConversationRef.current;
      const aid = active ? cid(active) : null;
      if (aid && conversationId && aid === conversationId) {
        setMessages([]);
      }
    });

    socket.on('message_deleted', ({ messageId, conversationId }) => {
      const active = activeConversationRef.current;
      if (!active || cid(active) !== conversationId) return;
      setMessages((prev) =>
        prev.filter((m) => String(m.id ?? m._id) !== String(messageId))
      );
    });

    socket.on('conversation_deleted', ({ conversationId }) => {
      if (!conversationId) return;
      groupDekCacheRef.current.delete(conversationId);
      privatePeerByConvRef.current.delete(conversationId);
      membersByConvRef.current.delete(conversationId);
      setConversations((prev) =>
        prev.filter((c) => c != null && cid(c) !== conversationId)
      );
      const active = activeConversationRef.current;
      if (active && cid(active) === conversationId) {
        socketRef.current?.emit('leave_conversation', { conversationId });
        setActiveConversation(null);
        setMessages([]);
      }
    });

    socket.on('group_meta_updated', ({ conversationId, conversation }) => {
      const cidKey = conversationId != null ? String(conversationId) : '';
      if (cidKey) membersByConvRef.current.delete(cidKey);
      setGroupMetaEpoch((e) => e + 1);
      if (conversation && (conversation.id || conversation._id)) {
        const id = String(conversation.id ?? conversation._id);
        setConversations((prev) =>
          prev.map((c) => (c && String(cid(c)) === id ? { ...c, ...conversation } : c))
        );
        const active = activeConversationRef.current;
        if (active && String(cid(active)) === id) {
          setActiveConversation((prev) => (prev ? { ...prev, ...conversation } : prev));
        }
      }
    });

    socket.on('member_removed', ({ conversationId }) => {
      if (conversationId == null) return;
      membersByConvRef.current.delete(String(conversationId));
      setGroupMetaEpoch((e) => e + 1);
    });

    socket.on('group_role_changed', (payload) => {
      const role = payload?.role;
      const convId = payload?.conversationId;
      if (role !== 'admin' || convId == null) return;
      const rawName = payload?.groupName;
      const name =
        typeof rawName === 'string' && rawName.trim().length > 0 ? rawName.trim() : 'Grupo';
      showInfoNotification({
        title: 'MetaWhats',
        body: `Você agora é administrador de «${name}». Abra o grupo para gerenciar permissões.`,
        tag: `openzap-promo-admin-${String(convId)}`,
        silent: false,
        requireBackground: false,
      });
    });

    socket.on('member_added', async ({ conversationId, memberAddress }) => {
      const nek = String(memberAddress || '').toLowerCase();
      if (!nek) return;
      membersByConvRef.current.delete(conversationId);
      setGroupMetaEpoch((e) => e + 1);
      if (nek === walletAddress) {
        groupDekCacheRef.current.delete(conversationId);
        return;
      }
      const dek = groupDekCacheRef.current.get(conversationId);
      if (!dek || !encryptionKeys) return;
      try {
        const sec = await getSharedSecret(nek);
        if (!sec) return;
        const payload = await encryptMessage(sec, dek);
        await apiFetch(`/api/conversations/${conversationId}/dek-wraps`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wraps: [{ memberAddress: nek, wrappedBy: user.address, payload }],
          }),
        });
      } catch {
        /* ignore */
      }
    });

    return () => {
      setSocket(null);
      socketRef.current = null;
      socket.disconnect();
    };
  }, [
    user,
    signature,
    loginMessage,
    tryDecryptMessage,
    invalidateSocketAuth,
    encryptionKeys,
    getSharedSecret,
    ensureGroupDek,
  ]);

  const refreshAgenda = useCallback(async () => {
    if (!user?.address) return;
    try {
      const res = await apiFetch(`/api/contacts/${user.address}`);
      if (!res.ok) return;
      const data = await res.json();
      const m = new Map();
      if (Array.isArray(data)) {
        for (const c of data) {
          const a = String(c.address || '').toLowerCase();
          if (a) m.set(a, c);
        }
      }
      setAgendaByAddress(m);
    } catch {
      /* ignore */
    }
  }, [user?.address]);

  const loadConversations = useCallback(async () => {
    if (!user) return;
    setConversationsReady(false);
    try {
      const res = await apiFetch(`/api/conversations/${user.address}`);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data)
          ? data.filter((c) => c != null && (c.id || c._id))
          : [];
        setConversations(list);
      }
    } catch (err) {
      console.error('Erro ao carregar conversas:', err);
    } finally {
      setConversationsReady(true);
    }
    await refreshAgenda();
  }, [user, refreshAgenda]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    hiddenForMeMessageIdsRef.current = readHiddenMessageIdsFromStorage(user?.address);
  }, [user?.address]);

  useEffect(() => {
    const next = user?.address ? readMutedNotificationConversations(user.address) : new Set();
    setMutedNotificationConversations(next);
    notifMutedConversationsRef.current = next;
  }, [user?.address]);

  useEffect(() => {
    notifMutedConversationsRef.current = mutedNotificationConversations;
  }, [mutedNotificationConversations]);

  const isConversationNotificationMuted = useCallback(
    (conversationId) => {
      if (conversationId == null || conversationId === '') return false;
      return mutedNotificationConversations.has(String(conversationId));
    },
    [mutedNotificationConversations]
  );

  const setConversationNotificationMuted = useCallback(
    (conversationId, muted) => {
      if (!user?.address || conversationId == null || conversationId === '') return;
      const key = String(conversationId);
      const next = new Set(readMutedNotificationConversations(user.address));
      if (muted) next.add(key);
      else next.delete(key);
      writeMutedNotificationConversations(user.address, next);
      setMutedNotificationConversations(next);
    },
    [user?.address]
  );

  const muteAllConversationNotifications = useCallback(() => {
    if (!user?.address) return;
    const next = new Set(readMutedNotificationConversations(user.address));
    for (const c of conversations) {
      if (!c) continue;
      const id = String(c._id ?? c.id ?? '');
      if (id) next.add(id);
    }
    writeMutedNotificationConversations(user.address, next);
    setMutedNotificationConversations(next);
  }, [user?.address, conversations]);

  const unmuteAllConversationNotifications = useCallback(() => {
    if (!user?.address) return;
    const next = new Set();
    writeMutedNotificationConversations(user.address, next);
    setMutedNotificationConversations(next);
  }, [user?.address]);

  const loadMessages = useCallback(async (conversationId, before = null) => {
    try {
      let url = `/api/conversations/${conversationId}/messages`;
      if (before) url += `?before=${before}`;
      const res = await apiFetch(url);
      if (res.ok) {
        const raw = await res.json();
        const data = Array.isArray(raw) ? raw : [];
        const decrypted = await decryptMessages(data);
        hiddenForMeMessageIdsRef.current = readHiddenMessageIdsFromStorage(user?.address);
        const filtered = decrypted.filter(
          (m) => !hiddenForMeMessageIdsRef.current.has(String(m.id ?? m._id))
        );
        if (before) {
          setMessages((prev) => [...filtered, ...prev]);
        } else {
          setMessages(filtered);
        }
        return data;
      }
    } catch (err) {
      console.error('Erro ao carregar mensagens:', err);
    }
    return [];
  }, [decryptMessages, user?.address]);

  /** Limpa caches de ECDH/DEK e volta a pedir mensagens ao servidor (texto cifrado original). */
  const reloadActiveConversationMessages = useCallback(async () => {
    const conv = activeConversationRef.current;
    if (!conv) return;
    const id = cid(conv);
    if (!id) return;
    sharedSecretsRef.current.clear();
    groupDekCacheRef.current.delete(id);
    membersByConvRef.current.delete(id);
    await loadMessages(id, null);
  }, [loadMessages]);

  useEffect(() => {
    const now = Boolean(encryptionKeys);
    const had = hadEncryptionKeysRef.current;
    hadEncryptionKeysRef.current = now;
    if (!now || had) return;
    const conv = activeConversationRef.current;
    if (!conv) return;
    const id = cid(conv);
    if (!id) return;
    void loadMessages(id, null);
  }, [encryptionKeys, loadMessages]);

  const selectConversation = useCallback(async (conversation) => {
    const prev = activeConversationRef.current;
    const prevId = prev ? cid(prev) : null;
    const nextId = conversation ? cid(conversation) : null;
    if (prevId && prevId !== nextId) {
      socketRef.current?.emit('leave_conversation', { conversationId: prevId });
    }

    if (conversation) {
      const id = cid(conversation);
      setConversations((prev) =>
        prev.map((c) =>
          cid(c) === id ? { ...c, unread_count: 0, unreadCount: 0 } : c
        )
      );
    }
    setActiveConversation(conversation);
    if (conversation) {
      setComposerFocusNonce((n) => n + 1);
      const id = cid(conversation);
      const loadGen = ++messagesLoadGenRef.current;
      setMessages([]);
      setMessagesLoading(true);
      if (conversation.type === 'private' && user?.address) {
        try {
          const res = await apiFetch(`/api/conversations/${id}/members`);
          if (res.ok) {
            const members = await res.json();
            if (Array.isArray(members)) {
              membersByConvRef.current.set(id, members);
            }
            const me = user.address.toLowerCase();
            const other = Array.isArray(members)
              ? members.find((m) => (m.address || '').toLowerCase() !== me)
              : null;
            if (other?.address) {
              privatePeerByConvRef.current.set(id, String(other.address).toLowerCase());
            } else {
              privatePeerByConvRef.current.delete(id);
            }
          }
        } catch {
          privatePeerByConvRef.current.delete(id);
        }
      }
      socketRef.current?.emit('join_conversation', { conversationId: id });
      try {
        await loadMessages(id);
      } finally {
        if (loadGen === messagesLoadGenRef.current) {
          setMessagesLoading(false);
        }
      }
    } else {
      messagesLoadGenRef.current += 1;
      setMessagesLoading(false);
      setMessages([]);
    }
  }, [loadMessages, user?.address]);

  const refocusComposer = useCallback(() => {
    setComposerFocusNonce((n) => n + 1);
  }, []);

  const sendMessage = useCallback(
    async (content, type = 'text', replyTo = null, fileName = null, fileSize = null) => {
      if (!socketRef.current || !activeConversation) {
        return { ok: false, error: 'no_active' };
      }
      if (!user?.address) {
        return { ok: false, error: 'no_user' };
      }

      const needsE2E = type !== 'system';
      if (needsE2E && !encryptionKeys) {
        return { ok: false, error: 'no_e2e_keys' };
      }

      const convId = cid(activeConversation);
      const isPrivate = activeConversation.type === 'private';
      const isGroup = activeConversation.type === 'group';

      if (isGroup && Number(activeConversation.group_only_admins_post) === 1) {
        const memb = await fetchMembersForConv(convId);
        const meAddr = (user.address ?? '').toLowerCase();
        const row = Array.isArray(memb)
          ? memb.find((m) => (m.address ?? '').toLowerCase() === meAddr)
          : null;
        if (row?.role !== 'admin') {
          return { ok: false, error: 'group_admin_only' };
        }
      }

      let finalContent = content;
      let encrypted = false;

      if (encryptionKeys && needsE2E) {
        const signedInner = encodeSignedPlaintextPayload(String(content ?? ''), encryptionKeys.privateKey);

        if (isPrivate) {
          const members = await fetchMembersForConv(convId);
          const me = (user.address ?? '').toLowerCase();
          const other = Array.isArray(members)
            ? members.find((m) => (m.address ?? '').toLowerCase() !== me)
            : null;
          if (!other?.address) {
            return { ok: false, error: 'private_peer' };
          }
          const theirPk = await fetchPublicKey(other.address);
          if (!theirPk) {
            return { ok: false, error: 'peer_no_keys' };
          }
          const secret = await getSharedSecret(other.address);
          if (!secret) {
            return { ok: false, error: 'no_shared_secret' };
          }
          finalContent = await encryptMessage(secret, signedInner);
          encrypted = true;
        } else if (isGroup) {
          const dek = await ensureGroupDek(convId);
          if (!dek) {
            return { ok: false, error: 'no_group_dek' };
          }
          finalContent = await encryptMessage(dek, signedInner);
          encrypted = true;
        }
      }

      if (needsE2E && !encrypted) {
        return { ok: false, error: 'encrypt_failed' };
      }

      socketRef.current.emit('send_message', {
        conversationId: convId,
        sender: user.address,
        content: finalContent,
        type,
        replyTo,
        encrypted,
        fileName,
        fileSize,
      });
      return { ok: true };
    },
    [
      activeConversation,
      user,
      encryptionKeys,
      getSharedSecret,
      ensureGroupDek,
      fetchMembersForConv,
      fetchPublicKey,
    ]
  );

  const resolveE2eAttachmentUrl = useCallback(
    async (message, meta) => {
      if (!encryptionKeys) throw new Error('no_e2e');
      if (!meta || !isSafeAttachmentUrl(meta.u)) throw new Error('invalid_url');
      const convId = msgConversationId(message);
      const sender = (message.sender_address ?? message.senderAddress ?? '').toLowerCase();
      const key = await getAesKeyForMessage(convId, sender);
      if (!key) throw new Error('no_key');
      const r = await fetch(meta.u);
      if (!r.ok) throw new Error('fetch_failed');
      const encBytes = new Uint8Array(await r.arrayBuffer());
      const plain = await decryptBinary(key, encBytes);
      const safeMime = typeof meta.m === 'string' && meta.m.length < 128
        ? meta.m
        : 'application/octet-stream';
      const blob = new Blob([plain], { type: safeMime });
      return URL.createObjectURL(blob);
    },
    [encryptionKeys, getAesKeyForMessage]
  );

  const uploadEncryptedFileAndSend = useCallback(
    async (file) => {
      if (!file || !socketRef.current || !activeConversation || !encryptionKeys || !user?.address) {
        return { ok: false, error: 'no_e2e_keys' };
      }
      const convId = cid(activeConversation);
      const isPrivate = activeConversation.type === 'private';
      const isGroup = activeConversation.type === 'group';

      if (isGroup && Number(activeConversation.group_only_admins_post) === 1) {
        const memb = await fetchMembersForConv(convId);
        const meAddr = user.address.toLowerCase();
        const row = Array.isArray(memb)
          ? memb.find((m) => (m.address ?? '').toLowerCase() === meAddr)
          : null;
        if (row?.role !== 'admin') {
          return { ok: false, error: 'group_admin_only' };
        }
      }

      let keyHex = null;
      if (isPrivate) {
        const members = await fetchMembersForConv(convId);
        const me = user.address.toLowerCase();
        const other = Array.isArray(members)
          ? members.find((m) => (m.address ?? '').toLowerCase() !== me)
          : null;
        if (!other?.address) return { ok: false, error: 'private_peer' };
        const theirPk = await fetchPublicKey(other.address);
        if (!theirPk) return { ok: false, error: 'peer_no_keys' };
        keyHex = await getSharedSecret(other.address);
        if (!keyHex) return { ok: false, error: 'no_shared_secret' };
      } else if (isGroup) {
        keyHex = await ensureGroupDek(convId);
        if (!keyHex) return { ok: false, error: 'no_group_dek' };
      }
      if (!keyHex) return { ok: false, error: 'encrypt_failed' };

      const plain = new Uint8Array(await file.arrayBuffer());
      const enc = await encryptBinary(keyHex, plain);
      const blob = new Blob([enc], { type: 'application/octet-stream' });
      const upName = `${(file.name || 'file').replace(/[/\\]/g, '_')}.e2e`;
      const upFile = new File([blob], upName, { type: 'application/octet-stream' });
      const fd = new FormData();
      fd.append('file', upFile);
      const res = await apiFetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) return { ok: false, error: 'upload_failed' };
      const data = await res.json();
      if (!data.url) return { ok: false, error: 'upload_failed' };

      const kind = detectAttachmentKind(file);
      const meta = JSON.stringify({
        _e2ef: 1,
        u: data.url,
        m: file.type || 'application/octet-stream',
        n: file.name || 'anexo',
        s: file.size,
      });
      return sendMessage(meta, kind, null, null, null);
    },
    [
      activeConversation,
      user,
      encryptionKeys,
      fetchMembersForConv,
      fetchPublicKey,
      getSharedSecret,
      ensureGroupDek,
      sendMessage,
    ]
  );

  const startTyping = useCallback(() => {
    if (!socketRef.current || !activeConversation) return;
    socketRef.current.emit('typing', {
      conversationId: cid(activeConversation),
      address: user.address,
    });
  }, [activeConversation, user]);

  const stopTyping = useCallback(() => {
    if (!socketRef.current || !activeConversation) return;
    socketRef.current.emit('stop_typing', {
      conversationId: cid(activeConversation),
      address: user.address,
    });
  }, [activeConversation, user]);

  const createGroup = useCallback((name, members) => {
    if (!socketRef.current) return;
    socketRef.current.emit('create_group', {
      name,
      members,
      creator: user.address,
    });
  }, [user]);

  const startPrivateChat = useCallback(async (contactAddress) => {
    try {
      const res = await apiFetch('/api/conversations/private', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participants: [user.address, contactAddress],
        }),
      });
      if (res.ok) {
        const conversation = await res.json();
        if (conversation == null || !(conversation.id || conversation._id)) return null;
        const exists = conversations.find((c) => c && cid(c) === cid(conversation));
        if (!exists) {
          setConversations((prev) => [conversation, ...prev.filter((c) => c != null)]);
        }
        navigate(`/c/${cid(conversation)}`, { replace: false });
        return conversation;
      }
    } catch (err) {
      console.error('Erro ao iniciar conversa privada:', err);
    }
    return null;
  }, [user, conversations, navigate]);

  const markAsRead = useCallback((messageId) => {
    if (!socketRef.current || !activeConversation) return;
    const convId = activeConversation._id ?? activeConversation.id;
    socketRef.current.emit('message_read', {
      messageId,
      conversationId: convId,
    });
  }, [activeConversation]);

  const clearConversation = useCallback(async (conversationId) => {
    if (!conversationId) return false;
    try {
      const res = await apiFetch(`/api/conversations/${conversationId}/messages`, {
        method: 'DELETE',
      });
      if (!res.ok) return false;
      const active = activeConversationRef.current;
      const aid = active ? cid(active) : null;
      if (aid === conversationId) setMessages([]);
      return true;
    } catch (err) {
      console.error('Erro ao limpar conversa:', err);
      return false;
    }
  }, []);

  const deleteConversationForUser = useCallback(
    async (conversationId) => {
      if (!user?.address || !conversationId) return false;
      try {
        const res = await apiFetch(`/api/conversations/${conversationId}/leave`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: user.address }),
        });
        if (!res.ok) return false;
        groupDekCacheRef.current.delete(conversationId);
        privatePeerByConvRef.current.delete(conversationId);
        membersByConvRef.current.delete(conversationId);
        const active = activeConversationRef.current;
        if (active && cid(active) === conversationId) {
          navigate('/', { replace: true });
        }
        setConversations((prev) =>
          prev.filter((c) => c != null && cid(c) !== conversationId)
        );
        return true;
      } catch (err) {
        console.error('Erro ao apagar conversa:', err);
        return false;
      }
    },
    [user?.address, navigate]
  );

  const deleteConversationForEveryone = useCallback(
    async (conversationId) => {
      if (!user?.address || !conversationId) return false;
      try {
        const res = await apiFetch(`/api/conversations/${conversationId}/delete-for-everyone`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: user.address }),
        });
        if (!res.ok) return false;
        groupDekCacheRef.current.delete(conversationId);
        privatePeerByConvRef.current.delete(conversationId);
        membersByConvRef.current.delete(conversationId);
        const active = activeConversationRef.current;
        if (active && cid(active) === conversationId) {
          navigate('/', { replace: true });
        }
        setConversations((prev) =>
          prev.filter((c) => c != null && cid(c) !== conversationId)
        );
        return true;
      } catch (err) {
        console.error('Erro ao apagar conversa para todos:', err);
        return false;
      }
    },
    [user?.address, navigate]
  );

  const updateGroupSettings = useCallback(async (conversationId, onlyAdminsPost) => {
    try {
      const res = await apiFetch(`/api/conversations/${conversationId}/group-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onlyAdminsPost }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const setGroupMemberRole = useCallback(async (conversationId, memberAddress, role) => {
    try {
      const enc = encodeURIComponent(String(memberAddress));
      const res = await apiFetch(`/api/conversations/${conversationId}/members/${enc}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const j = await res.json().catch(() => ({}));
      return { ok: res.ok, error: j.error };
    } catch {
      return { ok: false, error: 'network' };
    }
  }, []);

  const deleteMessageForEveryone = useCallback(async (messageId) => {
    if (!user?.address || !messageId) return false;
    try {
      const res = await apiFetch(`/api/messages/${messageId}/delete-for-everyone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: user.address }),
      });
      if (!res.ok) return false;
      setMessages((prev) =>
        prev.filter((m) => String(m.id ?? m._id) !== String(messageId))
      );
      return true;
    } catch (err) {
      console.error('Erro ao apagar mensagem:', err);
      return false;
    }
  }, [user?.address]);

  const deleteMessageForMe = useCallback(
    (messageId) => {
      if (!user?.address || !messageId) return;
      const id = String(messageId);
      hiddenForMeMessageIdsRef.current.add(id);
      writeHiddenMessageIdsToStorage(user.address, hiddenForMeMessageIdsRef.current);
      setMessages((prev) => prev.filter((m) => String(m.id ?? m._id) !== id));
    },
    [user?.address]
  );

  const emitAddReaction = useCallback((messageId, conversationId, emoji) => {
    if (!messageId || !conversationId || emoji == null) return;
    socketRef.current?.emit('add_message_reaction', {
      messageId,
      conversationId,
      emoji,
    });
  }, []);

  const emitRemoveReaction = useCallback((reactionId, conversationId) => {
    if (reactionId == null || !conversationId) return;
    socketRef.current?.emit('remove_message_reaction', {
      reactionId,
      conversationId,
    });
  }, []);

  return (
    <ChatContext.Provider
      value={{
        conversations,
        conversationsReady,
        activeConversation,
        messages,
        onlineUsers,
        typingUsers,
        socketRef,
        socket,
        loadConversations,
        agendaByAddress,
        refreshAgenda,
        selectConversation,
        refocusComposer,
        composerFocusNonce,
        messagesLoading,
        loadMessages,
        sendMessage,
        startTyping,
        stopTyping,
        createGroup,
        startPrivateChat,
        markAsRead,
        clearConversation,
        deleteConversationForUser,
        deleteConversationForEveryone,
        deleteMessageForEveryone,
        deleteMessageForMe,
        emitAddReaction,
        emitRemoveReaction,
        uploadEncryptedFileAndSend,
        resolveE2eAttachmentUrl,
        reloadActiveConversationMessages,
        groupMetaEpoch,
        updateGroupSettings,
        setGroupMemberRole,
        isConversationNotificationMuted,
        setConversationNotificationMuted,
        muteAllConversationNotifications,
        unmuteAllConversationNotifications,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat deve ser usado dentro de um ChatProvider');
  }
  return context;
}
