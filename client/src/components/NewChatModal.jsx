import { useState, useEffect, useCallback } from 'react';
import { IoArrowBack, IoSearch, IoPersonAdd } from 'react-icons/io5';
import { useAuth } from '../contexts/AuthContext';
import { useChat } from '../contexts/ChatContext';
import { apiFetch } from '../utils/apiFetch';

function addressToColor(address) {
  const colors = ['#10B981', '#7C3AED', '#F59E0B', '#53bdeb', '#e86c6c', '#a86ce8', '#6ce8a8', '#6ca8e8'];
  const hash = (address || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

function formatAddress(addr) {
  return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '';
}

function isValidEthAddress(addr) {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

export default function NewChatModal({ open, onClose }) {
  const { user } = useAuth();
  const { startPrivateChat, refreshAgenda } = useChat();
  const [contacts, setContacts] = useState([]);
  const [search, setSearch] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [addError, setAddError] = useState('');
  const [addSuccess, setAddSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  /** Modal de confirmação do apelido na agenda */
  const [saveDraft, setSaveDraft] = useState(null);
  const [apelidoInput, setApelidoInput] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);

  const loadContacts = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiFetch(`/api/contacts/${user.address}`);
      if (res.ok) {
        const data = await res.json();
        setContacts(Array.isArray(data) ? data : []);
      }
    } catch {
      /* ignore */
    }
  }, [user]);

  useEffect(() => {
    if (open) {
      loadContacts();
      setSearch('');
      setNewAddress('');
      setAddError('');
      setAddSuccess('');
      setSaveDraft(null);
      setApelidoInput('');
    }
  }, [open, loadContacts]);

  const openSaveContactModal = async () => {
    setAddError('');
    setAddSuccess('');
    const addr = newAddress.trim().toLowerCase();
    if (!isValidEthAddress(addr)) {
      setAddError('Endereço Ethereum inválido (deve começar com 0x e ter 42 caracteres)');
      return;
    }
    if (addr === user?.address?.toLowerCase()) {
      setAddError('Você não pode adicionar seu próprio endereço');
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch(`/api/users/${encodeURIComponent(addr)}/peer-summary`);
      if (!res.ok) {
        setAddError('Não foi possível obter dados do endereço.');
        return;
      }
      const summary = await res.json();
      const profileNick = String(summary.nickname || '').trim();
      const suggested = profileNick || formatAddress(addr);
      setSaveDraft({ address: addr, profileNickname: profileNick || null });
      setApelidoInput(suggested);
    } catch {
      setAddError('Erro de rede ao consultar o endereço.');
    } finally {
      setLoading(false);
    }
  };

  const cancelSaveContact = () => {
    setSaveDraft(null);
    setApelidoInput('');
  };

  const confirmSaveContact = async () => {
    if (!saveDraft || !user?.address) return;
    const ap = apelidoInput.trim();
    if (ap.length < 1) {
      setAddError('Informe um apelido (pelo menos 1 caractere).');
      return;
    }
    if (ap.length > 64) {
      setAddError('Apelido muito longo (máx. 64 caracteres).');
      return;
    }
    setSaveBusy(true);
    setAddError('');
    try {
      const res = await apiFetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerAddress: user.address,
          contactAddress: saveDraft.address,
          apelido: ap,
        }),
      });
      if (res.ok) {
        setAddSuccess('Contato salvo na agenda. Toque nele abaixo para abrir a conversa.');
        setNewAddress('');
        cancelSaveContact();
        await loadContacts();
        await refreshAgenda();
        setTimeout(() => setAddSuccess(''), 4500);
      } else {
        const j = await res.json().catch(() => ({}));
        setAddError(j.error || 'Erro ao salvar contato');
      }
    } catch {
      setAddError('Erro de rede');
    } finally {
      setSaveBusy(false);
    }
  };

  const handleStartChat = async (contactAddress) => {
    try {
      const conv = await startPrivateChat(contactAddress);
      if (conv) onClose();
    } catch (e) {
      console.error(e);
    }
  };

  const filtered = contacts.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const ap = (c.apelido || '').toLowerCase();
    const nick = (c.nickname || '').toLowerCase();
    const ad = (c.address || '').toLowerCase();
    return ad.includes(q) || nick.includes(q) || ap.includes(q);
  });

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
        <h2 className="text-lg font-medium text-whatsapp-text">Nova conversa</h2>
      </header>

      <div className="px-3 py-2">
        <div className="flex items-center gap-3 rounded-lg bg-whatsapp-input px-3 py-1.5">
          <IoSearch className="w-5 h-5 text-whatsapp-text-secondary shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por endereço, apelido ou nome de perfil"
            className="flex-1 bg-transparent text-sm text-whatsapp-text placeholder:text-whatsapp-text-secondary outline-none py-1"
          />
        </div>
      </div>

      <div className="px-3 py-2 border-b border-whatsapp-border/40">
        <p className="text-xs text-whatsapp-text-secondary mb-2 uppercase tracking-wider">Adicionar à agenda</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
            placeholder="0x..."
            className="flex-1 bg-whatsapp-input rounded-lg px-3 py-2 text-sm text-whatsapp-text placeholder:text-whatsapp-text-secondary outline-none font-mono"
          />
          <button
            type="button"
            onClick={openSaveContactModal}
            disabled={loading || !newAddress.trim()}
            className="px-3 py-2 rounded-lg bg-whatsapp-green text-whatsapp-on-primary font-medium text-sm disabled:opacity-40 hover:bg-whatsapp-green-hover transition shrink-0 flex items-center gap-1"
            title="Adicionar contato"
          >
            <IoPersonAdd className="w-5 h-5" />
          </button>
        </div>
        {addError && !saveDraft && <p className="text-xs text-red-400 mt-1">{addError}</p>}
        {addSuccess && <p className="text-xs text-whatsapp-green mt-1">{addSuccess}</p>}
      </div>

      {saveDraft ? (
        <div className="absolute inset-0 z-40 flex items-end sm:items-center justify-center bg-black/70 p-4">
          <div
            className="w-full max-w-md rounded-xl border border-whatsapp-border bg-whatsapp-sidebar p-5 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-contact-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="save-contact-title" className="text-lg font-semibold text-whatsapp-text">
              Salvar na agenda
            </h3>
            <p className="mt-2 text-sm text-whatsapp-text-secondary leading-relaxed">
              Confirme o <span className="text-whatsapp-text font-medium">apelido</span> deste contato. É assim que
              aparece no chat e na lista (não o nome de usuário público).
            </p>
            <p className="mt-2 text-xs font-mono text-whatsapp-text-secondary break-all">{saveDraft.address}</p>
            {saveDraft.profileNickname ? (
              <p className="mt-1 text-xs text-whatsapp-text-secondary">
                Nome no perfil público:{' '}
                <span className="text-whatsapp-text">{saveDraft.profileNickname}</span> (sugestão no campo abaixo)
              </p>
            ) : (
              <p className="mt-1 text-xs text-whatsapp-text-secondary">
                Sem nome de perfil registrado — sugerimos um atalho do endereço; você pode alterar.
              </p>
            )}
            <label htmlFor="apelido-confirm" className="mt-4 block text-xs text-whatsapp-green">
              Apelido na sua agenda
            </label>
            <input
              id="apelido-confirm"
              type="text"
              value={apelidoInput}
              onChange={(e) => setApelidoInput(e.target.value)}
              maxLength={64}
              className="mt-1 w-full rounded-lg border border-whatsapp-border bg-whatsapp-dark px-3 py-2.5 text-[15px] text-whatsapp-text outline-none focus:border-whatsapp-green"
              autoFocus
            />
            {addError && <p className="text-xs text-red-400 mt-2">{addError}</p>}
            <div className="mt-5 flex gap-2 justify-end">
              <button
                type="button"
                onClick={cancelSaveContact}
                disabled={saveBusy}
                className="px-4 py-2 rounded-lg text-sm text-whatsapp-text-secondary hover:bg-whatsapp-hover"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmSaveContact}
                disabled={saveBusy}
                className="px-4 py-2 rounded-lg bg-whatsapp-green text-whatsapp-on-primary text-sm font-medium disabled:opacity-50"
              >
                {saveBusy ? 'Salvando…' : 'Confirmar e salvar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-whatsapp-text-secondary">
            {contacts.length === 0 ? 'Nenhum contato na agenda. Adicione um endereço acima.' : 'Nenhum resultado'}
          </p>
        ) : (
          <ul>
            {filtered.map((contact) => (
              <li key={contact.address}>
                <button
                  type="button"
                  onClick={() => handleStartChat(contact.address)}
                  className="flex w-full items-center gap-3 px-4 py-3 hover:bg-whatsapp-hover/40 transition text-left"
                >
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-medium text-white shrink-0"
                    style={{ backgroundColor: addressToColor(contact.address) }}
                  >
                    {(contact.address || '').replace(/^0x/i, '').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] text-whatsapp-text truncate">
                      {(contact.apelido || '').trim() || formatAddress(contact.address)}
                    </p>
                    <p className="text-xs text-whatsapp-text-secondary truncate font-mono">
                      {formatAddress(contact.address)}
                    </p>
                    {contact.nickname?.trim() &&
                      contact.nickname.trim() !== (contact.apelido || '').trim() && (
                        <p className="text-[11px] text-whatsapp-text-secondary/80 truncate">
                          Perfil: {contact.nickname.trim()}
                        </p>
                      )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
