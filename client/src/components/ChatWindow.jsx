import {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  IoSend,
  IoHappy,
  IoImage,
  IoClose,
  IoChevronDown,
  IoAttach,
  IoCamera,
  IoCall,
  IoVideocam,
  IoLockClosed,
  IoMic,
  IoWallet,
  IoTrashOutline,
} from 'react-icons/io5';
import {
  HiMagnifyingGlass,
  HiEllipsisVertical,
  HiChevronLeft,
  HiChevronUp,
  HiChevronDown,
} from 'react-icons/hi2';
import EmojiPicker, { EmojiStyle, Theme } from 'emoji-picker-react';
import { useChat } from '../contexts/ChatContext';
import { useAuth } from '../contexts/AuthContext';
import { useCall } from '../contexts/CallContext';
import MessageBubble, {
  formatAddress,
  addressToColor,
  displayNameFromAgenda,
} from './MessageBubble';
import ConfirmActionSheet from './shell/ConfirmActionSheet';
import CameraModal from './CameraModal';
import ContactInfoModal from './ContactInfoModal';
import ImageSendModal from './ImageSendModal';
import PaymentSendModal from './PaymentSendModal';
import VoiceRecorderWaveform from './VoiceRecorderWaveform';
import {
  requestMediaStream,
  mediaErrorMessagePt,
  isSecureContextForMedia,
  hasGetUserMedia,
} from '../utils/mediaDevices';
import { dayKeyBr, dateLabelBr, formatLastSeenBr } from '../utils/brDateTime';
import { apiFetch } from '../utils/apiFetch';
import { smartMessageMatches } from '../utils/conversationSearch';
import { hasEthereumProvider } from '../utils/ethereumProvider';
import {
  orderedQuickReactions,
  recordFooterReactionUsage,
} from '../utils/footerReactionUsage';

const PAGE_SIZE = 50;
const SCROLL_NEAR_BOTTOM = 120;
const FOOTER_QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👏'];

function footerMessagePreview(m) {
  if (!m) return '';
  const t = m.type ?? 'text';
  if (t === 'image') return 'Foto';
  if (t === 'file') return 'Arquivo';
  if (t === 'audio') return 'Mensagem de voz';
  if (t === 'video') return 'Vídeo';
  if (t === 'payment') return 'Pagamento cripto';
  const c = String(m.content ?? '').replace(/\s+/g, ' ').trim();
  if (!c) return 'Mensagem';
  return c.length > 120 ? `${c.slice(0, 120)}…` : c;
}

function MessagesLoadingState() {
  return (
    <div
      className="flex flex-col items-center justify-center py-14 px-6 min-h-[min(55vh,400px)] gap-7"
      role="status"
      aria-live="polite"
      aria-label="Carregando mensagens"
    >
      <div className="relative h-14 w-14" aria-hidden>
        <div className="absolute inset-0 rounded-full border-2 border-white/10" />
        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-whatsapp-green motion-reduce:border-t-white/40 motion-reduce:animate-none animate-spin" />
      </div>
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-[15px] font-medium text-whatsapp-text">Carregando mensagens</p>
        <p className="text-[13px] text-whatsapp-text-secondary">Sincronizando o histórico criptografado</p>
      </div>
      <div className="flex w-full max-w-[272px] flex-col gap-2.5">
        {[
          ['w-[78%]', 'delay-0'],
          ['w-[52%]', 'delay-150'],
          ['w-[66%]', 'delay-300'],
        ].map(([widthClass, delayClass], i) => (
          <div
            key={i}
            className={`h-10 rounded-2xl border border-white/5 bg-whatsapp-input/70 motion-reduce:animate-none motion-reduce:opacity-80 animate-pulse ${widthClass} ${delayClass} ${
              i % 2 ? 'self-end' : 'self-start'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function mid(m) {
  return m?._id ?? m?.id;
}

function msgSender(m) {
  return (m?.sender ?? m?.sender_address ?? '').toLowerCase();
}

function msgCreated(m) {
  return m?.createdAt ?? m?.created_at ?? 0;
}

function safeDate(raw) {
  if (raw == null || raw === '') return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function detectFileType(file) {
  const mime = file.type || '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

function extensionForImageMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m === 'image/png') return 'png';
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg';
  if (m === 'image/gif') return 'gif';
  if (m === 'image/webp') return 'webp';
  if (m === 'image/bmp') return 'bmp';
  if (m.startsWith('image/')) {
    const sub = m.slice(6).split('+')[0];
    return sub && /^[a-z0-9-]+$/i.test(sub) ? sub.slice(0, 12) : 'png';
  }
  return 'png';
}

function pickAudioMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

function extForAudioMime(mime) {
  if (!mime) return 'webm';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mp4') || mime.includes('mpeg')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

const VOICE_MAX_MS = 10 * 60 * 1000;

function formatRecSeconds(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function e2eSendErrorMessage(code) {
  switch (code) {
    case 'no_e2e_keys':
      return 'Criptografia E2E indisponível. Entre novamente com a carteira (assinatura MetaWhats).';
    case 'peer_no_keys':
      return 'O contato ainda não publicou a chave E2E. Peça para essa pessoa sair e entrar de novo no MetaWhats para registrar a chave.';
    case 'no_shared_secret':
      return 'Não foi possível calcular o segredo compartilhado com este contato.';
    case 'no_group_dek':
      return 'Não foi possível preparar a chave do grupo. Tente novamente.';
    case 'private_peer':
      return 'Falta o outro participante na conversa privada.';
    case 'encrypt_failed':
      return 'Falha ao criptografar a mensagem.';
    case 'upload_failed':
      return 'Falha ao enviar o arquivo criptografado. Tente novamente.';
    case 'group_admin_only':
      return 'Neste grupo só os administradores podem enviar mensagens.';
    default:
      return 'Não foi possível enviar a mensagem.';
  }
}

export default function ChatWindow() {
  const navigate = useNavigate();
  const { user, encryptionKeys } = useAuth();
  const {
    activeConversation,
    messages,
    onlineUsers,
    typingUsers,
    sendMessage,
    startTyping,
    stopTyping,
    loadMessages,
    markAsRead,
    clearConversation,
    deleteConversationForUser,
    deleteConversationForEveryone,
    uploadEncryptedFileAndSend,
    composerFocusNonce,
    messagesLoading,
    agendaByAddress,
    refreshAgenda,
    groupMetaEpoch,
    updateGroupSettings,
    setGroupMemberRole,
    emitAddReaction,
    deleteMessageForMe,
    deleteMessageForEveryone,
  } = useChat();
  const { startCall, startGroupCall } = useCall();

  const convId = activeConversation?._id ?? activeConversation?.id;
  const isGroup = activeConversation?.type === 'group';
  const isPrivate = activeConversation?.type === 'private';

  const [members, setMembers] = useState([]);
  const [text, setText] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
  const [footerActionsMessage, setFooterActionsMessage] = useState(null);
  const [footerEmojiOpen, setFooterEmojiOpen] = useState(false);
  const [footerDeleteModalOpen, setFooterDeleteModalOpen] = useState(false);
  const [reactionUsageTick, setReactionUsageTick] = useState(0);
  const footerActionsBarRef = useRef(null);
  const orderedQuickReactionsList = useMemo(
    () => orderedQuickReactions(FOOTER_QUICK_REACTIONS),
    [reactionUsageTick]
  );
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [searchHitIndex, setSearchHitIndex] = useState(0);
  const searchRowRefMap = useRef(new Map());
  const replyJumpFlashTimerRef = useRef(null);
  const [replyJumpFlashId, setReplyJumpFlashId] = useState(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [noMoreOlder, setNoMoreOlder] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [voiceStream, setVoiceStream] = useState(null);
  const [recSeconds, setRecSeconds] = useState(0);
  const [recError, setRecError] = useState(null);
  const [contactInfoOpen, setContactInfoOpen] = useState(false);
  const [imageSendOpen, setImageSendOpen] = useState(false);
  const [pendingImageFile, setPendingImageFile] = useState(null);

  const scrollRef = useRef(null);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  /** iOS: saber se o compositor estava focado antes do scroll ao chegar mensagem própria. */
  const composerFocusedRef = useRef(false);
  /** Após enviar uma resposta: não voltar a focar o compositor no scroll da mensagem própria. */
  const lastSentWasReplyRef = useRef(false);
  const fileInputRef = useRef(null);
  const attachInputRef = useRef(null);
  const menuRef = useRef(null);
  const composerMenuRef = useRef(null);
  const typingDebounce = useRef(null);
  const typingStop = useRef(null);
  const prevLenRef = useRef(0);
  const firstPaint = useRef(true);
  const olderLockRef = useRef(false);
  const mediaRecorderRef = useRef(null);
  const recordStreamRef = useRef(null);
  const recordChunksRef = useRef([]);
  const recordIntervalRef = useRef(null);
  const recordMaxTimerRef = useRef(null);
  const recordStartedAtRef = useRef(0);
  const discardVoiceRef = useRef(false);

  const sortedMessages = useMemo(() => {
    return [...messages].sort((a, b) => {
      const ta = safeDate(msgCreated(a))?.getTime() ?? 0;
      const tb = safeDate(msgCreated(b))?.getTime() ?? 0;
      return ta - tb;
    });
  }, [messages]);

  const sortedMessagesRef = useRef(sortedMessages);
  useEffect(() => {
    sortedMessagesRef.current = sortedMessages;
  }, [sortedMessages]);

  const noMoreOlderRef = useRef(noMoreOlder);
  useEffect(() => {
    noMoreOlderRef.current = noMoreOlder;
  }, [noMoreOlder]);

  /**
   * Teclado virtual (Android / alguns WebViews): quando o layout não encolhe,
   * `innerHeight - visualViewport` indica a zona coberta; extra padding no rodapé
   * mantém o campo de mensagem visível. Com `interactive-widget=resizes-content`
   * o overlap costuma ser ~0; aqui fica como rede de segurança.
   */
  const [keyboardOverlapPx, setKeyboardOverlapPx] = useState(0);
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return undefined;
    const sync = () => {
      const layoutH = window.innerHeight;
      const overlap = Math.max(0, Math.round(layoutH - vv.height - vv.offsetTop));
      setKeyboardOverlapPx(overlap > 12 ? overlap : 0);
    };
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
    };
  }, []);

  const messagesById = useMemo(() => {
    const map = new Map();
    for (const m of sortedMessages) {
      map.set(mid(m), m);
    }
    return map;
  }, [sortedMessages]);

  const footerActionsIsOwn = useMemo(() => {
    if (!footerActionsMessage || !user?.address) return false;
    if ((footerActionsMessage.type ?? 'text') === 'system') return false;
    return msgSender(footerActionsMessage) === user.address.toLowerCase();
  }, [footerActionsMessage, user?.address]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearchQuery(searchQuery.trim()), 280);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    setSearchHitIndex(0);
  }, [debouncedSearchQuery, convId]);

  const searchMatches = useMemo(() => {
    if (!searchOpen || !debouncedSearchQuery) return [];
    return sortedMessages.filter((m) => smartMessageMatches(m, debouncedSearchQuery));
  }, [searchOpen, debouncedSearchQuery, sortedMessages]);

  const activeSearchHitId = useMemo(() => {
    if (!searchOpen || !debouncedSearchQuery || searchMatches.length === 0) return null;
    return mid(searchMatches[searchHitIndex]) ?? null;
  }, [searchOpen, debouncedSearchQuery, searchMatches, searchHitIndex]);

  useEffect(() => {
    setSearchHitIndex((i) => {
      if (searchMatches.length === 0) return 0;
      return Math.min(i, searchMatches.length - 1);
    });
  }, [searchMatches.length]);

  const highlightQuery = searchOpen ? searchQuery.trim() : '';

  useEffect(() => {
    if (!searchOpen || searchMatches.length === 0) return;
    const id = activeSearchHitId;
    if (!id) return;
    const el = searchRowRefMap.current.get(id);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeSearchHitId, searchOpen]);

  useEffect(() => {
    if (!convId) {
      setMembers([]);
      return;
    }
    let cancelled = false;
    apiFetch(`/api/conversations/${convId}/members`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (!cancelled) setMembers(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [convId, groupMetaEpoch]);

  const canPostInGroup = useMemo(() => {
    if (!isGroup || !user?.address) return true;
    if (!Number(activeConversation?.group_only_admins_post)) return true;
    const me = user.address.toLowerCase();
    const row = members.find((m) => (m.address ?? '').toLowerCase() === me);
    return row?.role === 'admin';
  }, [isGroup, user?.address, activeConversation?.group_only_admins_post, members]);

  const composerLocked = Boolean(isGroup && !canPostInGroup);

  const handleOpenFooterActions = useCallback((m) => {
    let mode = null;
    setFooterActionsMessage((cur) => {
      if (cur != null && mid(cur) === mid(m)) {
        mode = 'close';
        return null;
      }
      mode = 'open';
      return m;
    });
    if (mode === 'close') {
      setReplyingTo((r) => (r != null && mid(r) === mid(m) ? null : r));
      setFooterEmojiOpen(false);
      return;
    }
    setFooterEmojiOpen(false);
    if (!composerLocked) {
      setReplyingTo(m);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          textareaRef.current?.focus({ preventScroll: true });
        });
      });
    }
  }, [composerLocked]);

  const iAmGroupAdmin = useMemo(() => {
    if (!isGroup || !user?.address) return false;
    const me = user.address.toLowerCase();
    const row = members.find((m) => (m.address ?? '').toLowerCase() === me);
    if (row?.role === 'admin') return true;
    return String(activeConversation?.my_member_role || '').toLowerCase() === 'admin';
  }, [isGroup, user?.address, members, activeConversation?.my_member_role]);

  const canDeleteConversationForEveryone = useMemo(() => {
    if (!user?.address || !activeConversation) return false;
    const me = user.address.toLowerCase();
    if (activeConversation.type === 'group') {
      const fromRow = String(activeConversation.my_member_role || '').toLowerCase() === 'admin';
      const fromMembers = members.some(
        (m) => (m.address ?? '').toLowerCase() === me && m.role === 'admin'
      );
      return fromRow || fromMembers;
    }
    return activeConversation.type === 'private';
  }, [user?.address, activeConversation, members]);

  useEffect(() => {
    if (!convId || recordingVoice || composerLocked) return;
    const raf = requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [convId, composerFocusNonce, recordingVoice, composerLocked]);

  useEffect(() => {
    setNoMoreOlder(false);
    firstPaint.current = true;
    prevLenRef.current = 0;
    setComposerMenuOpen(false);
    setEmojiOpen(false);
    setFooterActionsMessage(null);
    setFooterEmojiOpen(false);
    setFooterDeleteModalOpen(false);
    setReplyingTo(null);
    if (replyJumpFlashTimerRef.current) {
      clearTimeout(replyJumpFlashTimerRef.current);
      replyJumpFlashTimerRef.current = null;
    }
    setReplyJumpFlashId(null);
    lastSentWasReplyRef.current = false;
  }, [convId]);

  useEffect(() => {
    if (!footerActionsMessage) setFooterDeleteModalOpen(false);
  }, [footerActionsMessage]);

  useEffect(() => {
    return () => {
      if (replyJumpFlashTimerRef.current) {
        clearTimeout(replyJumpFlashTimerRef.current);
        replyJumpFlashTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!footerEmojiOpen) return;
    const close = (e) => {
      if (!e.target.closest?.('.footer-actions-emoji-anchor')) {
        setFooterEmojiOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [footerEmojiOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  useEffect(() => {
    if (!emojiOpen) return;
    const close = (e) => {
      if (!e.target.closest?.('.emoji-picker-anchor')) {
        setEmojiOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [emojiOpen]);

  useEffect(() => {
    if (!composerMenuOpen) return;
    const close = (e) => {
      const t = e.target;
      if (composerMenuRef.current?.contains(t)) return;
      if (t.closest?.('.EmojiPickerReact')) return;
      setComposerMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [composerMenuOpen]);

  const scrollToBottom = useCallback((behavior = 'smooth') => {
    bottomRef.current?.scrollIntoView({
      behavior: behavior === 'instant' ? 'auto' : behavior,
      block: 'end',
    });
  }, []);

  const loadOlder = useCallback(async () => {
    if (
      !convId ||
      olderLockRef.current ||
      noMoreOlder ||
      sortedMessages.length === 0
    ) {
      return;
    }
    olderLockRef.current = true;
    setLoadingOlder(true);
    const oldest = sortedMessages[0];
    const before = msgCreated(oldest);
    const el = scrollRef.current;
    const prevH = el?.scrollHeight ?? 0;
    try {
      const batch = await loadMessages(convId, before);
      const n = Array.isArray(batch) ? batch.length : 0;
      if (n < PAGE_SIZE || n === 0) setNoMoreOlder(true);
    } finally {
      setLoadingOlder(false);
      olderLockRef.current = false;
      requestAnimationFrame(() => {
        if (el) {
          el.scrollTop = el.scrollHeight - prevH;
        }
      });
    }
  }, [convId, noMoreOlder, sortedMessages, loadMessages]);

  const jumpToMessage = useCallback(
    async (rawId) => {
      if (rawId == null || rawId === '') return;
      const idStr = String(rawId);

      const scheduleReplyJumpFlash = () => {
        if (replyJumpFlashTimerRef.current) {
          clearTimeout(replyJumpFlashTimerRef.current);
          replyJumpFlashTimerRef.current = null;
        }
        setReplyJumpFlashId(idStr);
        replyJumpFlashTimerRef.current = setTimeout(() => {
          setReplyJumpFlashId(null);
          replyJumpFlashTimerRef.current = null;
        }, 1320);
      };

      const findRowEl = () => {
        const map = searchRowRefMap.current;
        let el = map.get(idStr) ?? map.get(rawId);
        if (el) return el;
        for (const [k, v] of map.entries()) {
          if (String(k) === idStr) return v;
        }
        return null;
      };

      const tryScroll = () => {
        const el = findRowEl();
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return true;
        }
        return false;
      };

      const listHasTarget = () =>
        sortedMessagesRef.current.some((m) => String(mid(m)) === idStr);

      if (tryScroll()) {
        scheduleReplyJumpFlash();
        return;
      }
      if (listHasTarget()) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (tryScroll()) scheduleReplyJumpFlash();
          });
        });
        return;
      }

      for (let guard = 0; guard < 40; guard += 1) {
        if (noMoreOlderRef.current) break;
        await loadOlder();
        await new Promise((r) => {
          requestAnimationFrame(() => r());
        });
        if (listHasTarget() && tryScroll()) {
          scheduleReplyJumpFlash();
          return;
        }
        if (tryScroll()) {
          scheduleReplyJumpFlash();
          return;
        }
      }
    },
    [loadOlder]
  );

  /** Com pesquisa activa, vai pedindo histórico mais antigo até não haver mais (mensagens encriptadas só no cliente). */
  useEffect(() => {
    if (!searchOpen || !debouncedSearchQuery || !convId || noMoreOlder) return;
    const id = setInterval(() => {
      if (messagesLoading) return;
      void loadOlder();
    }, 550);
    return () => clearInterval(id);
  }, [searchOpen, debouncedSearchQuery, convId, noMoreOlder, messagesLoading, loadOlder]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const nearBottom = scrollHeight - scrollTop - clientHeight < SCROLL_NEAR_BOTTOM;
    setShowScrollDown(!nearBottom && scrollHeight > clientHeight + 40);

    if (scrollTop < 80 && !olderLockRef.current && !noMoreOlder && convId) {
      loadOlder();
    }
  }, [noMoreOlder, convId, loadOlder]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const len = sortedMessages.length;
    const prev = prevLenRef.current;
    prevLenRef.current = len;

    if (firstPaint.current && len > 0) {
      firstPaint.current = false;
      scrollToBottom('instant');
      return;
    }

    if (len > prev) {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const wasNearBottom =
        scrollHeight - scrollTop - clientHeight < SCROLL_NEAR_BOTTOM + 40;
      const last = sortedMessages[len - 1];
      const own =
        last && user && msgSender(last) === user.address.toLowerCase();
      if (wasNearBottom || own) {
        const skipKeyboardAfterReply = Boolean(own && lastSentWasReplyRef.current);
        if (skipKeyboardAfterReply) {
          lastSentWasReplyRef.current = false;
        }
        const keepKeyboard = Boolean(
          own && composerFocusedRef.current && !skipKeyboardAfterReply
        );
        scrollToBottom(keepKeyboard ? 'instant' : 'smooth');
        if (keepKeyboard) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              textareaRef.current?.focus({ preventScroll: true });
            });
          });
        }
      }
    }
  }, [sortedMessages, user, scrollToBottom]);

  const markReadTimer = useRef(null);
  useEffect(() => {
    if (!user || !convId || sortedMessages.length === 0) return;
    const addr = user.address.toLowerCase();
    const lastIncomingUnread = [...sortedMessages]
      .reverse()
      .find(
        (m) =>
          msgSender(m) !== addr &&
          (m.type ?? 'text') !== 'system' &&
          m.status !== 'read'
      );
    if (!lastIncomingUnread || !mid(lastIncomingUnread)) return;
    if (markReadTimer.current) clearTimeout(markReadTimer.current);
    markReadTimer.current = setTimeout(() => {
      markAsRead(mid(lastIncomingUnread));
    }, 400);
    return () => clearTimeout(markReadTimer.current);
  }, [user, convId, sortedMessages, markAsRead]);

  const emitTypingDebounced = useCallback(() => {
    if (typingDebounce.current) clearTimeout(typingDebounce.current);
    typingDebounce.current = setTimeout(() => {
      startTyping();
    }, 300);
    if (typingStop.current) clearTimeout(typingStop.current);
    typingStop.current = setTimeout(() => {
      stopTyping();
    }, 2000);
  }, [startTyping, stopTyping]);

  const handleTextChange = (e) => {
    if (composerLocked) return;
    setText(e.target.value);
    emitTypingDebounced();
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      const max = 120;
      ta.style.height = `${Math.min(ta.scrollHeight, max)}px`;
    }
  };

  const refocusComposer = useCallback(() => {
    if (composerLocked) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        textareaRef.current?.focus({ preventScroll: true });
      });
    });
  }, [composerLocked]);

  const handleSend = async () => {
    if (composerLocked) return;
    const t = text.trim();
    if (!t || !convId) return;
    stopTyping();
    if (typingDebounce.current) clearTimeout(typingDebounce.current);
    if (typingStop.current) clearTimeout(typingStop.current);
    const wasReply = Boolean(replyingTo);
    if (wasReply) {
      lastSentWasReplyRef.current = true;
    }
    const result = await sendMessage(t, 'text', replyingTo ? mid(replyingTo) : null);
    if (result && result.ok === false) {
      if (wasReply) {
        lastSentWasReplyRef.current = false;
      }
      window.alert(e2eSendErrorMessage(result.error));
      refocusComposer();
      return;
    }
    setText('');
    setReplyingTo(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    if (wasReply) {
      composerFocusedRef.current = false;
      textareaRef.current?.blur();
      requestAnimationFrame(() => {
        textareaRef.current?.blur();
      });
    } else {
      refocusComposer();
    }
  };

  const handleKeyDown = (e) => {
    if (composerLocked) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleComposerPaste = useCallback(
    (e) => {
      if (composerLocked || !convId || recordingVoice) return;
      const items = e.clipboardData?.items;
      if (!items?.length) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind !== 'file' || !item.type?.startsWith?.('image/')) continue;
        const raw = item.getAsFile();
        if (!raw || raw.size === 0) continue;
        const nameOk = raw.name && String(raw.name).trim().length > 0;
        const file = nameOk
          ? raw
          : new File([raw], `colar_${Date.now()}.${extensionForImageMime(item.type)}`, {
              type: item.type || raw.type || 'image/png',
            });
        if (detectFileType(file) !== 'image') continue;
        e.preventDefault();
        setComposerMenuOpen(false);
        setEmojiOpen(false);
        setPendingImageFile(file);
        setImageSendOpen(true);
        return;
      }
    },
    [composerLocked, convId, recordingVoice]
  );

  const onEmojiClick = (emojiData) => {
    if (composerLocked) return;
    setText((prev) => prev + (emojiData.emoji ?? ''));
    emitTypingDebounced();
    textareaRef.current?.focus();
  };

  const uploadAndSend = useCallback(
    async (file) => {
      if (composerLocked || !file || !convId) return;
      try {
        const result = await uploadEncryptedFileAndSend(file);
        if (result && result.ok === false) {
          window.alert(e2eSendErrorMessage(result.error));
        }
      } catch {
        window.alert(e2eSendErrorMessage('upload_failed'));
      }
    },
    [composerLocked, convId, uploadEncryptedFileAndSend]
  );

  const clearVoiceTimers = useCallback(() => {
    if (recordIntervalRef.current) {
      clearInterval(recordIntervalRef.current);
      recordIntervalRef.current = null;
    }
    if (recordMaxTimerRef.current) {
      clearTimeout(recordMaxTimerRef.current);
      recordMaxTimerRef.current = null;
    }
  }, []);

  const stopVoiceStream = useCallback(() => {
    recordStreamRef.current?.getTracks().forEach((t) => t.stop());
    recordStreamRef.current = null;
  }, []);

  const finishVoiceRecorder = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state === 'inactive') {
      stopVoiceStream();
      clearVoiceTimers();
      setVoiceStream(null);
      setRecordingVoice(false);
      setRecSeconds(0);
      return;
    }
    mr.onstop = () => {
      const mime = mr.mimeType || pickAudioMimeType() || 'audio/webm';
      const blob = new Blob(recordChunksRef.current, { type: mime });
      recordChunksRef.current = [];
      mediaRecorderRef.current = null;
      stopVoiceStream();
      clearVoiceTimers();
      setVoiceStream(null);
      setRecordingVoice(false);
      setRecSeconds(0);
      const discard = discardVoiceRef.current;
      discardVoiceRef.current = false;
      if (!discard && blob.size > 400) {
        const ext = extForAudioMime(mime);
        const file = new File([blob], `voice_${Date.now()}.${ext}`, {
          type: mime || 'audio/webm',
        });
        uploadAndSend(file);
      }
    };
    mr.stop();
  }, [clearVoiceTimers, stopVoiceStream, uploadAndSend]);

  const startVoiceRecording = useCallback(async () => {
    if (composerLocked || !convId || recordingVoice) return;
    setRecError(null);
    discardVoiceRef.current = false;
    if (!isSecureContextForMedia()) {
      setRecError(
        'Microfone e câmera precisam de HTTPS (ou localhost). No iPhone use https:// no seu domínio.'
      );
      return;
    }
    if (!hasGetUserMedia()) {
      setRecError(
        'Este navegador não permite acessar o microfone aqui. Atualize o Safari ou verifique se não está dentro de um navegador integrado de outro app.'
      );
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      setRecError('Gravação de áudio não suportada neste navegador.');
      return;
    }
    try {
      const stream = await requestMediaStream({ audio: true });
      recordStreamRef.current = stream;
      setVoiceStream(stream);
      recordChunksRef.current = [];
      const mime = pickAudioMimeType();
      const mr = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) recordChunksRef.current.push(e.data);
      };
      mr.start(250);
      mediaRecorderRef.current = mr;
      recordStartedAtRef.current = Date.now();
      setRecSeconds(0);
      setRecordingVoice(true);
      recordIntervalRef.current = setInterval(() => {
        setRecSeconds(
          Math.floor((Date.now() - recordStartedAtRef.current) / 1000)
        );
      }, 400);
      recordMaxTimerRef.current = setTimeout(() => {
        finishVoiceRecorder();
      }, VOICE_MAX_MS);
    } catch (e) {
      stopVoiceStream();
      clearVoiceTimers();
      setVoiceStream(null);
      setRecordingVoice(false);
      setRecSeconds(0);
      setRecError(mediaErrorMessagePt(e));
    }
  }, [composerLocked, convId, recordingVoice, clearVoiceTimers, stopVoiceStream, finishVoiceRecorder]);

  const cancelVoiceRecording = useCallback(() => {
    discardVoiceRef.current = true;
    finishVoiceRecorder();
  }, [finishVoiceRecorder]);

  const sendVoiceRecording = useCallback(() => {
    discardVoiceRef.current = false;
    finishVoiceRecorder();
  }, [finishVoiceRecorder]);

  useEffect(() => {
    return () => {
      discardVoiceRef.current = true;
      const mr = mediaRecorderRef.current;
      if (mr && mr.state !== 'inactive') {
        mr.onstop = () => {
          recordChunksRef.current = [];
          mediaRecorderRef.current = null;
        };
        try {
          mr.stop();
        } catch {
          /* ignore */
        }
      }
      stopVoiceStream();
      clearVoiceTimers();
      setVoiceStream(null);
    };
  }, [stopVoiceStream, clearVoiceTimers]);

  const handleImagePick = (e) => {
    if (composerLocked) return;
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPendingImageFile(file);
    setImageSendOpen(true);
  };

  const handleAttachPick = async (e) => {
    if (composerLocked) return;
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (detectFileType(file) === 'image') {
      setPendingImageFile(file);
      setImageSendOpen(true);
    } else {
      await uploadAndSend(file);
    }
  };

  const handleCameraCapture = useCallback(
    (file) => {
      if (composerLocked) return;
      setPendingImageFile(file);
      setImageSendOpen(true);
    },
    [composerLocked]
  );

  const closeImageSendModal = useCallback(() => {
    setImageSendOpen(false);
    setPendingImageFile(null);
  }, []);

  const sendEditedImage = useCallback(
    async (file) => {
      await uploadAndSend(file);
    },
    [uploadAndSend]
  );

  const handlePaymentPayload = useCallback(
    async (payloadJson) => {
      const result = await sendMessage(
        payloadJson,
        'payment',
        replyingTo ? mid(replyingTo) : null
      );
      if (result && result.ok === false) {
        window.alert(e2eSendErrorMessage(result.error));
        return;
      }
      setReplyingTo(null);
    },
    [sendMessage, replyingTo]
  );

  const otherPrivateMember = useMemo(() => {
    if (!user || isGroup) return null;
    const me = user.address.toLowerCase();
    return members.find((m) => (m.address ?? '').toLowerCase() !== me) ?? null;
  }, [members, user, isGroup]);

  const canSendCryptoPayment =
    Boolean(isPrivate && otherPrivateMember?.address && hasEthereumProvider());

  const headerTitle = isGroup
    ? activeConversation?.name || 'Grupo'
    : (() => {
        const raw = String(
          otherPrivateMember?.address || activeConversation?.peer_address || ''
        ).trim();
        const peer = raw.toLowerCase();
        if (!peer) return '';
        const agendaRow = agendaByAddress.get(peer);
        if (agendaRow) {
          const ap = String(agendaRow.apelido || '').trim();
          if (ap.length >= 1) return ap;
          const nk = String(agendaRow.nickname || '').trim();
          if (nk.length >= 1) return nk;
        }
        const nkMem = String(otherPrivateMember?.nickname || '').trim();
        if (nkMem) return nkMem;
        const nkConv = String(activeConversation?.peer_nickname || '').trim();
        if (nkConv) return nkConv;
        return formatAddress(raw);
      })();

  const headerSubtitle = useMemo(() => {
    if (!convId) return '';
    const typingSet = typingUsers.get(convId);
    if (typingSet && typingSet.size > 0) {
      const me = user?.address?.toLowerCase();
      const addrs = [...typingSet].filter((a) => a?.toLowerCase() !== me);
      if (addrs.length > 0) {
        if (isGroup) {
          const names = addrs
            .slice(0, 3)
            .map((a) => formatAddress(a))
            .join(', ');
          const extra = addrs.length > 3 ? ` +${addrs.length - 3}` : '';
          return `${names}${extra} digitando...`;
        }
        return 'digitando...';
      }
    }
    if (isGroup) {
      const n = members.length;
      return `${n} participante${n === 1 ? '' : 's'}`;
    }
    const oa = otherPrivateMember?.address?.toLowerCase();
    if (oa && onlineUsers.has(oa)) return 'online';
    const last =
      otherPrivateMember?.last_seen ?? otherPrivateMember?.lastSeen;
    return formatLastSeenBr(last);
  }, [
    convId,
    typingUsers,
    user,
    isGroup,
    members.length,
    otherPrivateMember,
    onlineUsers,
    agendaByAddress,
  ]);

  const headerAvatar =
    activeConversation?.avatar ||
    otherPrivateMember?.avatar ||
    null;

  const handleVoiceCall = () => {
    if (!convId) return;
    if (isGroup) {
      startGroupCall('voice', convId);
      return;
    }
    if (!otherPrivateMember) return;
    startCall(otherPrivateMember.address, 'voice', convId);
  };

  const handleVideoCall = () => {
    if (!convId) return;
    if (isGroup) {
      startGroupCall('video', convId);
      return;
    }
    if (!otherPrivateMember) return;
    startCall(otherPrivateMember.address, 'video', convId);
  };

  if (!activeConversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-whatsapp-dark text-whatsapp-text-secondary min-h-0">
        <div className="text-center px-8 max-w-md">
          <div className="w-64 h-64 mx-auto mb-6 rounded-full bg-whatsapp-sidebar/50 border border-whatsapp-border/30 flex items-center justify-center text-6xl opacity-40">
            💬
          </div>
          <h2 className="text-xl font-light text-whatsapp-text mb-2">
            MetaWhats
          </h2>
          <p className="text-sm leading-relaxed">
            Envie e receba mensagens. Selecione uma conversa na lista para começar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col min-w-0 bg-whatsapp-chat">
      <header className="relative z-30 shrink-0 flex items-center gap-2 border-b border-white/[0.06] bg-whatsapp-header/95 px-2 py-2 pt-[max(0.5rem,calc(env(safe-area-inset-top)+0.25rem))] backdrop-blur-md supports-[backdrop-filter]:bg-whatsapp-header/80 sm:gap-3 sm:px-3 sm:pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="md:hidden -ml-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-whatsapp-text hover:bg-whatsapp-hover touch-manipulation"
          aria-label="Voltar às conversas"
        >
          <HiChevronLeft className="h-7 w-7" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setContactInfoOpen(true)}
          className="w-10 h-10 rounded-full overflow-hidden bg-whatsapp-hover shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp-green/60"
          aria-label={isGroup ? 'Abrir informações do grupo' : 'Abrir informações do contato'}
        >
          {headerAvatar ? (
            <img
              src={headerAvatar}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center text-lg font-medium text-whatsapp-text-secondary"
              style={{
                background: `linear-gradient(135deg, ${addressToColor(
                  otherPrivateMember?.address || convId || 'x'
                )}55, #0a0a0c)`,
              }}
            >
              {(headerTitle || '?').slice(0, 1).toUpperCase()}
            </div>
          )}
        </button>
        <button
          type="button"
          onClick={() => setContactInfoOpen(true)}
          className="flex-1 min-w-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp-green/60 rounded"
          aria-label={isGroup ? 'Abrir informações do grupo' : 'Abrir informações do contato'}
        >
          <div className="flex items-center gap-1.5">
            <h1 className="text-[17px] sm:text-[16px] font-semibold sm:font-medium text-whatsapp-text truncate">
              {headerTitle}
            </h1>
            {isPrivate && encryptionKeys && (
              <IoLockClosed className="w-3.5 h-3.5 text-whatsapp-secondary shrink-0" title="Criptografia de ponta a ponta" />
            )}
          </div>
          <p className="text-[14px] sm:text-[13px] text-whatsapp-text-secondary truncate leading-tight">
            {headerSubtitle}
          </p>
        </button>
        <div className="flex items-center gap-0.5 shrink-0">
          {((isPrivate && otherPrivateMember) || isGroup) && (
            <>
              <button
                type="button"
                onClick={handleVoiceCall}
                className="p-2 rounded-full text-whatsapp-text-secondary hover:bg-whatsapp-hover hover:text-whatsapp-text transition-colors"
                aria-label={isGroup ? 'Chamada de voz (grupo)' : 'Chamada de voz'}
              >
                <IoCall className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={handleVideoCall}
                className="p-2 rounded-full text-whatsapp-text-secondary hover:bg-whatsapp-hover hover:text-whatsapp-text transition-colors"
                aria-label={isGroup ? 'Videochamada (grupo)' : 'Videochamada'}
              >
                <IoVideocam className="w-5 h-5" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              setSearchOpen((s) => !s);
              if (searchOpen) setSearchQuery('');
            }}
            className="p-2 rounded-full text-whatsapp-text-secondary hover:bg-whatsapp-hover hover:text-whatsapp-text transition-colors"
            aria-label="Pesquisar"
          >
            <HiMagnifyingGlass className="w-6 h-6" />
          </button>
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((m) => !m)}
              className="p-2 rounded-full text-whatsapp-text-secondary hover:bg-whatsapp-hover hover:text-whatsapp-text transition-colors"
              aria-label="Menu"
            >
              <HiEllipsisVertical className="w-6 h-6" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-56 py-1 rounded-lg shadow-xl bg-whatsapp-sidebar border border-whatsapp-border z-50">
                {(!isGroup || iAmGroupAdmin) && (
                  <button
                    type="button"
                    className="w-full text-left px-4 py-2.5 text-[15px] text-whatsapp-text hover:bg-whatsapp-hover"
                    onClick={async () => {
                      setMenuOpen(false);
                      if (!convId) return;
                      if (
                        !window.confirm(
                          'Apagar todas as mensagens desta conversa para todos? A conversa permanece na lista.'
                        )
                      ) {
                        return;
                      }
                      const done = await clearConversation(convId);
                      if (!done) window.alert('Não foi possível limpar o histórico.');
                    }}
                  >
                    Limpar histórico (todos)
                  </button>
                )}
                <button
                  type="button"
                  className="w-full text-left px-4 py-2.5 text-[15px] text-whatsapp-text hover:bg-whatsapp-hover"
                  onClick={async () => {
                    setMenuOpen(false);
                    if (!convId) return;
                    if (
                      !window.confirm(
                        'Remover esta conversa só da sua lista? Os outros participantes não são afetados.'
                      )
                    ) {
                      return;
                    }
                    const done = await deleteConversationForUser(convId);
                    if (!done) window.alert('Não foi possível remover a conversa.');
                  }}
                >
                  Remover só para mim
                </button>
                <button
                  type="button"
                  disabled={!canDeleteConversationForEveryone}
                  title={
                    !canDeleteConversationForEveryone
                      ? isGroup
                        ? 'Apenas administradores do grupo podem apagar para todos'
                        : 'Você precisa ser membro da conversa. Recarregue a página ou abra o chat novamente.'
                      : undefined
                  }
                  className="w-full text-left px-4 py-2.5 text-[15px] text-red-300 hover:bg-whatsapp-hover disabled:opacity-40 disabled:cursor-not-allowed"
                  onClick={async () => {
                    setMenuOpen(false);
                    if (!convId || !canDeleteConversationForEveryone) return;
                    if (
                      !window.confirm(
                        'Apagar esta conversa para TODOS? Ação irreversível — todos deixam de ver a conversa.'
                      )
                    ) {
                      return;
                    }
                    const done = await deleteConversationForEveryone(convId);
                    if (!done) window.alert('Não foi possível apagar a conversa para todos.');
                  }}
                >
                  Apagar conversa para todos
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {searchOpen && (
        <div className="relative z-20 shrink-0 border-b border-white/[0.06] bg-whatsapp-header/90 px-3 py-2 backdrop-blur-sm flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar em todo o histórico (acentos ignorados)"
            className="min-w-0 flex-1 bg-whatsapp-input rounded-lg px-3 py-2 text-sm text-whatsapp-text placeholder:text-whatsapp-text-secondary outline-none border border-transparent focus:border-whatsapp-green/40"
            autoFocus
          />
          <div className="flex items-center justify-between gap-2 sm:justify-end shrink-0">
            <span className="text-xs text-whatsapp-text-secondary tabular-nums whitespace-nowrap">
              {debouncedSearchQuery
                ? searchMatches.length === 0
                  ? 'Nenhum resultado'
                  : `${searchHitIndex + 1} / ${searchMatches.length}`
                : 'Digite para buscar'}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={!debouncedSearchQuery || searchMatches.length === 0}
                onClick={() =>
                  setSearchHitIndex((i) =>
                    searchMatches.length === 0 ? 0 : (i - 1 + searchMatches.length) % searchMatches.length
                  )
                }
                className="p-2 rounded-lg text-whatsapp-text-secondary hover:bg-whatsapp-hover hover:text-whatsapp-text disabled:opacity-40 disabled:pointer-events-none"
                aria-label="Resultado anterior"
              >
                <HiChevronUp className="w-5 h-5" />
              </button>
              <button
                type="button"
                disabled={!debouncedSearchQuery || searchMatches.length === 0}
                onClick={() =>
                  setSearchHitIndex((i) =>
                    searchMatches.length === 0 ? 0 : (i + 1) % searchMatches.length
                  )
                }
                className="p-2 rounded-lg text-whatsapp-text-secondary hover:bg-whatsapp-hover hover:text-whatsapp-text disabled:opacity-40 disabled:pointer-events-none"
                aria-label="Próximo resultado"
              >
                <HiChevronDown className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        aria-busy={messagesLoading}
        className="relative z-0 flex-1 overflow-y-auto overflow-x-hidden bg-whatsapp-chat-pattern min-h-0"
      >
        {loadingOlder && !messagesLoading && (
          <div className="sticky top-0 z-10 flex justify-center py-2">
            <span className="text-xs text-whatsapp-text-secondary bg-whatsapp-sidebar/90 px-3 py-1 rounded-full">
              Carregando...
            </span>
          </div>
        )}
        {messagesLoading ? (
          <MessagesLoadingState />
        ) : (
        <div className="py-3 px-1 sm:px-0">
          {sortedMessages.map((message, i) => {
            const prev = sortedMessages[i - 1];
            const created = msgCreated(message);
            const prevCreated = prev ? msgCreated(prev) : null;
            const showDateSep =
              !prev ||
              dayKeyBr(created) !== dayKeyBr(prevCreated);

            const sender = msgSender(message);
            const isOwn =
              user && sender === user.address.toLowerCase();
            const prevSender = prev ? msgSender(prev) : null;
            const showSender =
              isGroup &&
              !isOwn &&
              (message.type ?? 'text') !== 'system' &&
              (!prev || prevSender !== sender || showDateSep);

            const next = sortedMessages[i + 1];
            const nextSender = next ? msgSender(next) : null;
            const showTail =
              (message.type ?? 'text') !== 'system' &&
              (!next || nextSender !== sender || (next && dayKeyBr(msgCreated(next)) !== dayKeyBr(created)));

            const replyId = message.replyTo ?? message.reply_to;
            const replyToMessage = replyId
              ? messagesById.get(replyId)
              : null;

            const msgKey = mid(message) ?? i;

            const jumpFlashThis =
              msgKey != null && String(msgKey) === String(replyJumpFlashId);

            return (
              <div
                key={msgKey}
                ref={(el) => {
                  if (!msgKey) return;
                  if (el) searchRowRefMap.current.set(msgKey, el);
                  else searchRowRefMap.current.delete(msgKey);
                }}
                className={
                  jumpFlashThis
                    ? 'motion-reduce:animate-none animate-reply-jump-pulse rounded-xl transition-shadow'
                    : undefined
                }
              >
                {showDateSep && (
                  <div className="flex justify-center my-3 px-6">
                    <span className="px-3 py-1 rounded-lg bg-whatsapp-input/95 text-xs text-whatsapp-text-secondary shadow-sm border border-whatsapp-border/30">
                      {dateLabelBr(created) || '—'}
                    </span>
                  </div>
                )}
                <MessageBubble
                  message={message}
                  conversationId={convId}
                  isOwn={isOwn}
                  showSender={showSender}
                  showTail={showTail}
                  replyToMessage={replyToMessage}
                  replyToSourceId={replyId ?? null}
                  onJumpToReplySource={jumpToMessage}
                  onOpenFooterActions={handleOpenFooterActions}
                  footerActionsTargetId={footerActionsMessage ? mid(footerActionsMessage) : null}
                  searchHighlightQuery={highlightQuery}
                  searchHitActive={Boolean(activeSearchHitId && mid(message) === activeSearchHitId)}
                />
              </div>
            );
          })}
        </div>
        )}
        <div ref={bottomRef} className="h-1 w-full shrink-0" aria-hidden />
      </div>

      {showScrollDown && (
        <button
          type="button"
          onClick={() => scrollToBottom('smooth')}
          className="absolute z-10 w-10 h-10 rounded-full bg-whatsapp-input text-whatsapp-text shadow-lg border border-whatsapp-border flex items-center justify-center hover:bg-whatsapp-hover transition-colors right-4 bottom-[max(5.75rem,calc(env(safe-area-inset-bottom)+5rem))] sm:right-6 sm:bottom-[88px]"
          aria-label="Ir para o fim"
        >
          <IoChevronDown className="w-6 h-6" />
        </button>
      )}

      {recordingVoice && (
        <div className="shrink-0 mx-2 mb-1 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-500/50 bg-red-950/35 px-3 py-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 min-w-0 flex-1">
            <div className="flex items-center gap-2.5 shrink-0">
              <span className="relative flex h-3 w-3 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
              </span>
              <span className="text-sm font-medium text-whatsapp-text tabular-nums">
                Gravando · {formatRecSeconds(recSeconds)}
              </span>
              <span className="text-xs text-whatsapp-text-secondary hidden sm:inline">
                (máx. 10 min)
              </span>
            </div>
            {voiceStream ? (
              <VoiceRecorderWaveform stream={voiceStream} barColor="#f87171" />
            ) : null}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={cancelVoiceRecording}
              className="rounded-lg border border-whatsapp-border px-3 py-1.5 text-sm text-whatsapp-text hover:bg-whatsapp-hover"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={sendVoiceRecording}
              className="rounded-lg bg-whatsapp-green px-3 py-1.5 text-sm font-semibold text-whatsapp-on-primary hover:bg-whatsapp-green-hover"
            >
              Enviar áudio
            </button>
          </div>
        </div>
      )}

      {replyingTo && (
        <div className="shrink-0 px-3 py-2 bg-whatsapp-input border-l-4 border-whatsapp-secondary flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-whatsapp-secondary">
              {displayNameFromAgenda(msgSender(replyingTo), agendaByAddress)}
            </p>
            <p className="text-sm text-whatsapp-text-secondary truncate">
              {(replyingTo.type ?? 'text') === 'image'
                ? 'Foto'
                : (replyingTo.type ?? 'text') === 'file'
                ? 'Arquivo'
                : (replyingTo.type ?? 'text') === 'audio'
                ? 'Áudio'
                : (replyingTo.type ?? 'text') === 'video'
                ? 'Vídeo'
                : replyingTo.content || 'Mensagem'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const rid = replyingTo ? mid(replyingTo) : null;
              setReplyingTo(null);
              setFooterEmojiOpen(false);
              if (rid) {
                setFooterActionsMessage((fm) => (fm && mid(fm) === rid ? null : fm));
              }
            }}
            className="p-1 rounded-full text-whatsapp-text-secondary hover:bg-whatsapp-hover"
            aria-label="Fechar resposta"
          >
            <IoClose className="w-5 h-5" />
          </button>
        </div>
      )}

      {footerActionsMessage && convId && (
        <div
          ref={footerActionsBarRef}
          className="footer-actions-emoji-anchor shrink-0 border-t border-white/[0.08] bg-whatsapp-sidebar/95 px-3 py-2.5 backdrop-blur-md"
        >
          <div className="mx-auto flex max-w-[min(100%,1000px)] flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-whatsapp-text-secondary">
                  Reagir
                </p>
                <p className="truncate text-sm text-whatsapp-text">
                  <span className="text-whatsapp-text-secondary">
                    {displayNameFromAgenda(msgSender(footerActionsMessage), agendaByAddress)}
                  </span>{' '}
                  · {footerMessagePreview(footerActionsMessage)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const fm = footerActionsMessage;
                  setFooterActionsMessage(null);
                  setFooterEmojiOpen(false);
                  setReplyingTo((r) => (fm && r && mid(r) === mid(fm) ? null : r));
                }}
                className="shrink-0 rounded-full p-1 text-whatsapp-text-secondary hover:bg-whatsapp-hover"
                aria-label="Fechar opções da mensagem"
              >
                <IoClose className="h-5 w-5" />
              </button>
            </div>
            <div className="relative flex w-full flex-wrap items-center gap-2">
              {orderedQuickReactionsList.map((em) => (
                <button
                  key={em}
                  type="button"
                  disabled={composerLocked || !mid(footerActionsMessage)}
                  onClick={() => {
                    const id = mid(footerActionsMessage);
                    if (id && convId) {
                      recordFooterReactionUsage(em);
                      setReactionUsageTick((t) => t + 1);
                      emitAddReaction(id, convId, em);
                    }
                  }}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-whatsapp-border bg-whatsapp-input text-lg leading-none hover:bg-whatsapp-hover disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={`Reagir com ${em}`}
                >
                  {em}
                </button>
              ))}
              <div>
                <button
                  type="button"
                  disabled={composerLocked}
                  onClick={() => setFooterEmojiOpen((o) => !o)}
                  className="rounded-lg border border-whatsapp-border bg-whatsapp-input px-3 py-2 text-xs font-medium text-whatsapp-text-secondary hover:bg-whatsapp-hover disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Mais emojis…
                </button>
              </div>
              {footerActionsIsOwn ? (
                <button
                  type="button"
                  onClick={() => setFooterDeleteModalOpen(true)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-whatsapp-border bg-whatsapp-input text-whatsapp-text-secondary hover:bg-whatsapp-hover hover:text-red-300"
                  aria-label="Apagar mensagem"
                  title="Apagar mensagem"
                >
                  <IoTrashOutline className="h-[18px] w-[18px]" />
                </button>
              ) : null}
              {footerEmojiOpen && (
                <div className="absolute bottom-full left-1/2 z-[120] mb-2 w-[min(320px,calc(100vw-1.5rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-whatsapp-border shadow-2xl">
                  <EmojiPicker
                    onEmojiClick={(d) => {
                      const emoji = d?.emoji ?? '';
                      const id = mid(footerActionsMessage);
                      if (id && convId && emoji) {
                        recordFooterReactionUsage(emoji);
                        setReactionUsageTick((t) => t + 1);
                        emitAddReaction(id, convId, emoji);
                      }
                      setFooterEmojiOpen(false);
                    }}
                    theme={Theme.DARK}
                    emojiStyle={EmojiStyle.NATIVE}
                    width={Math.min(320, typeof window !== 'undefined' ? window.innerWidth - 24 : 320)}
                    height={360}
                    searchPlaceHolder="Buscar emoji…"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {footerDeleteModalOpen && footerActionsMessage ? (
        <ConfirmActionSheet
          open
          titleId="footer-delete-msg-title"
          onClose={() => setFooterDeleteModalOpen(false)}
          title="Apagar mensagem?"
          description="Você pode ocultar só para você ou remover para todos na conversa. «Para todos» só funciona nas suas mensagens e conforme as regras do servidor."
          actions={[
            {
              key: 'me',
              label: 'Apagar para mim',
              className:
                'rounded-xl border border-whatsapp-border bg-whatsapp-input px-4 py-3 text-sm font-semibold text-whatsapp-text hover:bg-whatsapp-hover md:rounded-lg md:py-2.5',
              onClick: () => {
                const id = mid(footerActionsMessage);
                const fm = footerActionsMessage;
                if (id) deleteMessageForMe(id);
                setFooterDeleteModalOpen(false);
                setFooterActionsMessage(null);
                setFooterEmojiOpen(false);
                setReplyingTo((r) => (fm && r && mid(r) === mid(fm) ? null : r));
              },
            },
            {
              key: 'all',
              label: 'Apagar para todos',
              className:
                'rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white hover:bg-red-500 md:rounded-lg md:py-2.5',
              onClick: async () => {
                const id = mid(footerActionsMessage);
                const fm = footerActionsMessage;
                setFooterDeleteModalOpen(false);
                if (!id) return;
                const ok = await deleteMessageForEveryone(id);
                if (!ok) window.alert('Não foi possível apagar a mensagem para todos.');
                setFooterActionsMessage(null);
                setFooterEmojiOpen(false);
                setReplyingTo((r) => (fm && r && mid(r) === mid(fm) ? null : r));
              },
            },
            {
              key: 'cancel',
              label: 'Cancelar',
              className:
                'rounded-xl px-4 py-3 text-sm font-medium text-whatsapp-text-secondary hover:bg-whatsapp-hover md:rounded-lg md:py-2.5',
              onClick: () => setFooterDeleteModalOpen(false),
            },
          ]}
        />
      ) : null}

      <footer
        className="shrink-0 border-t border-white/[0.06] bg-whatsapp-input/95 px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-md"
        style={
          keyboardOverlapPx > 0
            ? {
                paddingBottom: `calc(max(0.5rem, env(safe-area-inset-bottom, 0px)) + ${keyboardOverlapPx}px)`,
              }
            : undefined
        }
      >
        {composerLocked && (
          <p className="max-w-[min(100%,1000px)] mx-auto mb-2 px-2 py-2 rounded-lg bg-amber-500/15 border border-amber-500/30 text-xs text-amber-100/95 leading-relaxed">
            Neste grupo, só os <strong className="font-semibold">administradores</strong> podem enviar mensagens e
            arquivos. Os demais membros podem ler e reagir.
          </p>
        )}
        {recError && (
          <p className="max-w-[min(100%,1000px)] mx-auto mb-1.5 px-1 text-xs text-red-300" role="alert">
            {recError}
          </p>
        )}
        <div className="flex items-end gap-2 max-w-[min(100%,1000px)] mx-auto relative">
          <input
            ref={attachInputRef}
            type="file"
            className="hidden"
            onChange={handleAttachPick}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImagePick}
          />
          <div
            ref={composerMenuRef}
            className="relative shrink-0 self-end emoji-picker-anchor"
          >
            <button
              type="button"
              disabled={composerLocked}
              onClick={() => {
                setComposerMenuOpen((o) => {
                  const next = !o;
                  if (next) setEmojiOpen(false);
                  return next;
                });
              }}
              className="p-2.5 mb-0.5 rounded-full text-whatsapp-text-secondary hover:bg-whatsapp-hover hover:text-whatsapp-text transition-colors disabled:opacity-40 disabled:pointer-events-none"
              aria-expanded={composerMenuOpen}
              aria-haspopup="menu"
              aria-label={composerMenuOpen ? 'Fechar opções de mensagem' : 'Opções de mensagem'}
            >
              <IoChevronDown
                className={`w-6 h-6 transition-transform duration-200 ${composerMenuOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {composerMenuOpen && (
              <div
                role="menu"
                className="absolute bottom-full left-0 mb-2 z-40 min-w-[12.5rem] py-1 rounded-xl shadow-2xl border border-whatsapp-border bg-whatsapp-sidebar overflow-hidden"
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={composerLocked}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left text-[15px] text-whatsapp-text hover:bg-whatsapp-hover transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  onClick={() => {
                    setComposerMenuOpen(false);
                    setEmojiOpen(true);
                  }}
                >
                  <IoHappy className="w-6 h-6 shrink-0 text-whatsapp-text-secondary" />
                  Emoji
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={composerLocked}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left text-[15px] text-whatsapp-text hover:bg-whatsapp-hover transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  onClick={() => {
                    setComposerMenuOpen(false);
                    attachInputRef.current?.click();
                  }}
                >
                  <IoAttach className="w-6 h-6 shrink-0 text-whatsapp-text-secondary" />
                  Anexar arquivo
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={composerLocked}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left text-[15px] text-whatsapp-text hover:bg-whatsapp-hover transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  onClick={() => {
                    setComposerMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                >
                  <IoImage className="w-6 h-6 shrink-0 text-whatsapp-text-secondary" />
                  Enviar imagem
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={composerLocked}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left text-[15px] text-whatsapp-text hover:bg-whatsapp-hover transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  onClick={() => {
                    setComposerMenuOpen(false);
                    setCameraOpen(true);
                  }}
                >
                  <IoCamera className="w-6 h-6 shrink-0 text-whatsapp-text-secondary" />
                  Tirar foto
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!canSendCryptoPayment}
                  title={
                    !isPrivate
                      ? 'Pagamentos em cripto só em conversas privadas.'
                      : !otherPrivateMember?.address
                        ? 'Aguardando dados do contato.'
                        : !hasEthereumProvider()
                          ? 'Conecte uma carteira para enviar cripto.'
                          : undefined
                  }
                  className="w-full flex items-center gap-3 px-4 py-3 text-left text-[15px] text-whatsapp-text hover:bg-whatsapp-hover transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  onClick={() => {
                    setComposerMenuOpen(false);
                    setPaymentModalOpen(true);
                  }}
                >
                  <IoWallet className="w-6 h-6 shrink-0 text-whatsapp-text-secondary" />
                  Enviar pagamento cripto
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={composerLocked || !convId || recordingVoice}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left text-[15px] text-whatsapp-text hover:bg-whatsapp-hover transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  onClick={() => {
                    setComposerMenuOpen(false);
                    startVoiceRecording();
                  }}
                >
                  <IoMic className="w-6 h-6 shrink-0 text-whatsapp-text-secondary" />
                  Mensagem de voz
                </button>
              </div>
            )}
            {emojiOpen && (
              <div className="absolute bottom-full left-0 mb-2 z-50 shadow-2xl rounded-xl overflow-hidden border border-whatsapp-border max-w-[min(calc(100vw-1rem),320px)]">
                <EmojiPicker
                  onEmojiClick={onEmojiClick}
                  theme="dark"
                  emojiStyle={EmojiStyle.NATIVE}
                  width={Math.min(320, typeof window !== 'undefined' ? window.innerWidth - 24 : 320)}
                  height={400}
                />
              </div>
            )}
          </div>
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            readOnly={composerLocked}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            onPaste={handleComposerPaste}
            onFocus={() => {
              composerFocusedRef.current = true;
            }}
            onBlur={() => {
              composerFocusedRef.current = false;
              stopTyping();
            }}
            placeholder={
              composerLocked ? 'Apenas administradores podem escrever' : 'Escrever mensagem'
            }
            className={`flex-1 min-w-0 max-h-[120px] resize-none rounded-lg bg-whatsapp-dark px-3 py-2.5 text-[15px] text-whatsapp-text placeholder:text-whatsapp-text-secondary outline-none border border-whatsapp-border/40 focus:border-whatsapp-green/50 leading-[1.35] ${
              composerLocked ? 'opacity-60 cursor-not-allowed' : ''
            }`}
          />
          <button
            type="button"
            onPointerDown={(e) => {
              if (composerLocked || !text.trim()) return;
              // iOS: evita que o botão roube o foco do textarea e feche o teclado
              e.preventDefault();
            }}
            onClick={handleSend}
            disabled={!text.trim() || composerLocked}
            className="p-2 mb-0.5 rounded-full text-whatsapp-green hover:bg-whatsapp-hover disabled:opacity-40 disabled:hover:bg-transparent transition-colors shrink-0 touch-manipulation"
            aria-label="Enviar"
          >
            <IoSend className="w-7 h-7" />
          </button>
        </div>
      </footer>

      <CameraModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={handleCameraCapture}
      />

      <PaymentSendModal
        open={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        recipientAddress={otherPrivateMember?.address || ''}
        onPaymentComplete={handlePaymentPayload}
      />

      <ImageSendModal
        open={imageSendOpen && !!pendingImageFile}
        file={pendingImageFile}
        onClose={closeImageSendModal}
        onSend={sendEditedImage}
      />

      <ContactInfoModal
        open={contactInfoOpen}
        onClose={() => setContactInfoOpen(false)}
        isGroup={isGroup}
        title={headerTitle}
        members={members}
        privateContact={otherPrivateMember}
        conversationId={convId || null}
        userAddress={user?.address}
        onlineUsers={onlineUsers}
        privateAgendaRow={
          otherPrivateMember?.address
            ? agendaByAddress.get(String(otherPrivateMember.address).toLowerCase()) ?? null
            : null
        }
        onAgendaApelidoSaved={() => void refreshAgenda()}
        groupConversationId={isGroup ? convId : null}
        iAmGroupAdmin={iAmGroupAdmin}
        groupOnlyAdminsPost={Number(activeConversation?.group_only_admins_post) === 1}
        groupCreatedBy={activeConversation?.created_by ?? null}
        onUpdateOnlyAdminsPost={
          isGroup && convId ? (next) => updateGroupSettings(convId, next) : undefined
        }
        onSetMemberRole={
          isGroup && convId
            ? (addr, role) => setGroupMemberRole(convId, addr, role)
            : undefined
        }
      />
    </div>
  );
}
