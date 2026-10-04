import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { HiLockClosed } from 'react-icons/hi2';
import { useAuth } from '../contexts/AuthContext';
import { useChat } from '../contexts/ChatContext';
import Sidebar from './Sidebar';
import ChatWindow from './ChatWindow';
import CallModal from './CallModal';
import AppShell from './shell/AppShell';
import E2eDerivationPrompt from './shell/E2eDerivationPrompt';
import FirstUseOnboarding from './onboarding/FirstUseOnboarding';

function entityId(e) {
  if (e == null) return undefined;
  return e._id ?? e.id;
}

function MetaWhatsMark({ className = '' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M60 12C35 12 15 32 15 57c0 18 9 34 23 43l-3 18 17-9c5 2 11 3 18 3 25 0 45-20 45-45S85 12 60 12z"
        fill="#10B981"
      />
      <path
        d="M58 38 L44 62h12l-4 20 22-28H66l6-16z"
        fill="#030303"
        stroke="#030303"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EmptyChatState() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center border-l border-white/[0.05] bg-whatsapp-chat px-6 text-center md:px-10">
      <div className="max-w-[22rem] rounded-3xl border border-white/[0.06] bg-white/[0.02] px-8 py-10 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
        <MetaWhatsMark className="mx-auto mb-5 h-20 w-20 opacity-95" />
        <h2 className="text-xl font-semibold tracking-tight text-zinc-50">MetaWhats</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-zinc-400">
          Escolha uma conversa na lista — ou crie uma nova — e comece a falar com quem confia.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3 rounded-2xl bg-zinc-950/60 px-4 py-4 text-left">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
            <HiLockClosed className="h-4 w-4 shrink-0 text-emerald-400/90" aria-hidden />
            Privado por desenho
          </div>
          <p className="text-[13px] leading-relaxed text-zinc-500">
            As mensagens são protegidas de ponta a ponta. Sua carteira confirma quem é você — sem
            compartilhar a chave privada nem dar acesso aos seus fundos.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function MainLayout() {
  const { conversationId: conversationIdParam } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    activeConversation,
    selectConversation,
    conversations,
    conversationsReady,
  } = useChat();

  useEffect(() => {
    const activeId = activeConversation ? String(entityId(activeConversation)) : '';
    const urlId = conversationIdParam ? String(conversationIdParam) : '';

    if (!urlId) {
      if (activeId) void selectConversation(null);
      return;
    }

    const conv = conversations.find((c) => c && String(entityId(c)) === urlId);
    if (conv) {
      if (activeId !== urlId) void selectConversation(conv);
      return;
    }

    if (conversationsReady) {
      navigate('/', { replace: true });
    }
  }, [
    conversationIdParam,
    conversations,
    conversationsReady,
    activeConversation,
    selectConversation,
    navigate,
  ]);

  return (
    <AppShell>
      <FirstUseOnboarding address={user?.address} />
      <E2eDerivationPrompt />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Mobile: lista OU chat em tela inteira. Desktop: duas colunas. */}
        <div
          className={`flex h-full min-h-0 shrink-0 flex-col border-white/[0.06] bg-whatsapp-sidebar md:border-r ${
            activeConversation
              ? 'hidden w-full min-w-0 max-w-none md:flex md:w-[30%] md:min-w-[280px] md:max-w-[420px]'
              : 'flex w-full min-w-0 md:w-[30%] md:min-w-[280px] md:max-w-[420px]'
          }`}
        >
          <Sidebar />
        </div>
        <main
          className={`min-h-0 min-w-0 flex flex-1 flex-col bg-whatsapp-chat ${
            activeConversation ? 'oz-chat-enter flex' : 'hidden md:flex'
          }`}
        >
          {activeConversation ? <ChatWindow /> : <EmptyChatState />}
        </main>
      </div>
      <CallModal />
    </AppShell>
  );
}
