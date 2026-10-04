import { useState, useRef, useEffect, useMemo } from 'react';
import ImageLightbox from './ImageLightbox';
import { formatTimeBrFromRaw } from '../utils/brDateTime';
import { useChat } from '../contexts/ChatContext';
import { useAuth } from '../contexts/AuthContext';
import { parseE2eAttachmentMeta } from '../utils/e2eAttachment';
import { getHighlightRangesForText } from '../utils/conversationSearch';
import {
  IoCheckmark,
  IoCheckmarkDone,
  IoDocument,
  IoDownload,
  IoLockClosed,
  IoOpenOutline,
  IoPlay,
} from 'react-icons/io5';
import {
  formatPaymentAmount,
  getExplorerTxUrl,
  parsePaymentMessagePayload,
} from '../utils/cryptoPayments';

export function addressToColor(address) {
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
  const hash = address
    .split('')
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

export function formatAddress(addr) {
  return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '';
}

/** Apelido ou nickname da agenda; senão endereço truncado. */
export function displayNameFromAgenda(addr, agendaByAddress) {
  const raw = String(addr || '').trim();
  if (!raw) return '';
  const peer = raw.toLowerCase();
  const map = agendaByAddress instanceof Map ? agendaByAddress : new Map();
  const row = map.get(peer);
  if (row) {
    const ap = String(row.apelido || '').trim();
    if (ap.length >= 1) return ap;
    const nk = String(row.nickname || '').trim();
    if (nk.length >= 1) return nk;
  }
  return formatAddress(raw);
}

function msgSender(m) {
  return m?.sender ?? m?.sender_address ?? '';
}

function msgContent(m) {
  return m?.content ?? '';
}

function msgType(m) {
  return m?.type ?? 'text';
}

function msgId(m) {
  return m?.id ?? m?._id;
}

function isInteractiveBubbleTarget(node) {
  if (!node || typeof Element === 'undefined' || !(node instanceof Element)) return false;
  return Boolean(
    node.closest('a, button, input, textarea, select, audio, video, [role="button"], [role="link"]')
  );
}

/** Botões para pedir assinatura MetaMask (sem chaves) ou recarregar mensagens (cache/DEK desatualizado). */
function E2eDecryptRecoveryRow({ decryptError, e2eMediaError = false }) {
  const { encryptionKeys, initEncryption } = useAuth();
  const { reloadActiveConversationMessages } = useChat();
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState('');

  const hasKeys = Boolean(encryptionKeys);
  const showWallet = !hasKeys;
  const showReload =
    hasKeys &&
    Boolean(
      e2eMediaError ||
        (decryptError && decryptError !== 'no_keys')
    );

  if (!showWallet && !showReload) return null;

  const onWallet = async () => {
    setLocalErr('');
    setBusy(true);
    try {
      const r = await initEncryption();
      if (r && r.ok === false && r.error !== 'already') {
        const m = String(r.error || '');
        setLocalErr(m.length > 120 ? `${m.slice(0, 120)}…` : m || 'Falhou.');
      }
    } finally {
      setBusy(false);
    }
  };

  const onReload = async () => {
    setLocalErr('');
    setBusy(true);
    try {
      await reloadActiveConversationMessages();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-2 border-t border-white/10 pt-2">
      {localErr ? (
        <p className="text-[11px] leading-snug text-red-300" role="alert">
          {localErr}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {showWallet ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onWallet()}
            className="rounded-lg bg-whatsapp-green/90 px-3 py-1.5 text-xs font-semibold text-whatsapp-on-primary disabled:opacity-50 touch-manipulation"
          >
            {busy ? 'Carteira…' : 'Assinar na MetaMask / carteira'}
          </button>
        ) : null}
        {showReload ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onReload()}
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-whatsapp-text disabled:opacity-50 touch-manipulation"
          >
            {busy ? 'Recarregando…' : 'Recarregar mensagens'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function aggregateReactions(reactions, myAddress) {
  const me = (myAddress || '').toLowerCase();
  const byEmoji = new Map();
  for (const r of reactions || []) {
    const em = r.emoji ?? '';
    if (!em) continue;
    if (!byEmoji.has(em)) {
      byEmoji.set(em, { emoji: em, count: 0, myIds: [] });
    }
    const g = byEmoji.get(em);
    g.count += 1;
    if (String(r.user_address ?? '').toLowerCase() === me) {
      g.myIds.push(Number(r.id));
    }
  }
  return [...byEmoji.values()].sort((a, b) => b.count - a.count);
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function HighlightedMessageText({ text, query }) {
  const ranges = useMemo(
    () => getHighlightRangesForText(text ?? '', query),
    [text, query]
  );
  const q = String(query || '').trim();
  if (!q || ranges.length === 0) {
    return <>{text}</>;
  }
  const parts = [];
  let last = 0;
  ranges.forEach(([s, e], idx) => {
    if (s > last) parts.push(<span key={`t-${idx}-a`}>{text.slice(last, s)}</span>);
    parts.push(
      <mark
        key={`t-${idx}-h`}
        className="rounded-sm bg-yellow-400/90 px-0.5 text-inherit [box-decoration-break:clone]"
      >
        {text.slice(s, e)}
      </mark>
    );
    last = e;
  });
  if (last < text.length) parts.push(<span key="t-end">{text.slice(last)}</span>);
  return <>{parts}</>;
}

function statusIcon(status) {
  const gray = 'text-whatsapp-text-secondary';
  const blue = 'text-whatsapp-green-hover';
  if (status === 'read') {
    return (
      <span className={`inline-flex items-center shrink-0 ${blue}`} title="Lida">
        <IoCheckmarkDone className="w-[18px] h-[18px] -mr-2.5" />
        <IoCheckmarkDone className="w-[18px] h-[18px]" />
      </span>
    );
  }
  if (status === 'delivered') {
    return (
      <span className={`inline-flex items-center shrink-0 ${gray}`} title="Entregue">
        <IoCheckmarkDone className="w-[18px] h-[18px] -mr-2.5" />
        <IoCheckmarkDone className="w-[18px] h-[18px]" />
      </span>
    );
  }
  return (
    <span className={`shrink-0 ${gray}`} title="Enviada">
      <IoCheckmark className="w-[18px] h-[18px]" />
    </span>
  );
}

function FileMessage({ content, fileName, fileSize }) {
  const displayName = fileName || content.split('/').pop() || 'Arquivo';
  return (
    <a
      href={content}
      target="_blank"
      rel="noopener noreferrer"
      download={displayName}
      className="flex items-center gap-3 p-2 rounded-lg bg-black/15 hover:bg-black/25 transition-colors mb-1"
    >
      <div className="w-10 h-10 rounded-lg bg-whatsapp-green/20 flex items-center justify-center shrink-0">
        <IoDocument className="w-5 h-5 text-whatsapp-green" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-whatsapp-text truncate">{displayName}</p>
        {fileSize && (
          <p className="text-[11px] text-whatsapp-text-secondary">{formatFileSize(fileSize)}</p>
        )}
      </div>
      <IoDownload className="w-5 h-5 text-whatsapp-text-secondary shrink-0" />
    </a>
  );
}

function AudioMessage({ content }) {
  const audioRef = useRef(null);
  const canvasRef = useRef(null);
  const graphRef = useRef(null);

  const drawIdle = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const c = canvas.getContext('2d');
    if (!c) return;
    const w = canvas.width;
    const h = canvas.height;
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,0.12)';
    const n = 36;
    const bw = w / n - 1;
    for (let i = 0; i < n; i++) {
      const bh = 4 + (i % 5) * 2;
      c.fillRect(i * (bw + 1), h - bh, bw, bh);
    }
  };

  useEffect(() => {
    drawIdle();
  }, [content]);

  useEffect(
    () => () => {
      const g = graphRef.current;
      if (g?.raf) cancelAnimationFrame(g.raf);
      graphRef.current = null;
      if (g?.audioCtx) g.audioCtx.close().catch(() => {});
    },
    []
  );

  const setupGraphOnce = async () => {
    const audio = audioRef.current;
    const canvas = canvasRef.current;
    if (!audio || !canvas || graphRef.current) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AC();
      await audioCtx.resume();
      const srcNode = audioCtx.createMediaElementSource(audio);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.7;
      srcNode.connect(analyser);
      analyser.connect(audioCtx.destination);
      graphRef.current = { audioCtx, analyser, raf: null, active: false };
    } catch {
      drawIdle();
    }
  };

  const startLevelLoop = () => {
    const g = graphRef.current;
    const canvas = canvasRef.current;
    if (!g?.analyser || !canvas) return;
    if (g.raf) cancelAnimationFrame(g.raf);
    const c = canvas.getContext('2d');
    if (!c) return;
    const data = new Uint8Array(g.analyser.frequencyBinCount);
    const barCount = 36;
    g.active = true;
    const draw = () => {
      if (!g.active) return;
      g.raf = requestAnimationFrame(draw);
      g.analyser.getByteFrequencyData(data);
      const w = canvas.width;
      const h = canvas.height;
      c.clearRect(0, 0, w, h);
      const step = Math.max(1, Math.floor(data.length / barCount));
      const barW = w / barCount - 1;
      for (let i = 0; i < barCount; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += data[i * step + j];
        const v = sum / step / 255;
        const bh = Math.max(3, v * h * 0.9);
        const x = i * (barW + 1);
        c.fillStyle = 'rgba(52, 211, 153, 0.85)';
        c.fillRect(x, h - bh, barW, bh);
      }
    };
    draw();
  };

  const onPlay = async () => {
    await setupGraphOnce();
    const g = graphRef.current;
    if (g?.audioCtx) await g.audioCtx.resume();
    startLevelLoop();
  };

  const onPause = () => {
    const g = graphRef.current;
    if (g) {
      g.active = false;
      if (g.raf) {
        cancelAnimationFrame(g.raf);
        g.raf = null;
      }
    }
    drawIdle();
  };

  if (!content) return null;
  return (
    <div className="mb-1 min-w-0 w-full max-w-full sm:min-w-[200px] sm:max-w-[280px] rounded-xl bg-black/20 p-2 space-y-1.5">
      <canvas
        ref={canvasRef}
        width={220}
        height={36}
        className="w-full rounded-md opacity-95"
        aria-hidden
      />
      <audio
        ref={audioRef}
        controls
        preload="metadata"
        playsInline
        className="h-9 w-full"
        src={content}
        onPlay={onPlay}
        onPause={onPause}
        onEnded={onPause}
      />
    </div>
  );
}

function VideoMessage({ content }) {
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef(null);

  return (
    <div className="relative rounded-lg overflow-hidden mb-1 max-w-full sm:max-w-[300px]">
      <video
        ref={videoRef}
        src={content}
        preload="metadata"
        className="w-full h-auto rounded-md"
        controls={playing}
        onClick={() => {
          if (!playing) {
            setPlaying(true);
            videoRef.current?.play();
          }
        }}
      />
      {!playing && (
        <button
          type="button"
          onClick={() => {
            setPlaying(true);
            videoRef.current?.play();
          }}
          className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/40 transition-colors"
        >
          <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
            <IoPlay className="w-6 h-6 text-black ml-0.5" />
          </div>
        </button>
      )}
    </div>
  );
}

export default function MessageBubble({
  message,
  conversationId,
  isOwn,
  showSender,
  showTail,
  replyToMessage,
  replyToSourceId = null,
  onJumpToReplySource = null,
  searchHighlightQuery = '',
  searchHitActive = false,
  onOpenFooterActions,
  footerActionsTargetId = null,
}) {
  const {
    deleteMessageForEveryone,
    deleteMessageForMe,
    emitAddReaction,
    emitRemoveReaction,
    resolveE2eAttachmentUrl,
    agendaByAddress,
  } = useChat();
  const { user } = useAuth();
  const [imageLightboxOpen, setImageLightboxOpen] = useState(false);
  const type = msgType(message);
  const sender = msgSender(message);
  const content = msgContent(message);
  const status = message?.status ?? 'sent';
  const isEncrypted =
    Number(message?.encrypted) === 1 || message?.encrypted === true || message?._decrypted;

  const mediaTypes = ['image', 'audio', 'video', 'file'];
  const attachmentMeta =
    mediaTypes.includes(type) ? parseE2eAttachmentMeta(content) : null;
  const [resolvedMediaUrl, setResolvedMediaUrl] = useState(() => {
    if (!mediaTypes.includes(type)) return '';
    if (!attachmentMeta) return content || '';
    return '';
  });
  const [e2eMediaError, setE2eMediaError] = useState(false);

  useEffect(() => {
    if (!mediaTypes.includes(type)) {
      setResolvedMediaUrl('');
      setE2eMediaError(false);
      return;
    }
    const meta = parseE2eAttachmentMeta(content);
    if (!meta) {
      setResolvedMediaUrl(content || '');
      setE2eMediaError(false);
      return;
    }
    let alive = true;
    let objectUrl = null;
    setResolvedMediaUrl('');
    setE2eMediaError(false);
    resolveE2eAttachmentUrl(message, meta)
      .then((u) => {
        if (!alive) {
          URL.revokeObjectURL(u);
          return;
        }
        objectUrl = u;
        setResolvedMediaUrl(u);
      })
      .catch(() => {
        if (alive) {
          setResolvedMediaUrl('');
          setE2eMediaError(true);
        }
      });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [message, content, type, resolveE2eAttachmentUrl]);

  const mediaSrc = mediaTypes.includes(type) ? resolvedMediaUrl : content;

  const reactionGroups = useMemo(
    () => aggregateReactions(message.reactions, user?.address),
    [message.reactions, user?.address]
  );

  const senderDisplay = useMemo(
    () => displayNameFromAgenda(sender, agendaByAddress),
    [sender, agendaByAddress]
  );
  const replyQuoteSenderDisplay = useMemo(
    () => (replyToMessage ? displayNameFromAgenda(msgSender(replyToMessage), agendaByAddress) : ''),
    [replyToMessage, agendaByAddress]
  );

  const mid = msgId(message);

  const isFooterTarget =
    footerActionsTargetId != null &&
    String(footerActionsTargetId) === String(mid);

  const handleBubbleClick = (e) => {
    if (!conversationId || type === 'system' || !onOpenFooterActions) return;
    if (isInteractiveBubbleTarget(e.target)) return;
    try {
      const sel = typeof window !== 'undefined' ? window.getSelection?.() : null;
      if (sel && String(sel.toString()).trim().length > 0) return;
    } catch {
      /* ignore */
    }
    onOpenFooterActions(message);
  };

  const replyQuotedSnippet = replyToMessage ? (
    <>
      <p className="text-[11px] font-semibold text-whatsapp-green truncate">
        {formatAddress(msgSender(replyToMessage))}
      </p>
      <p className="text-xs text-whatsapp-text-secondary truncate">
        {msgType(replyToMessage) === 'image' ? (
          'Foto'
        ) : msgType(replyToMessage) === 'file' ? (
          'Arquivo'
        ) : msgType(replyToMessage) === 'audio' ? (
          'Áudio'
        ) : msgType(replyToMessage) === 'video' ? (
          'Vídeo'
        ) : msgType(replyToMessage) === 'payment' ? (
          'Pagamento cripto'
        ) : (
          <HighlightedMessageText
            text={msgContent(replyToMessage) || 'Mensagem'}
            query={searchHighlightQuery}
          />
        )}
      </p>
    </>
  ) : null;

  if (type === 'system') {
    return (
      <div className="flex justify-center py-1 px-6 message-enter">
        <p
          className={`text-xs text-whatsapp-text-secondary italic text-center max-w-md rounded px-1 transition-shadow ${
            searchHitActive ? 'ring-2 ring-yellow-400/70 ring-offset-2 ring-offset-whatsapp-chat-pattern' : ''
          }`}
        >
          <HighlightedMessageText text={content} query={searchHighlightQuery} />
        </p>
      </div>
    );
  }

  const roundedOwn = showTail
    ? 'rounded-2xl rounded-br-sm'
    : 'rounded-2xl';
  const roundedOther = showTail
    ? 'rounded-2xl rounded-bl-sm'
    : 'rounded-2xl';

  /* Largura em % do painel do chat — evita usar 100vw (no iOS com duas colunas ficava maior que a coluna). */
  const bubbleBase =
    'relative max-w-[min(88%,26rem)] sm:max-w-[min(92%,40rem)] min-w-[72px] px-3 pt-2 pb-1.5 sm:px-2.5 sm:pt-1.5 sm:pb-1 shadow-sm';

  return (
    <div
      className={`flex w-full min-w-0 message-enter ${isOwn ? 'justify-end' : 'justify-start'} px-2.5 sm:px-4 py-0.5 ${
        searchHitActive ? 'relative z-[2]' : ''
      }`}
    >
      <div
        className={`relative max-w-full min-w-0 ${isOwn ? 'items-end' : 'items-start'} flex flex-col`}
      >
        <div
          title={conversationId && type !== 'system' && onOpenFooterActions ? 'Responder e reagir' : undefined}
          onClick={handleBubbleClick}
          className={`${bubbleBase} ${
            isOwn
              ? `bg-whatsapp-outgoing text-whatsapp-text ${roundedOwn}`
              : `bg-whatsapp-incoming text-whatsapp-text ${roundedOther}`
          } ${searchHitActive ? 'ring-2 ring-yellow-400/85 ring-offset-2 ring-offset-whatsapp-chat-pattern' : ''} ${
            conversationId && type !== 'system' && onOpenFooterActions
              ? `cursor-pointer ${
                  isFooterTarget && !searchHitActive
                    ? 'ring-2 ring-whatsapp-green/50 ring-offset-2 ring-offset-whatsapp-chat-pattern'
                    : ''
                }`
              : ''
          }`}
        >
          {showTail && (
            <span
              className="absolute bottom-0 w-3 h-3 overflow-hidden pointer-events-none z-0"
              style={isOwn ? { right: -4 } : { left: -4 }}
              aria-hidden
            >
              <span
                className="absolute block w-3 h-3 rotate-45"
                style={{
                  backgroundColor: isOwn ? '#14532d' : '#18181b',
                  bottom: 2,
                  ...(isOwn ? { right: 2 } : { left: 2 }),
                }}
              />
            </span>
          )}

          <div className="relative z-[1]">
            {showSender && !isOwn && (
              <p
                className="text-[13px] font-medium mb-0.5 px-0.5"
                style={{ color: addressToColor(sender) }}
                title={sender && sender !== senderDisplay ? sender : undefined}
              >
                {senderDisplay}
              </p>
            )}

            {replyToMessage && replyQuotedSnippet && (
              <div className="mb-1 pl-2 py-1 pr-1 rounded-md bg-black/15 border-l-[3px] border-whatsapp-green opacity-95">
                {onJumpToReplySource &&
                replyToSourceId != null &&
                String(replyToSourceId) !== '' ? (
                  <button
                    type="button"
                    title="Ir à mensagem citada"
                    aria-label="Ir à mensagem citada"
                    onClick={() => void onJumpToReplySource(replyToSourceId)}
                    className="w-full cursor-pointer -mx-0.5 rounded px-0.5 text-left transition-colors hover:bg-black/25 active:bg-black/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp-green/55"
                  >
                    {replyQuotedSnippet}
                  </button>
                ) : (
                  replyQuotedSnippet
                )}
              </div>
            )}

            {type === 'image' && content ? (
              e2eMediaError ? (
                <div className="py-1 px-1">
                  <p className="text-xs text-red-300 py-1">
                    Não foi possível descriptografar a imagem.
                  </p>
                  <E2eDecryptRecoveryRow decryptError={null} e2eMediaError />
                </div>
              ) : mediaSrc ? (
                <>
                  <button
                    type="button"
                    onClick={() => setImageLightboxOpen(true)}
                    className="block w-full rounded-lg overflow-hidden mb-1 border-0 p-0 bg-transparent cursor-zoom-in text-left"
                    aria-label="Ver imagem em tela cheia"
                  >
                    <img
                      src={mediaSrc}
                      alt=""
                      className="max-w-full sm:max-w-[300px] w-full h-auto object-cover rounded-md pointer-events-none select-none"
                      loading="lazy"
                    />
                  </button>
                  <ImageLightbox
                    open={imageLightboxOpen}
                    src={mediaSrc}
                    alt="Imagem da conversa"
                    onClose={() => setImageLightboxOpen(false)}
                  />
                </>
              ) : (
                <p className="text-xs text-whatsapp-text-secondary py-2 px-1">
                  Descriptografando imagem…
                </p>
              )
            ) : null}

            {type === 'file' && content ? (
              e2eMediaError ? (
                <div className="py-1 px-1">
                  <p className="text-xs text-red-300 py-1">
                    Não foi possível descriptografar o arquivo.
                  </p>
                  <E2eDecryptRecoveryRow decryptError={null} e2eMediaError />
                </div>
              ) : attachmentMeta && !mediaSrc ? (
                <p className="text-xs text-whatsapp-text-secondary py-2 px-1">
                  Descriptografando arquivo…
                </p>
              ) : (
                <FileMessage
                  content={mediaSrc}
                  fileName={attachmentMeta?.n || message?.file_name}
                  fileSize={attachmentMeta?.s ?? message?.file_size}
                />
              )
            ) : null}

            {type === 'audio' &&
              (e2eMediaError ? (
                <div className="py-1 px-1">
                  <p className="text-xs text-red-300 py-1">
                    Não foi possível descriptografar o áudio.
                  </p>
                  <E2eDecryptRecoveryRow decryptError={null} e2eMediaError />
                </div>
              ) : mediaSrc ? (
                <AudioMessage content={mediaSrc} />
              ) : (
                <p className="text-xs text-whatsapp-text-secondary py-2 px-1">
                  Descriptografando áudio…
                </p>
              ))}

            {type === 'video' &&
              (e2eMediaError ? (
                <div className="py-1 px-1">
                  <p className="text-xs text-red-300 py-1">
                    Não foi possível descriptografar o vídeo.
                  </p>
                  <E2eDecryptRecoveryRow decryptError={null} e2eMediaError />
                </div>
              ) : mediaSrc ? (
                <VideoMessage content={mediaSrc} />
              ) : (
                <p className="text-xs text-whatsapp-text-secondary py-2 px-1">
                  Descriptografando vídeo…
                </p>
              ))}

            {type === 'payment' && content ? (
              (() => {
                const pay = parsePaymentMessagePayload(content);
                if (!pay) {
                  return (
                    <p className="text-xs text-amber-200/90 py-1">
                      Registro de pagamento inválido ou versão antiga.
                    </p>
                  );
                }
                const explorerUrl = getExplorerTxUrl(pay.chainId, pay.txHash);
                const amountHuman = formatPaymentAmount(pay.valueWei);
                return (
                  <div className="mb-1 min-w-[200px] max-w-full space-y-2 rounded-xl border border-whatsapp-green/35 bg-black/20 px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-whatsapp-green">
                      Transferência on-chain
                    </p>
                    <p className="text-lg font-semibold tabular-nums text-whatsapp-text">
                      {amountHuman}{' '}
                      <span className="text-sm font-medium text-whatsapp-text-secondary">
                        {pay.nativeSymbol || 'ETH'}
                      </span>
                    </p>
                    <p className="text-[10px] text-whatsapp-text-secondary">
                      {isOwn ? 'Para' : 'De'}{' '}
                      <span className="font-mono text-whatsapp-text/90">
                        {displayNameFromAgenda(isOwn ? pay.to : pay.from, agendaByAddress)}
                      </span>
                    </p>
                    <p className="break-all font-mono text-[10px] leading-snug text-whatsapp-text-secondary/90">
                      {pay.txHash}
                    </p>
                    {explorerUrl ? (
                      <a
                        href={explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-whatsapp-green hover:underline"
                      >
                        <IoOpenOutline className="h-4 w-4 shrink-0" aria-hidden />
                        Abrir no explorador
                      </a>
                    ) : (
                      <p className="text-[10px] text-whatsapp-text-secondary">
                        Explorador de blocos não configurado para a rede {pay.chainId}.
                      </p>
                    )}
                  </div>
                );
              })()
            ) : null}

            {type === 'text' && (
              <div className="min-w-0">
                <p className="text-[16px] leading-[1.4] sm:text-[14.2px] sm:leading-[1.45] whitespace-pre-wrap break-normal [overflow-wrap:anywhere]">
                  <HighlightedMessageText text={content} query={searchHighlightQuery} />
                </p>
                {message._decryptError ? (
                  <E2eDecryptRecoveryRow decryptError={message._decryptError} />
                ) : null}
              </div>
            )}

            <div className="flex justify-end items-end gap-1 mt-1 -mb-0.5 pl-4 sm:pl-6 min-h-[22px]">
              {isEncrypted && (
                <IoLockClosed className="w-3.5 h-3.5 sm:w-3 sm:h-3 text-whatsapp-text-secondary/70" title="Criptografada de ponta a ponta" />
              )}
              <span className="text-[12px] sm:text-[11px] text-whatsapp-text-secondary/90 tabular-nums leading-none pt-0.5 select-none">
                {formatTime(message)}
              </span>
              {isOwn ? statusIcon(status) : null}
            </div>
          </div>
        </div>

        {conversationId && reactionGroups.length > 0 && (
          <div
            className={`flex flex-wrap items-center gap-1 mt-1 max-w-[min(88%,26rem)] sm:max-w-[min(92%,40rem)] ${
              isOwn ? 'justify-end self-end' : 'justify-start self-start'
            }`}
          >
            {reactionGroups.map((g) => (
              <button
                key={g.emoji}
                type="button"
                title={
                  g.myIds.length > 0
                    ? 'Clique para retirar uma das suas reações com este emoji'
                    : 'Clique para reagir com este emoji'
                }
                onClick={() => {
                  if (!conversationId || !mid) return;
                  if (g.myIds.length > 0) {
                    const lastId = Math.max(...g.myIds);
                    emitRemoveReaction(lastId, conversationId);
                  } else {
                    emitAddReaction(mid, conversationId, g.emoji);
                  }
                }}
                className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-sm bg-whatsapp-input/95 border border-whatsapp-border/60 hover:bg-whatsapp-hover text-whatsapp-text shadow-sm transition-colors"
              >
                <span className="leading-none">{g.emoji}</span>
                {g.count > 1 ? (
                  <span className="text-[11px] text-whatsapp-text-secondary tabular-nums">
                    {g.count}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(message) {
  const raw = message?.createdAt ?? message?.created_at;
  if (!raw) return '';
  return formatTimeBrFromRaw(raw);
}
