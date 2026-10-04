import { useState, useEffect, useCallback } from 'react';
import { IoArrowBack, IoClose, IoSearch, IoCamera, IoCheckmark } from 'react-icons/io5';
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

export default function NewGroupModal({ open, onClose }) {
  const { user } = useAuth();
  const { createGroup } = useChat();
  const [step, setStep] = useState(1);
  const [contacts, setContacts] = useState([]);
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState('');
  const [groupName, setGroupName] = useState('');

  const loadContacts = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiFetch(`/api/contacts/${user.address}`);
      if (res.ok) {
        const data = await res.json();
        setContacts(Array.isArray(data) ? data : []);
      }
    } catch { /* ignore */ }
  }, [user]);

  useEffect(() => {
    if (open) {
      loadContacts();
      setStep(1);
      setSelected([]);
      setSearch('');
      setGroupName('');
    }
  }, [open, loadContacts]);

  const toggleMember = (address) => {
    setSelected((prev) =>
      prev.includes(address) ? prev.filter((a) => a !== address) : [...prev, address]
    );
  };

  const handleCreate = () => {
    if (!groupName.trim() || selected.length === 0) return;
    createGroup(groupName.trim(), selected);
    onClose();
  };

  const filtered = contacts.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (c.address || '').toLowerCase().includes(q) ||
      (c.nickname || '').toLowerCase().includes(q) ||
      (c.apelido || '').toLowerCase().includes(q)
    );
  });

  return (
    <div
      className={`absolute inset-0 z-30 flex flex-col bg-whatsapp-sidebar transition-transform duration-300 ${
        open ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      {step === 1 ? (
        <>
          <header className="flex min-h-[48px] items-center gap-4 bg-whatsapp-header px-4 pt-[max(0.75rem,calc(env(safe-area-inset-top)+0.5rem))] pb-3">
            <button
              type="button"
              onClick={onClose}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-whatsapp-text-secondary hover:text-whatsapp-text hover:bg-whatsapp-hover transition touch-manipulation"
              aria-label="Voltar"
            >
              <IoArrowBack className="h-6 w-6" aria-hidden />
            </button>
            <h2 className="text-lg font-medium text-whatsapp-text">Adicionar participantes</h2>
          </header>

          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b border-whatsapp-border/40">
              {selected.map((addr) => {
                const contact = contacts.find((c) => c.address === addr);
                return (
                  <span
                    key={addr}
                    className="flex items-center gap-1 bg-whatsapp-input rounded-full px-2.5 py-1 text-xs text-whatsapp-text"
                  >
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                      style={{ backgroundColor: addressToColor(addr) }}
                    >
                      {addr.replace(/^0x/i, '').slice(0, 1).toUpperCase()}
                    </span>
                    {contact?.apelido?.trim() || contact?.nickname || formatAddress(addr)}
                    <button
                      type="button"
                      onClick={() => toggleMember(addr)}
                      className="ml-0.5 text-whatsapp-text-secondary hover:text-whatsapp-text"
                    >
                      <IoClose className="w-4 h-4" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          <div className="px-3 py-2">
            <div className="flex items-center gap-3 rounded-lg bg-whatsapp-input px-3 py-1.5">
              <IoSearch className="w-5 h-5 text-whatsapp-text-secondary shrink-0" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar contatos"
                className="flex-1 bg-transparent text-sm text-whatsapp-text placeholder:text-whatsapp-text-secondary outline-none py-1"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-whatsapp-text-secondary">
                {contacts.length === 0 ? 'Adicione contatos primeiro.' : 'Nenhum resultado'}
              </p>
            ) : (
              <ul>
                {filtered.map((contact) => {
                  const isSelected = selected.includes(contact.address);
                  return (
                    <li key={contact.address}>
                      <button
                        type="button"
                        onClick={() => toggleMember(contact.address)}
                        className="flex w-full items-center gap-3 px-4 py-3 hover:bg-whatsapp-hover/40 transition text-left"
                      >
                        <div className="relative shrink-0">
                          <div
                            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium text-white"
                            style={{ backgroundColor: addressToColor(contact.address) }}
                          >
                            {(contact.address || '').replace(/^0x/i, '').slice(0, 2).toUpperCase()}
                          </div>
                          {isSelected && (
                            <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-whatsapp-green flex items-center justify-center">
                              <IoCheckmark className="w-3 h-3 text-white" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[15px] text-whatsapp-text truncate">
                            {contact.apelido?.trim() || contact.nickname || formatAddress(contact.address)}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {selected.length > 0 && (
            <div className="p-4 flex justify-end">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="w-12 h-12 rounded-full bg-whatsapp-green flex items-center justify-center shadow-lg hover:bg-whatsapp-green-hover transition"
              >
                <IoArrowBack className="w-6 h-6 text-whatsapp-on-primary rotate-180" />
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <header className="flex min-h-[48px] items-center gap-4 bg-whatsapp-header px-4 pt-[max(0.75rem,calc(env(safe-area-inset-top)+0.5rem))] pb-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-whatsapp-text-secondary hover:text-whatsapp-text hover:bg-whatsapp-hover transition touch-manipulation"
              aria-label="Voltar"
            >
              <IoArrowBack className="h-6 w-6" aria-hidden />
            </button>
            <h2 className="text-lg font-medium text-whatsapp-text">Novo grupo</h2>
          </header>

          <div className="flex flex-col items-center py-8 px-6 gap-4">
            <div className="w-20 h-20 rounded-full bg-whatsapp-input flex items-center justify-center">
              <IoCamera className="w-8 h-8 text-whatsapp-text-secondary" />
            </div>

            <div className="w-full max-w-sm">
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Nome do grupo"
                className="w-full bg-transparent border-b-2 border-whatsapp-green px-1 py-2 text-lg text-whatsapp-text placeholder:text-whatsapp-text-secondary outline-none text-center"
                autoFocus
              />
            </div>

            <p className="text-sm text-whatsapp-text-secondary">
              {selected.length} participante{selected.length !== 1 ? 's' : ''} selecionado{selected.length !== 1 ? 's' : ''}
            </p>
          </div>

          <div className="flex-1" />

          <div className="p-4 flex justify-center">
            <button
              type="button"
              onClick={handleCreate}
              disabled={!groupName.trim()}
              className="w-12 h-12 rounded-full bg-whatsapp-green flex items-center justify-center shadow-lg hover:bg-whatsapp-green-hover transition disabled:opacity-40"
            >
              <IoCheckmark className="w-7 h-7 text-whatsapp-on-primary" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
