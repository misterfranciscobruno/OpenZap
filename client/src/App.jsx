import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ChatProvider } from './contexts/ChatContext';
import { CallProvider } from './contexts/CallContext';
import Login from './components/Login';
import MainLayout from './components/MainLayout';
import SessionReconnect from './components/SessionReconnect';

function AppContent() {
  const { user, loading, loginMessage, signature } = useAuth();

  if (loading) {
    return (
      <div className="flex h-full min-h-0 w-full max-w-[100vw] items-center justify-center overflow-hidden bg-whatsapp-dark touch-manipulation">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-whatsapp-green border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-whatsapp-text-secondary">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!user) return <Login />;

  if (!loginMessage || !signature) {
    return <SessionReconnect />;
  }

  return (
    <ChatProvider>
      <CallProvider>
        <Routes>
          <Route path="/" element={<MainLayout />} />
          <Route path="/c/:conversationId" element={<MainLayout />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </CallProvider>
    </ChatProvider>
  );
}

export default function App() {
  return (
    <div className="flex h-full min-h-0 w-full max-w-[100vw] flex-col overflow-hidden">
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </div>
  );
}
