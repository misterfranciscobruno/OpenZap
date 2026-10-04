import { useState, useEffect, useRef, useMemo } from 'react';
import {
  IoArrowBack,
  IoCheckmark,
  IoCamera,
  IoNotificationsOutline,
  IoNotificationsOff,
  IoVolumeHigh,
} from 'react-icons/io5';
import { HiPencilSquare, HiClipboardDocument } from 'react-icons/hi2';
import { useAuth } from '../contexts/AuthContext';
import { useChat } from '../contexts/ChatContext';
import { useCall } from '../contexts/CallContext';
import { apiFetch } from '../utils/apiFetch';
import { formatAddress, displayNameFromAgenda } from './MessageBubble';
import ConfirmActionSheet from './shell/ConfirmActionSheet';
import AudioSettingsPanel from './AudioSettingsPanel';
import {
  getNotificationPermission,
  notificationsSupported,
  requestNotificationPermission,
} from '../utils/browserNotifications';

function convId(c) {
  if (c == null) return '';
  return String(c._id ?? c.id ?? '');
}

/** Nome curto da conversa para a lista (alinhado à barra lateral). */
function conversationLabel(conv, user, agendaByAddress) {
  if (!conv) return '';
  if (conv.type === 'group') return (conv.name || '').trim() || 'Grupo';
  const uid = (user?.address || '').toLowerCase();
  const peer = String(conv.peer_address || conv.peerAddress || '')
    .trim()
    .toLowerCase();
  if (peer && peer !== uid) {
    return displayNameFromAgenda(peer, agendaByAddress) || formatAddress(peer);
  }
  const nick = String(conv.peer_nickname || conv.peerNickname || conv.nickname || '').trim();
  if (nick) return nick;
  const nm = String(conv.name || '').trim();
  if (nm) return nm;
  return 'Conversa privada';
}

export default function ProfilePanel({ open, onClose }) {
  const { user, updateProfile, deleteAccount } = useAuth();
  const {
    conversations,
    agendaByAddress,
    isConversationNotificationMuted,
    setConversationNotificationMuted,
    muteAllConversationNotifications,
    unmuteAllConversationNotifications,
  } = useChat();
  const { audioSettings, updateAudioSettings } = useCall();
  const [editingName, setEditingName] = useState(false);
  const [editingBio, setEditingBio] = useState(false);
  const [nickname, setNickname] = useState('');
  const [bio, setBio] = useState('');
  const [copied, setCopied] = useState(false);
  const [notifPermission, setNotifPermission] = useState(() => getNotificationPermission());
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteAccountText, setDeleteAccountText] = useState('');
  const [deleteAccountBusy, setDeleteAccountBusy] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    if (open && user) {
      setNickname(user.nickname || '');
      setBio(user.bio || '');
      setEditingName(false);
      setEditingBio(false);
      setNotifPermission(getNotificationPermission());
    }
    if (!open) {
      setDeleteAccountOpen(false);
      setDeleteAccountText('');
      setDeleteAccountError('');
      setDeleteAccountBusy(false);
    }
  }, [open, user]);

  const closeDeleteAccountDialog = () => {
    if (deleteAccountBusy) return;
    setDeleteAccountOpen(false);
    setDeleteAccountText('');
    setDeleteAccountError('');
  };

  const handleConfirmDeleteAccount = async () => {
    if (deleteAccountText.trim().toUpperCase() !== 'EXCLUIR') return;
    setDeleteAccountBusy(true);
    setDeleteAccountError('');
    try {
      await deleteAccount();
    } catch (err) {
      setDeleteAccountError(
        err?.message || 'Não foi possível excluir a conta. Tente novamente em alguns instantes.'
      );
      setDeleteAccountBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    const onVis = () => setNotifPermission(getNotificationPermission());
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [open]);

  const sortedConversations = useMemo(() => {
    const list = (conversations || []).filter((c) => c != null && convId(c));
    return [...list].sort(
      (a, b) =>
        new Date(b.updatedAt || b.last_message_at || b.created_at || 0) -
        new Date(a.updatedAt || a.last_message_at || a.created_at || 0)
    );
  }, [conversations]);

  const anyConversationNotifMuted = useMemo(
    () => sortedConversations.some((c) => isConversationNotificationMuted(convId(c))),
    [sortedConversations, isConversationNotificationMuted]
  );
  const allConversationsNotifMuted = useMemo(
    () =>
      sortedConversations.length > 0 &&
      sortedConversations.every((c) => isConversationNotificationMuted(convId(c))),
    [sortedConversations, isConversationNotificationMuted]
  );

  const handleSaveName = async () => {
    setEditingName(false);
    try {
      await updateProfile({ nickname: nickname.trim() || null });
    } catch { /* ignore */ }
  };

  const handleSaveBio = async () => {
    setEditingBio(false);
    try {
      await updateProfile({ bio: bio.trim() || null });
    } catch { /* ignore */ }
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await apiFetch('/api/upload', { method: 'POST', body: fd });
      if (res.ok) {
        const data = await res.json();
        if (data.url) await updateProfile({ avatar: data.url });
      }
    } catch { /* ignore */ }
  };

  const handleEnableNotifications = async () => {
    const r = await requestNotificationPermission();
    setNotifPermission(r === 'unsupported' ? getNotificationPermission() : r);
  };

  const copyAddress = () => {
    if (user?.address) {
      navigator.clipboard.writeText(user.address).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const userInitials = (user?.address || '').replace(/^0x/i, '').slice(0, 2).toUpperCase() || 'OZ';

  return (
    <div
      className={`absolute inset-0 z-30 flex flex-col bg-whatsapp-sidebar transition-transform duration-300 ${
        open ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <header className="flex min-h-[48px] items-center gap-4 bg-whatsapp-header px-4 pt-[max(0.75rem,calc(env(safe-area-inset-top)+0.5rem))] pb-3">
        <button
          type="button"
          onClick={onClose}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-whatsapp-text-secondary hover:text-whatsapp-text hover:bg-whatsapp-hover transition touch-manipulation"
          aria-label="Voltar"
        >
          <IoArrowBack className="h-6 w-6" aria-hidden />
        </button>
        <h2 className="text-lg font-medium text-whatsapp-text">Perfil</h2>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col items-center py-8">
          <div className="relative group">
            <div className="w-28 h-28 rounded-full overflow-hidden bg-whatsapp-green flex items-center justify-center text-3xl font-bold text-whatsapp-on-primary">
              {user?.avatar ? (
                <img src={user.avatar} alt="" className="w-full h-full object-cover" />
              ) : (
                userInitials
              )}
            </div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="absolute inset-0 rounded-full bg-black/50 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            >
              <IoCamera className="w-8 h-8 text-white" />
              <span className="text-xs text-white mt-1">Alterar foto</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarUpload}
            />
          </div>
        </div>

        <div className="px-6 space-y-6">
          <div>
            <p className="text-xs text-whatsapp-green mb-2">Seu nome</p>
            <div className="flex items-center gap-2">
              {editingName ? (
                <>
                  <input
                    type="text"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
                    className="flex-1 bg-transparent border-b-2 border-whatsapp-green text-whatsapp-text outline-none py-1 text-[15px]"
                    autoFocus
                    maxLength={40}
                  />
                  <button
                    type="button"
                    onClick={handleSaveName}
                    className="p-1.5 rounded-full text-whatsapp-green hover:bg-whatsapp-hover transition"
                  >
                    <IoCheckmark className="w-5 h-5" />
                  </button>
                </>
              ) : (
                <>
                  <p className="flex-1 text-[15px] text-whatsapp-text py-1">
                    {user?.nickname || 'Sem nome definido'}
                  </p>
                  <button
                    type="button"
                    onClick={() => setEditingName(true)}
                    className="p-1.5 rounded-full text-whatsapp-text-secondary hover:text-whatsapp-text hover:bg-whatsapp-hover transition"
                  >
                    <HiPencilSquare className="w-5 h-5" />
                  </button>
                </>
              )}
            </div>
          </div>

          <div>
            <p className="text-xs text-whatsapp-green mb-2">Recado</p>
            <div className="flex items-center gap-2">
              {editingBio ? (
                <>
                  <input
                    type="text"
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveBio()}
                    className="flex-1 bg-transparent border-b-2 border-whatsapp-green text-whatsapp-text outline-none py-1 text-[15px]"
                    autoFocus
                    maxLength={140}
                  />
                  <button
                    type="button"
                    onClick={handleSaveBio}
                    className="p-1.5 rounded-full text-whatsapp-green hover:bg-whatsapp-hover transition"
                  >
                    <IoCheckmark className="w-5 h-5" />
                  </button>
                </>
              ) : (
                <>
                  <p className="flex-1 text-[15px] text-whatsapp-text py-1">
                    {user?.bio || 'Sem recado'}
                  </p>
                  <button
                    type="button"
                    onClick={() => setEditingBio(true)}
                    className="p-1.5 rounded-full text-whatsapp-text-secondary hover:text-whatsapp-text hover:bg-whatsapp-hover transition"
                  >
                    <HiPencilSquare className="w-5 h-5" />
                  </button>
                </>
              )}
            </div>
          </div>

          {notificationsSupported() && (
            <div>
              <p className="text-xs text-whatsapp-green mb-2 flex items-center gap-2">
                <IoNotificationsOutline className="w-4 h-4" aria-hidden />
                Notificações do dispositivo
              </p>
              <p className="text-[13px] text-whatsapp-text-secondary mb-3 leading-relaxed">
                Aviso genérico quando você recebe mensagens ou chamadas (mesmo com o app aberto em outra
                conversa). O texto da mensagem não aparece na notificação.
              </p>
              {notifPermission === 'granted' && (
                <>
                  <p className="text-sm text-whatsapp-green mb-3">Notificações ativas.</p>
                  <div className="rounded-xl border border-whatsapp-border/45 bg-whatsapp-input/35 p-3 space-y-2">
                    <p className="text-xs font-medium text-whatsapp-text flex items-center gap-2">
                      <IoNotificationsOff className="h-4 w-4 text-amber-200/90 shrink-0" aria-hidden />
                      Silenciar por conversa
                    </p>
                    <p className="text-[11px] text-whatsapp-text-secondary leading-relaxed">
                      Nas conversas silenciadas não mostramos o alerta de «Nova mensagem» no navegador.
                      As mensagens continuam aparecendo no app.
                    </p>
                    {sortedConversations.length > 0 ? (
                      <div className="flex flex-wrap gap-2 pt-0.5">
                        <button
                          type="button"
                          onClick={() => muteAllConversationNotifications()}
                          disabled={allConversationsNotifMuted}
                          className="rounded-lg bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-whatsapp-text border border-whatsapp-border hover:bg-whatsapp-hover disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Silenciar todas
                        </button>
                        <button
                          type="button"
                          onClick={() => unmuteAllConversationNotifications()}
                          disabled={!anyConversationNotifMuted}
                          className="rounded-lg bg-whatsapp-green/15 px-3 py-1.5 text-[11px] font-semibold text-whatsapp-green border border-whatsapp-green/35 hover:bg-whatsapp-green/25 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Ativar todas
                        </button>
                      </div>
                    ) : null}
                    {sortedConversations.length === 0 ? (
                      <p className="text-xs text-whatsapp-text-secondary py-2">Você ainda não tem conversas.</p>
                    ) : (
                      <ul className="max-h-52 overflow-y-auto space-y-1 rounded-lg border border-whatsapp-border/30 bg-whatsapp-dark/30 p-1.5">
                        {sortedConversations.map((conv) => {
                          const id = convId(conv);
                          const muted = isConversationNotificationMuted(id);
                          const label = conversationLabel(conv, user, agendaByAddress);
                          return (
                            <li
                              key={id}
                              className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-white/[0.04]"
                            >
                              <span className="min-w-0 flex-1 truncate text-[13px] text-whatsapp-text">
                                {label}
                              </span>
                              <button
                                type="button"
                                onClick={() => setConversationNotificationMuted(id, !muted)}
                                className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                                  muted
                                    ? 'bg-whatsapp-green/20 text-whatsapp-green border border-whatsapp-green/35 hover:bg-whatsapp-green/30'
                                    : 'bg-white/5 text-whatsapp-text-secondary border border-whatsapp-border hover:bg-whatsapp-hover hover:text-whatsapp-text'
                                }`}
                              >
                                {muted ? 'Ativar' : 'Silenciar'}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </>
              )}
              {notifPermission === 'denied' && (
                <p className="text-sm text-amber-400/90">
                  Bloqueadas nas configurações do navegador. Ative-as para este site nas permissões.
                </p>
              )}
              {(notifPermission === 'default' || notifPermission === 'unsupported') && (
                <button
                  type="button"
                  onClick={handleEnableNotifications}
                  className="rounded-lg bg-whatsapp-green px-4 py-2.5 text-sm font-medium text-whatsapp-on-primary hover:opacity-90 transition"
                >
                  Permitir notificações
                </button>
              )}
            </div>
          )}

          <div>
            <p className="text-xs text-whatsapp-green mb-2 flex items-center gap-2">
              <IoVolumeHigh className="w-4 h-4" aria-hidden />
              Configuração de som
            </p>
            <p className="text-[13px] text-whatsapp-text-secondary mb-3 leading-relaxed">
              Escolha microfone, saída, volumes e opções de processamento. As preferências
              valem para as próximas chamadas e também durante uma ligação ativa.
            </p>
            <div className="rounded-xl border border-whatsapp-border/45 bg-whatsapp-input/35 p-3">
              <AudioSettingsPanel prefs={audioSettings} onChange={updateAudioSettings} />
            </div>
          </div>

          <div>
            <p className="text-xs text-whatsapp-green mb-2">Endereço Ethereum</p>
            <div className="flex items-center gap-2">
              <p className="flex-1 text-[13px] text-whatsapp-text font-mono break-all select-all">
                {user?.address}
              </p>
              <button
                type="button"
                onClick={copyAddress}
                className="p-1.5 rounded-full text-whatsapp-text-secondary hover:text-whatsapp-text hover:bg-whatsapp-hover transition shrink-0"
                title="Copiar"
              >
                <HiClipboardDocument className="w-5 h-5" />
              </button>
            </div>
            {copied && <p className="text-xs text-whatsapp-green mt-1">Copiado!</p>}
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => {
                setDeleteAccountText('');
                setDeleteAccountError('');
                setDeleteAccountOpen(true);
              }}
              className="w-full rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-300 hover:bg-red-500/20 transition"
            >
              Excluir minha conta
            </button>
            <p className="mt-2 text-xs text-whatsapp-text-secondary leading-relaxed">
              Apaga do servidor o seu perfil, conversas privadas, mensagens, fotos, áudios,
              vídeos, arquivos enviados e a sua agenda. Esta ação é permanente e não pode ser
              desfeita. Se você entrar novamente com a mesma carteira, é criada uma nova conta
              vazia.
            </p>
          </div>

          <div className="pt-4 pb-8">
            <p className="text-xs text-whatsapp-text-secondary text-center leading-relaxed">
              Sua identidade é o seu endereço Ethereum.<br />
              Sem número de telefone, sem e-mail.
            </p>
          </div>
        </div>
      </div>

      {deleteAccountOpen ? (
        <ConfirmActionSheet
          open
          titleId="delete-account-title"
          onClose={closeDeleteAccountDialog}
          title="Excluir sua conta?"
          description={
            <>
              <span className="block text-sm text-whatsapp-text-secondary leading-relaxed">
                Vamos remover do servidor:
              </span>
              <ul className="mt-2 list-disc pl-5 space-y-1 text-sm text-whatsapp-text-secondary md:text-left">
                <li>Seu perfil, nome e avatar.</li>
                <li>Todas as suas conversas privadas e o histórico delas.</li>
                <li>Suas mensagens enviadas em grupos.</li>
                <li>Fotos, áudios, vídeos e arquivos que você enviou.</li>
                <li>Sua agenda de contatos.</li>
              </ul>
              <span className="mt-3 block text-xs text-red-300">
                Esta ação é permanente e não pode ser desfeita. Se entrar novamente com a mesma
                carteira, uma conta nova e vazia será criada.
              </span>
              <span className="mt-4 block text-xs text-whatsapp-text-secondary">
                Para confirmar, digite{' '}
                <strong className="text-whatsapp-text">EXCLUIR</strong> abaixo.
              </span>
              <input
                type="text"
                value={deleteAccountText}
                onChange={(e) => setDeleteAccountText(e.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="EXCLUIR"
                disabled={deleteAccountBusy}
                aria-label="Digite EXCLUIR para confirmar"
                className="mt-2 w-full rounded-lg border border-whatsapp-border bg-whatsapp-input px-3 py-2 text-sm uppercase tracking-wide text-whatsapp-text outline-none focus:border-red-400/70"
              />
              {deleteAccountError ? (
                <span className="mt-2 block text-xs text-red-400">{deleteAccountError}</span>
              ) : null}
            </>
          }
          actions={[
            {
              key: 'cancel',
              label: 'Cancelar',
              disabled: deleteAccountBusy,
              className:
                'rounded-xl px-4 py-3 text-sm font-medium text-whatsapp-text-secondary hover:bg-whatsapp-hover md:rounded-lg md:py-2.5',
              onClick: closeDeleteAccountDialog,
            },
            {
              key: 'confirm',
              label: deleteAccountBusy ? 'Excluindo…' : 'Excluir conta',
              disabled:
                deleteAccountBusy ||
                deleteAccountText.trim().toUpperCase() !== 'EXCLUIR',
              className:
                'rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-45 md:rounded-lg md:py-2.5',
              onClick: () => void handleConfirmDeleteAccount(),
            },
          ]}
        />
      ) : null}
    </div>
  );
}
