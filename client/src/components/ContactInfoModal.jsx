import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { IoClose, IoNotificationsOutline, IoNotificationsOff } from 'react-icons/io5';
import { formatAddress, addressToColor } from './MessageBubble';
import { formatLastSeenBr } from '../utils/brDateTime';
import { apiFetch } from '../utils/apiFetch';
import { useChat } from '../contexts/ChatContext';
import { getNotificationPermission, notificationsSupported } from '../utils/browserNotifications';

export default function ContactInfoModal({
  open,
  onClose,
  isGroup,
  title,
  members,
  privateContact,
  userAddress,
  onlineUsers,
  privateAgendaRow = null,
  onAgendaApelidoSaved,
  /** Conversa activa: silenciar notificações de «Nova mensagem» só neste chat. */
  conversationId = null,
  groupConversationId = null,
  iAmGroupAdmin = false,
  groupOnlyAdminsPost = false,
  groupCreatedBy = null,
  onUpdateOnlyAdminsPost,
  onSetMemberRole,
}) {
  const [apelidoEdit, setApelidoEdit] = useState('');
  const [apelidoSaving, setApelidoSaving] = useState(false);
  const [apelidoErr, setApelidoErr] = useState('');
  const [groupSettingsSaving, setGroupSettingsSaving] = useState(false);
  const [roleActionKey, setRoleActionKey] = useState(null);
  const { isConversationNotificationMuted, setConversationNotificationMuted } = useChat();
  const muteConvId = conversationId || groupConversationId || null;
  const notifMuted = Boolean(muteConvId && isConversationNotificationMuted(muteConvId));
  const notifCanConfigure =
    Boolean(muteConvId) && notificationsSupported() && getNotificationPermission() === 'granted';

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const ap = privateAgendaRow?.apelido != null ? String(privateAgendaRow.apelido) : '';
    setApelidoEdit(ap.trim());
    setApelidoErr('');
  }, [open, privateAgendaRow]);

  const saveAgendaApelido = useCallback(async () => {
    if (!userAddress || !privateAgendaRow?.address) return;
    const ap = apelidoEdit.trim();
    if (ap.length < 1) {
      setApelidoErr('Informe um apelido.');
      return;
    }
    if (ap.length > 64) {
      setApelidoErr('Máximo 64 caracteres.');
      return;
    }
    setApelidoSaving(true);
    setApelidoErr('');
    try {
      const res = await apiFetch('/api/contacts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerAddress: userAddress,
          contactAddress: privateAgendaRow.address,
          apelido: ap,
        }),
      });
      if (res.ok) {
        onAgendaApelidoSaved?.();
      } else {
        const j = await res.json().catch(() => ({}));
        setApelidoErr(j.error || 'Erro ao salvar');
      }
    } catch {
      setApelidoErr('Erro de rede');
    } finally {
      setApelidoSaving(false);
    }
  }, [userAddress, privateAgendaRow, apelidoEdit, onAgendaApelidoSaved]);

  if (!open) return null;

  const me = (userAddress || '').toLowerCase();

  return createPortal(
    <div
      className="fixed inset-0 z-[280] flex items-end sm:items-center justify-center p-0 sm:p-6"
      style={{ backgroundColor: 'rgba(0,0,0,0.88)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Informações do contato"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md max-h-[min(90dvh,100vh)] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-whatsapp-sidebar border border-whatsapp-border shadow-2xl text-whatsapp-text"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex min-h-[48px] items-center justify-between border-b border-whatsapp-border px-4 pt-[max(0.75rem,calc(env(safe-area-inset-top)+0.25rem))] pb-3 sm:pt-3">
          <h2 className="text-lg font-semibold">
            {isGroup ? 'Informações do grupo' : 'Informações do contato'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-whatsapp-text-secondary hover:bg-whatsapp-hover touch-manipulation"
            aria-label="Fechar"
          >
            <IoClose className="h-6 w-6" aria-hidden />
          </button>
        </div>
        <div className="p-4 space-y-4">
          {isGroup ? (
            <>
              <p className="text-sm text-whatsapp-text-secondary">
                {title || 'Grupo'} · {Array.isArray(members) ? members.length : 0} participante
                {members?.length === 1 ? '' : 's'}
              </p>

              {iAmGroupAdmin && groupConversationId && onUpdateOnlyAdminsPost ? (
                <div className="rounded-xl bg-whatsapp-input/50 p-3 border border-whatsapp-border/35 space-y-3">
                  <p className="text-xs font-semibold text-whatsapp-green tracking-wide uppercase">
                    Permissões do grupo
                  </p>
                  <p className="text-[11px] text-whatsapp-text-secondary leading-relaxed">
                    Controle quem pode publicar mensagens e anexos. Reações e leitura permanecem para todos os
                    membros.
                  </p>
                  <label className="flex items-start gap-3 cursor-pointer touch-manipulation">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-whatsapp-border text-whatsapp-green focus:ring-whatsapp-green"
                      checked={Boolean(groupOnlyAdminsPost)}
                      disabled={groupSettingsSaving}
                      onChange={async (e) => {
                        const next = e.target.checked;
                        setGroupSettingsSaving(true);
                        try {
                          const ok = await onUpdateOnlyAdminsPost(next);
                          if (!ok) window.alert('Não foi possível atualizar as configurações do grupo.');
                        } finally {
                          setGroupSettingsSaving(false);
                        }
                      }}
                    />
                    <span className="text-sm text-whatsapp-text leading-snug">
                      <span className="font-medium block">Só administradores enviam mensagens</span>
                      <span className="text-whatsapp-text-secondary text-[12px]">
                        Quando desligado, todos os membros podem escrever e enviar arquivos.
                      </span>
                    </span>
                  </label>
                </div>
              ) : !iAmGroupAdmin && isGroup ? (
                <div className="rounded-xl bg-whatsapp-input/40 px-3 py-2 border border-whatsapp-border/30 text-[12px] text-whatsapp-text-secondary">
                  {groupOnlyAdminsPost
                    ? 'Este grupo está em modo anúncio: só administradores enviam mensagens.'
                    : 'Todos os membros podem enviar mensagens neste grupo.'}
                </div>
              ) : null}

              <ul className="space-y-3">
                {(members || []).map((m, idx) => {
                  const addr = (m.address ?? '').toLowerCase();
                  const isMe = addr === me;
                  const online = addr && onlineUsers?.has(addr);
                  const nick = m.nickname?.trim();
                  const apel = m.apelido?.trim();
                  const display = isMe ? 'Eu' : apel || nick || formatAddress(addr);
                  const last = m.last_seen ?? m.lastSeen;
                  const isAdmin = m.role === 'admin';
                  const creatorLc = (groupCreatedBy || '').toLowerCase();
                  const isCreator = Boolean(creatorLc && addr === creatorLc);
                  const roleBusy = roleActionKey === addr;
                  return (
                    <li
                      key={addr || `m-${idx}`}
                      className="flex gap-3 items-start rounded-xl bg-whatsapp-input/60 p-3 border border-whatsapp-border/40"
                    >
                      <div
                        className="w-11 h-11 rounded-full shrink-0 flex items-center justify-center text-sm font-medium text-white"
                        style={{
                          background: `linear-gradient(135deg, ${addressToColor(addr || '0x')}aa, #0a0a0c)`,
                        }}
                      >
                        {(display || '?').slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium truncate">{display}</p>
                          {isAdmin ? (
                            <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-whatsapp-green/20 text-whatsapp-green border border-whatsapp-green/30">
                              Admin
                            </span>
                          ) : (
                            <span className="text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full bg-white/5 text-whatsapp-text-secondary border border-whatsapp-border/50">
                              Membro
                            </span>
                          )}
                          {isCreator ? (
                            <span className="text-[10px] font-medium text-amber-200/90">Criador</span>
                          ) : null}
                        </div>
                        {apel && nick && apel !== nick && (
                          <p className="text-[11px] text-whatsapp-text-secondary truncate">Perfil: {nick}</p>
                        )}
                        <p className="text-xs text-whatsapp-text-secondary font-mono truncate">
                          {addr || '—'}
                        </p>
                        <p className="text-xs text-whatsapp-green mt-1">
                          {online ? 'online' : last ? formatLastSeenBr(last) : 'sem registro de atividade'}
                        </p>
                        {iAmGroupAdmin && !isMe && onSetMemberRole && groupConversationId ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {!isAdmin ? (
                              <button
                                type="button"
                                disabled={roleBusy}
                                onClick={async () => {
                                  setRoleActionKey(addr);
                                  try {
                                    const r = await onSetMemberRole(addr, 'admin');
                                    if (!r?.ok) {
                                      window.alert('Não foi possível promover este membro.');
                                    }
                                  } finally {
                                    setRoleActionKey(null);
                                  }
                                }}
                                className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-whatsapp-green/15 text-whatsapp-green border border-whatsapp-green/35 hover:bg-whatsapp-green/25 disabled:opacity-50"
                              >
                                {roleBusy ? '…' : 'Promover a administrador'}
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={roleBusy}
                                onClick={async () => {
                                  if (
                                    !window.confirm(
                                      'Remover este usuário como administrador? Continuará no grupo como membro.'
                                    )
                                  ) {
                                    return;
                                  }
                                  setRoleActionKey(addr);
                                  try {
                                    const r = await onSetMemberRole(addr, 'member');
                                    if (!r?.ok) {
                                      window.alert(
                                        r?.error === 'last_admin'
                                          ? 'Você não pode remover o último administrador. Promova outro membro primeiro.'
                                          : 'Não foi possível atualizar o cargo.'
                                      );
                                    }
                                  } finally {
                                    setRoleActionKey(null);
                                  }
                                }}
                                className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-white/5 text-whatsapp-text-secondary border border-whatsapp-border hover:bg-whatsapp-hover disabled:opacity-50"
                              >
                                {roleBusy ? '…' : 'Remover cargo de admin'}
                              </button>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            (() => {
              const m = privateContact ?? members?.find((x) => (x?.address ?? '').toLowerCase() !== me);
              if (!m) {
                return (
                  <p className="text-sm text-whatsapp-text-secondary text-center py-6">
                    Não foi possível carregar os dados do contato.
                  </p>
                );
              }
              const addr = (m.address ?? '').toLowerCase();
              const online = addr && onlineUsers?.has(addr);
              const last = m.last_seen ?? m.lastSeen;
              const profileNick = m.nickname?.trim();
              const displayMain = (title && title.trim()) || profileNick || formatAddress(addr) || 'Contato';
              return (
                <>
                  <div className="flex flex-col items-center gap-3 py-2">
                    {m.avatar ? (
                      <img
                        src={m.avatar}
                        alt=""
                        className="w-24 h-24 rounded-full object-cover border border-whatsapp-border"
                      />
                    ) : (
                      <div
                        className="w-24 h-24 rounded-full flex items-center justify-center text-3xl font-medium text-white"
                        style={{
                          background: `linear-gradient(135deg, ${addressToColor(addr || '0x')}cc, #0a0a0c)`,
                        }}
                      >
                        {(displayMain || '?').slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <p className="text-xl font-medium text-center px-2">{displayMain}</p>
                    <p className="text-xs text-whatsapp-text-secondary font-mono text-center break-all px-2">
                      {addr || '—'}
                    </p>
                    {profileNick && displayMain !== profileNick && (
                      <p className="text-sm text-whatsapp-text-secondary text-center px-2">
                        Nome no perfil público:{' '}
                        <span className="text-whatsapp-text">{profileNick}</span>
                      </p>
                    )}
                    <p className="text-sm text-whatsapp-green">
                      {online ? 'online' : last ? formatLastSeenBr(last) : 'sem registro de atividade'}
                    </p>
                  </div>

                  {privateAgendaRow ? (
                    <div className="rounded-xl bg-whatsapp-input/50 p-3 border border-whatsapp-border/30 space-y-2">
                      <p className="text-xs text-whatsapp-green font-medium">Apelido na sua agenda</p>
                      <p className="text-[11px] text-whatsapp-text-secondary">
                        É o nome que aparece no chat e na lista. Você pode alterar aqui.
                      </p>
                      <input
                        type="text"
                        value={apelidoEdit}
                        onChange={(e) => setApelidoEdit(e.target.value)}
                        maxLength={64}
                        placeholder={
                          profileNick
                            ? `${profileNick} (nome público — use como apelido ou escolha outro)`
                            : 'Como você quer ver este contato na lista'
                        }
                        className="w-full rounded-lg border border-whatsapp-border bg-whatsapp-dark px-3 py-2 text-sm text-whatsapp-text outline-none focus:border-whatsapp-green placeholder:text-whatsapp-text-secondary/80"
                      />
                      {apelidoErr ? <p className="text-xs text-red-400">{apelidoErr}</p> : null}
                      <button
                        type="button"
                        disabled={apelidoSaving}
                        onClick={() => void saveAgendaApelido()}
                        className="w-full rounded-lg bg-whatsapp-green py-2 text-sm font-medium text-whatsapp-on-primary disabled:opacity-50"
                      >
                        {apelidoSaving ? 'Salvando…' : 'Salvar apelido'}
                      </button>
                    </div>
                  ) : (
                    <p className="text-center text-xs text-whatsapp-text-secondary">
                      Este endereço não está na sua agenda. Adicione em «Nova conversa» para definir um apelido.
                    </p>
                  )}

                  {m.bio ? (
                    <div className="rounded-xl bg-whatsapp-input/50 p-3 border border-whatsapp-border/30">
                      <p className="text-xs text-whatsapp-text-secondary mb-1">Sobre</p>
                      <p className="text-sm whitespace-pre-wrap">{m.bio}</p>
                    </div>
                  ) : null}
                </>
              );
            })()
          )}

          {notifCanConfigure ? (
            <div className="rounded-xl border border-whatsapp-border/40 bg-whatsapp-input/45 p-3 space-y-2">
              {notifMuted ? (
                <>
                  <div className="flex items-start gap-2">
                    <IoNotificationsOff className="h-5 w-5 shrink-0 text-amber-200/95 mt-0.5" aria-hidden />
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-medium text-whatsapp-text">
                        Notificações desativadas para esta conversa
                      </p>
                      <p className="text-[11px] text-whatsapp-text-secondary leading-relaxed">
                        Não mostramos alertas de «Nova mensagem» do navegador para este chat (com a janela em outra
                        aba ou minimizada). As mensagens continuam chegando normalmente aqui no app.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => muteConvId && setConversationNotificationMuted(muteConvId, false)}
                    className="w-full rounded-lg border border-whatsapp-border bg-whatsapp-dark py-2.5 text-sm font-medium text-whatsapp-text hover:bg-whatsapp-hover"
                  >
                    Ativar notificações novamente
                  </button>
                </>
              ) : (
                <>
                  <div className="flex items-start gap-2">
                    <IoNotificationsOutline className="h-5 w-5 shrink-0 text-whatsapp-green mt-0.5" aria-hidden />
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-medium text-whatsapp-text">Notificações do navegador</p>
                      <p className="text-[11px] text-whatsapp-text-secondary leading-relaxed">
                        Estão ativas para esta conversa. Você pode silenciar só para este contato ou grupo
                        (configuração salva neste dispositivo).
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (muteConvId) setConversationNotificationMuted(muteConvId, true);
                    }}
                    className="w-full rounded-lg bg-whatsapp-input py-2.5 text-sm font-medium text-whatsapp-text border border-whatsapp-border hover:bg-whatsapp-hover"
                  >
                    Desativar notificações
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
