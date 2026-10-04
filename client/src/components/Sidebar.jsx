import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  IoChatbubbleEllipses,
  IoEllipsisVertical,
  IoArchiveOutline,
  IoTrashOutline,
} from 'react-icons/io5';
import { HiMagnifyingGlass, HiUserGroup, HiArrowUturnLeft } from 'react-icons/hi2';
import { useAuth } from '../contexts/AuthContext';
import { useChat } from '../contexts/ChatContext';
import NewChatModal from './NewChatModal';
import NewGroupModal from './NewGroupModal';
import ProfilePanel from './ProfilePanel';
import PwaInstallBar from './PwaInstallBar';
import NotificationPermissionStrip from './NotificationPermissionStrip';
import ConfirmActionSheet from './shell/ConfirmActionSheet';
import { parseServerDate, formatSidebarListTime } from '../utils/brDateTime';
import {
  loadArchivedConversationIds,
  saveArchivedConversationIds,
  removeArchivedId,
} from '../utils/archiveStorage';

function addressToColor(address) {
  const colors = [
    '#10B981',
    '#7C3AED',
    '#F59E0B',
    '#53bdeb',
    '#e9a228',
    '#e86c6c',
    '#a86ce8',
    '#6ce8a8',
    '#e8a86c',
    '#6ca8e8',
  ];
  const hash = address.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

function convId(conv) {
  if (conv == null) return undefined;
  return conv._id ?? conv.id;
}

function truncateAddress(addr) {
  if (!addr || typeof addr !== 'string') return '';
  const a = addr.startsWith('0x') ? addr : `0x${addr}`;
  if (a.length <= 13) return a;
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

function getLastMessage(conv) {
  if (!conv) return null;
  if (conv.lastMessage) return conv.lastMessage;
  if (conv.last_message_content != null || conv.last_message_type) {
    return {
      content: conv.last_message_content,
      type: conv.last_message_type,
      sender_address: conv.last_message_sender,
      created_at: conv.last_message_at,
      createdAt: conv.last_message_at,
    };
  }
  return null;
}

function getLastMessageTime(conv, lastMsg) {
  const raw =
    lastMsg?.created_at ||
    lastMsg?.createdAt ||
    conv.updatedAt ||
    conv.last_message_at ||
    conv.created_at;
  return parseServerDate(raw);
}

function previewText(lastMsg) {
  if (!lastMsg) return '';
  const t = lastMsg.type;
  if (t === 'payment') return '💰 Pagamento';
  if (t === 'image') return '📷 Foto';
  if (t === 'file') return '📎 Arquivo';
  if (t === 'audio') return '🎵 Áudio';
  if (t === 'video') return '🎥 Vídeo';
  if (t === 'system') return lastMsg.content || '';
  const content = lastMsg.content || '';
  if (Number(lastMsg.encrypted) === 1 || lastMsg.encrypted === true) return '🔒 Mensagem criptografada';
  const base = content.trim();
  if (base.length <= 40) return base;
  return `${base.slice(0, 37)}…`;
}

function getPrivatePeerAddress(conv, user) {
  if (!conv || conv.type !== 'private') return '';
  const uid = user?.address?.toLowerCase();
  if (conv.peer_address) return String(conv.peer_address).toLowerCase();
  if (conv.peerAddress) return String(conv.peerAddress).toLowerCase();
  if (Array.isArray(conv.participants)) {
    const other = conv.participants.find((p) => (p || '').toLowerCase() !== uid);
    if (other) return String(other).toLowerCase();
  }
  const last = getLastMessage(conv);
  const sender = (last?.sender_address || last?.senderAddress || '').toLowerCase();
  if (sender && uid && sender !== uid) return sender;
  return '';
}

function displayNameForConversation(conv, user, agendaByAddress) {
  const map = agendaByAddress instanceof Map ? agendaByAddress : new Map();
  if (!conv) return '';
  const uid = user?.address?.toLowerCase();
  if (conv.type === 'group') {
    return conv.name?.trim() || 'Grupo';
  }
  const peer = getPrivatePeerAddress(conv, user);
  if (peer) {
    const row = map.get(peer);
    if (row?.apelido?.trim()) return row.apelido.trim();
    if (row?.nickname?.trim()) return row.nickname.trim();
    const pub = String(conv.peer_nickname || '').trim();
    if (pub) return pub;
    return truncateAddress(peer);
  }
  const pubOnly = String(conv.peer_nickname || '').trim();
  if (pubOnly) return pubOnly;
  if (conv.name?.trim()) return conv.name.trim();
  if (conv.nickname?.trim()) return conv.nickname.trim();
  if (conv.peerNickname?.trim()) return conv.peerNickname.trim();
  if (conv.peer_address) return truncateAddress(conv.peer_address);
  if (conv.peerAddress) return truncateAddress(conv.peerAddress);
  const last = getLastMessage(conv);
  const sender = (last?.sender_address || last?.senderAddress || '').toLowerCase();
  if (sender && uid && sender !== uid) return truncateAddress(last.sender_address || last.senderAddress);
  if (Array.isArray(conv.participants)) {
    const other = conv.participants.find((p) => (p || '').toLowerCase() !== uid);
    if (other) return truncateAddress(other);
  }
  return 'Conversa privada';
}

function privatePeerAvatarUrl(conv, user, agendaByAddress) {
  if (!conv || conv.type !== 'private') return null;
  const map = agendaByAddress instanceof Map ? agendaByAddress : new Map();
  const peer = getPrivatePeerAddress(conv, user);
  if (peer) {
    const row = map.get(peer);
    const a = row?.avatar != null ? String(row.avatar).trim() : '';
    if (a) return a;
  }
  const fromConv = conv.peer_avatar != null ? String(conv.peer_avatar).trim() : '';
  return fromConv || null;
}

function avatarKeyForConversation(conv, user) {
  if (conv.type === 'group' && conv.name) return conv.name;
  if (conv.peer_address) return conv.peer_address;
  if (conv.peerAddress) return conv.peerAddress;
  const last = getLastMessage(conv);
  const sender = last?.sender_address || last?.senderAddress;
  const uid = user?.address?.toLowerCase();
  if (sender && (sender || '').toLowerCase() !== uid) return sender;
  if (Array.isArray(conv.participants)) {
    const other = conv.participants.find((p) => (p || '').toLowerCase() !== uid);
    if (other) return other;
  }
  return convId(conv) || '0x0';
}

function initialsForConversation(conv, user, agendaByAddress) {
  if (!conv) return '?';
  const name = displayNameForConversation(conv, user, agendaByAddress);
  if (name.startsWith('0x') || name.includes('...')) {
    const hex = name.replace(/^0x/i, '').replace(/\./g, '');
    return (hex.slice(0, 2) || '??').toUpperCase();
  }
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (name.slice(0, 2) || '?').toUpperCase();
}

function unreadCount(conv) {
  if (!conv) return 0;
  const n = conv.unread_count ?? conv.unreadCount ?? 0;
  return typeof n === 'number' ? n : parseInt(n, 10) || 0;
}

function normalizeOnlineUsers(onlineUsers) {
  const out = new Set();
  if (!onlineUsers) return out;
  if (onlineUsers instanceof Set) {
    for (const item of onlineUsers) {
      if (typeof item === 'string') out.add(item.toLowerCase());
      else if (item && typeof item === 'object' && item.address)
        out.add(String(item.address).toLowerCase());
    }
  }
  return out;
}

function isPeerOnline(conv, user, onlineSet) {
  if (!conv || conv.type === 'group') return false;
  const uid = user?.address?.toLowerCase();
  const last = getLastMessage(conv);
  const sender = (last?.sender_address || last?.senderAddress || '').toLowerCase();
  let peer = conv.peer_address || conv.peerAddress;
  if (!peer && Array.isArray(conv.participants)) {
    peer = conv.participants.find((p) => (p || '').toLowerCase() !== uid);
  }
  if (!peer && sender && sender !== uid) peer = last?.sender_address || last?.senderAddress;
  if (!peer) return false;
  return onlineSet.has(String(peer).toLowerCase());
}

function othersTyping(conv, user, typingUsers) {
  const id = convId(conv);
  if (!id || !typingUsers) return false;
  const set = typingUsers.get(id);
  if (!set || set.size === 0) return false;
  const me = (user?.address || '').toLowerCase();
  for (const addr of set) {
    const a = typeof addr === 'string' ? addr.toLowerCase() : String(addr?.address || '').toLowerCase();
    if (a && a !== me) return true;
  }
  return false;
}

function matchesSearch(conv, user, q, agendaByAddress) {
  if (!conv) return false;
  if (!q) return true;
  const name = displayNameForConversation(conv, user, agendaByAddress).toLowerCase();
  const last = getLastMessage(conv);
  const prev = (last?.content || '').toLowerCase();
  return name.includes(q) || prev.includes(q);
}

export default function Sidebar() {
  const navigate = useNavigate();
  const { user, disconnect } = useAuth();
  const {
    conversations,
    agendaByAddress,
    activeConversation,
    refocusComposer,
    onlineUsers,
    typingUsers,
    startPrivateChat,
    createGroup,
    deleteConversationForUser,
    deleteConversationForEveryone,
  } = useChat();

  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [archivedIds, setArchivedIds] = useState(() => new Set());
  const [pendingDelete, setPendingDelete] = useState(null);
  const menuRef = useRef(null);

  const onlineSet = useMemo(() => normalizeOnlineUsers(onlineUsers), [onlineUsers]);

  useEffect(() => {
    if (!user?.address) {
      setArchivedIds(new Set());
      return;
    }
    setArchivedIds(loadArchivedConversationIds(user.address));
  }, [user?.address]);

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => c != null && matchesSearch(c, user, q, agendaByAddress));
  }, [conversations, search, user, agendaByAddress]);

  const mainList = useMemo(
    () => searched.filter((c) => !archivedIds.has(String(convId(c)))),
    [searched, archivedIds]
  );

  const archivedList = useMemo(
    () => searched.filter((c) => archivedIds.has(String(convId(c)))),
    [searched, archivedIds]
  );

  const archiveConversation = useCallback(
    (id) => {
      if (!id || !user?.address) return;
      setArchivedIds((prev) => {
        const next = new Set(prev);
        next.add(String(id));
        saveArchivedConversationIds(user.address, next);
        return next;
      });
      if (activeConversation && String(convId(activeConversation)) === String(id)) {
        navigate('/', { replace: true });
      }
    },
    [user?.address, activeConversation, navigate]
  );

  const unarchiveConversation = useCallback(
    (id) => {
      if (!id || !user?.address) return;
      setArchivedIds((prev) => {
        const next = new Set(prev);
        next.delete(String(id));
        saveArchivedConversationIds(user.address, next);
        return next;
      });
    },
    [user?.address]
  );

  const clearArchivedForDeletedConv = useCallback(
    (id) => {
      if (!id || !user?.address) return;
      removeArchivedId(user.address, id);
      setArchivedIds((prev) => {
        const next = new Set(prev);
        next.delete(String(id));
        saveArchivedConversationIds(user.address, next);
        return next;
      });
    },
    [user?.address]
  );

  const deleteConversationSelf = useCallback(async () => {
    if (!pendingDelete?.id || !user?.address) return;
    const id = pendingDelete.id;
    clearArchivedForDeletedConv(id);
    setPendingDelete(null);
    const ok = await deleteConversationForUser(id);
    if (!ok) window.alert('Não foi possível remover a conversa.');
  }, [
    pendingDelete,
    user?.address,
    clearArchivedForDeletedConv,
    deleteConversationForUser,
  ]);

  const deleteConversationEveryone = useCallback(async () => {
    if (!pendingDelete?.id || !user?.address) return;
    const id = pendingDelete.id;
    const conv = pendingDelete.conv;
    const me = (user?.address || '').toLowerCase();
    const canEveryone =
      conv &&
      (conv.type === 'private' ||
        (conv.type === 'group' &&
          String(conv.my_member_role || '').toLowerCase() === 'admin'));
    if (!canEveryone) return;
    clearArchivedForDeletedConv(id);
    setPendingDelete(null);
    const ok = await deleteConversationForEveryone(id);
    if (!ok) {
      window.alert(
        'Não foi possível apagar a conversa para todos (verifique permissões).'
      );
    }
  }, [
    pendingDelete,
    user?.address,
    clearArchivedForDeletedConv,
    deleteConversationForEveryone,
  ]);

  useEffect(() => {
    if (!user?.address) return;
    setArchivedIds((prev) => {
      const validIds = new Set(
        conversations.filter(Boolean).map((c) => String(convId(c)))
      );
      const next = new Set([...prev].filter((x) => validIds.has(x)));
      if (next.size === prev.size) return prev;
      saveArchivedConversationIds(user.address, next);
      return next;
    });
  }, [conversations, user?.address]);

  const renderConversationRow = (conv, index, inArchive) => {
    const id = convId(conv);
    const active = convId(activeConversation) === id;
    const lastMsg = getLastMessage(conv);
    const when = getLastMessageTime(conv, lastMsg);
    const typing = othersTyping(conv, user, typingUsers);
    const unread = unreadCount(conv);
    const title = displayNameForConversation(conv, user, agendaByAddress);
    const keyStr = avatarKeyForConversation(conv, user);
    const bg = addressToColor(String(keyStr));
    const initials = initialsForConversation(conv, user, agendaByAddress);
    const peerAvatarUrl = privatePeerAvatarUrl(conv, user, agendaByAddress);
    const online = isPeerOnline(conv, user, onlineSet);

    return (
      <li
        key={id != null ? String(id) : `conv-${index}-${inArchive ? 'a' : 'm'}`}
        className="group px-2 py-0.5"
      >
        <div className="flex min-h-[52px] items-stretch rounded-xl transition-colors hover:bg-white/[0.03]">
          <button
            type="button"
            role="option"
            aria-selected={active}
            onClick={() => {
              const sid = String(id);
              const aid = activeConversation ? String(convId(activeConversation)) : '';
              if (aid && aid === sid) refocusComposer();
              navigate(`/c/${sid}`);
            }}
            className={`flex min-w-0 flex-1 items-stretch gap-3 rounded-xl px-2.5 py-2 text-left transition sm:px-3 ${
              active
                ? 'bg-white/[0.07] ring-1 ring-white/[0.06]'
                : 'hover:bg-white/[0.04]'
            }`}
          >
            <div className="relative shrink-0">
              <div
                className="flex h-12 w-12 items-center justify-center rounded-full text-[15px] font-medium text-white/95 overflow-hidden"
                style={{
                  backgroundColor:
                    (conv.type === 'group' && conv.avatar) || peerAvatarUrl ? 'transparent' : bg,
                }}
              >
                {conv.type === 'group' && conv.avatar ? (
                  <img src={conv.avatar} alt="" className="h-full w-full rounded-full object-cover" />
                ) : peerAvatarUrl ? (
                  <img src={peerAvatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
                ) : (
                  initials
                )}
              </div>
              {online && (
                <span
                  className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-whatsapp-dark bg-whatsapp-green"
                  title="Online"
                />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[16px] font-medium leading-tight tracking-tight text-whatsapp-text">
                  {title}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-whatsapp-text-secondary">
                  {typing ? '' : formatSidebarListTime(when)}
                </span>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-2">
                <span
                  className={`min-w-0 truncate text-[15px] sm:text-sm ${
                    typing ? 'font-normal text-whatsapp-green' : 'text-whatsapp-text-secondary'
                  }`}
                >
                  {typing ? 'digitando...' : previewText(lastMsg)}
                </span>
                {unread > 0 && !typing && (
                  <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-whatsapp-green/20 px-1.5 text-[11px] font-semibold text-whatsapp-green">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </div>
            </div>
          </button>

          <div className="flex shrink-0 items-center gap-0 pr-0.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100 sm:pr-1">
            {inArchive ? (
              <button
                type="button"
                title="Desarquivar"
                aria-label="Desarquivar conversa"
                onClick={(e) => {
                  e.stopPropagation();
                  unarchiveConversation(id);
                }}
                className="rounded-full p-2 text-whatsapp-text-secondary transition hover:bg-white/10 hover:text-whatsapp-text"
              >
                <HiArrowUturnLeft className="h-5 w-5" />
              </button>
            ) : (
              <button
                type="button"
                title="Arquivar"
                aria-label="Arquivar conversa"
                onClick={(e) => {
                  e.stopPropagation();
                  archiveConversation(id);
                }}
                className="rounded-full p-2 text-whatsapp-text-secondary transition hover:bg-white/10 hover:text-whatsapp-text"
              >
                <IoArchiveOutline className="h-5 w-5" />
              </button>
            )}
            <button
              type="button"
              title="Apagar conversa"
              aria-label="Apagar conversa"
              onClick={(e) => {
                e.stopPropagation();
                setPendingDelete({ id, title, conv });
              }}
              className="rounded-full p-2 text-whatsapp-text-secondary transition hover:bg-red-500/20 hover:text-red-300"
            >
              <IoTrashOutline className="h-5 w-5" />
            </button>
          </div>
        </div>
      </li>
    );
  };

  useEffect(() => {
    function onDocClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  const userInitials = useMemo(() => {
    const addr = user?.address || '';
    const clean = addr.replace(/^0x/i, '');
    return (clean.slice(0, 2) || 'OZ').toUpperCase();
  }, [user?.address]);

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 flex-col bg-whatsapp-sidebar overflow-hidden">
      <header className="flex min-h-[52px] shrink-0 items-center justify-between border-b border-white/[0.06] bg-whatsapp-header px-3 pl-3.5 pr-2 pt-[max(0.25rem,env(safe-area-inset-top))] pb-2.5 sm:h-[3.25rem] sm:min-h-0 sm:py-0 sm:pb-0 sm:pt-[max(0px,env(safe-area-inset-top))]">
        <button
          type="button"
          aria-label="Perfil"
          onClick={() => setProfileOpen(true)}
          className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-medium text-white transition hover:opacity-90"
        >
          {user?.avatar ? (
            <img src={user.avatar} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center bg-whatsapp-green">{userInitials}</span>
          )}
        </button>

        <div className="flex shrink-0 items-center gap-0.5 text-whatsapp-text-secondary">
          <button
            type="button"
            aria-label="Novo grupo"
            onClick={() => {
              setNewGroupOpen(true);
              setMenuOpen(false);
            }}
            className="rounded-full p-2.5 text-whatsapp-text-secondary transition hover:bg-white/[0.06] hover:text-whatsapp-text"
          >
            <HiUserGroup className="h-[22px] w-[22px]" />
          </button>
          <button
            type="button"
            aria-label="Nova conversa"
            onClick={() => setNewChatOpen(true)}
            className="rounded-full p-2.5 text-whatsapp-text-secondary transition hover:bg-white/[0.06] hover:text-whatsapp-text"
          >
            <IoChatbubbleEllipses className="h-[22px] w-[22px]" />
          </button>
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="Menu"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((o) => !o);
              }}
              className="rounded-full p-2.5 text-whatsapp-text-secondary transition hover:bg-white/[0.06] hover:text-whatsapp-text"
            >
              <IoEllipsisVertical className="h-[22px] w-[22px]" />
            </button>
            {menuOpen && (
              <ul
                role="menu"
                className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-xl border border-white/[0.08] bg-[#141416] py-1.5 shadow-2xl shadow-black/60"
              >
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full px-4 py-2.5 text-left text-sm text-whatsapp-text hover:bg-white/[0.06]"
                    onClick={() => {
                      setMenuOpen(false);
                      setNewGroupOpen(true);
                    }}
                  >
                    Novo grupo
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full px-4 py-2.5 text-left text-sm text-whatsapp-text hover:bg-white/[0.06]"
                    onClick={() => {
                      setMenuOpen(false);
                      setProfileOpen(true);
                    }}
                  >
                    Perfil
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full px-4 py-2.5 text-left text-sm text-whatsapp-text hover:bg-white/[0.06]"
                    onClick={() => {
                      setMenuOpen(false);
                      disconnect();
                    }}
                  >
                    Sair
                  </button>
                </li>
              </ul>
            )}
          </div>
        </div>
      </header>

      <PwaInstallBar />
      <NotificationPermissionStrip />

      <div className="shrink-0 bg-whatsapp-sidebar px-3 pb-3 pt-2">
        <div className="flex items-center gap-2.5 rounded-full border border-white/[0.06] bg-whatsapp-input/90 px-3.5 py-2">
          <HiMagnifyingGlass className="h-5 w-5 shrink-0 text-whatsapp-text-secondary" aria-hidden />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar ou começar nova conversa"
            className="min-w-0 flex-1 bg-transparent py-1 text-sm text-whatsapp-text placeholder:text-whatsapp-text-secondary focus:outline-none"
            aria-label="Buscar conversas"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden border-t border-white/[0.05]">
        {searched.length === 0 && conversations.filter((c) => c != null).length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-whatsapp-text-secondary space-y-2">
            <p>Nenhuma conversa ainda.</p>
            <p className="text-xs text-whatsapp-text-secondary/80">
              Toque no ícone de conversa para escolher um contato ou adicionar um endereço — a conversa só
              aparece aqui depois de você abrir.
            </p>
          </div>
        ) : searched.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-whatsapp-text-secondary">
            Nenhuma conversa corresponde à busca.
          </div>
        ) : (
          <div className="pb-2">
            {mainList.length > 0 && (
              <ul role="listbox" aria-label="Conversas" className="pb-0">
                {mainList.map((conv, index) => renderConversationRow(conv, index, false))}
              </ul>
            )}

            {archivedList.length > 0 && (
              <div className="mt-2 border-t border-white/[0.06] pt-3">
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-whatsapp-text-secondary/80">
                  Arquivadas ({archivedList.length})
                </div>
                <ul role="listbox" aria-label="Conversas arquivadas">
                  {archivedList.map((conv, index) => renderConversationRow(conv, index, true))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <NewChatModal open={newChatOpen} onClose={() => setNewChatOpen(false)} />
      <NewGroupModal open={newGroupOpen} onClose={() => setNewGroupOpen(false)} />
      <ProfilePanel open={profileOpen} onClose={() => setProfileOpen(false)} />

      {pendingDelete ? (
        <ConfirmActionSheet
          open
          titleId="delete-conv-title"
          onClose={() => setPendingDelete(null)}
          title="Apagar conversa?"
          description={
            <>
              <span className="mt-1 block text-sm font-medium text-whatsapp-text">
                {pendingDelete.title}
              </span>
              <span className="mt-3 block text-sm text-whatsapp-text-secondary leading-relaxed">
                Você pode remover só da sua lista ou apagar para todos os participantes. Esta ação não
                pode ser desfeita no segundo caso.
              </span>
            </>
          }
          extra={(() => {
            const conv = pendingDelete.conv;
            const canEveryone =
              conv &&
              (conv.type === 'private' ||
                (conv.type === 'group' &&
                  String(conv.my_member_role || '').toLowerCase() === 'admin'));
            if (!canEveryone && conv?.type === 'group') {
              return (
                <p className="text-xs text-amber-200/90">
                  Só os administradores do grupo podem apagar a conversa para todos.
                </p>
              );
            }
            return null;
          })()}
          actions={(() => {
            const conv = pendingDelete.conv;
            const canEveryone =
              conv &&
              (conv.type === 'private' ||
                (conv.type === 'group' &&
                  String(conv.my_member_role || '').toLowerCase() === 'admin'));
            return [
              {
                key: 'self',
                label: 'Apagar só para mim',
                className:
                  'rounded-xl border border-whatsapp-border bg-whatsapp-input px-4 py-3 text-sm font-semibold text-whatsapp-text hover:bg-whatsapp-hover md:rounded-lg md:py-2.5',
                onClick: () => void deleteConversationSelf(),
              },
              {
                key: 'everyone',
                label: 'Apagar para todos',
                disabled: !canEveryone,
                title:
                  !canEveryone && conv?.type === 'group'
                    ? 'Apenas administradores do grupo podem apagar para todos'
                    : undefined,
                className:
                  'rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-45 md:rounded-lg md:py-2.5',
                onClick: () => void deleteConversationEveryone(),
              },
              {
                key: 'cancel',
                label: 'Cancelar',
                className:
                  'rounded-xl px-4 py-3 text-sm font-medium text-whatsapp-text-secondary hover:bg-whatsapp-hover md:rounded-lg md:py-2.5',
                onClick: () => setPendingDelete(null),
              },
            ];
          })()}
        />
      ) : null}
    </div>
  );
}
