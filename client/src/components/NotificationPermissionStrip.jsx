import { useState, useEffect, useCallback } from 'react';
import { IoNotificationsOutline } from 'react-icons/io5';
import {
  getNotificationPermission,
  notificationsSupported,
  requestNotificationPermission,
} from '../utils/browserNotifications';

const DISMISS_KEY = 'metawhats_notif_prompt_dismissed';

export default function NotificationPermissionStrip() {
  const [perm, setPerm] = useState(() => getNotificationPermission());
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const onVis = () => setPerm(getNotificationPermission());
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const enable = useCallback(async () => {
    const r = await requestNotificationPermission();
    setPerm(r === 'unsupported' ? getNotificationPermission() : r);
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
  }, []);

  if (!notificationsSupported() || perm !== 'default' || dismissed) return null;

  return (
    <div className="shrink-0 border-b border-amber-500/25 bg-amber-950/35 px-3 py-2.5 sm:px-4">
      <div className="flex items-start gap-2">
        <IoNotificationsOutline
          className="mt-0.5 h-5 w-5 shrink-0 text-amber-200/90"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-amber-100">Ativar notificações</p>
          <p className="mt-0.5 text-xs leading-snug text-amber-100/80">
            Sem permissão, o navegador não mostra avisos de mensagens nem chamadas. Toque em permitir
            abaixo (ou em Perfil → Notificações).
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={enable}
              className="rounded-md bg-whatsapp-green px-3 py-1.5 text-xs font-semibold text-whatsapp-on-primary hover:opacity-90"
            >
              Permitir notificações
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-amber-200/90 hover:bg-white/10"
            >
              Agora não
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
