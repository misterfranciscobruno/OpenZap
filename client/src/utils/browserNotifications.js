/**
 * Notificações do browser: texto apenas informativo (sem conteúdo de mensagens).
 *
 * Limites por plataforma:
 * - Chrome / Edge / Firefox (desktop e Android): Permission + Notification com o separador em segundo plano costuma funcionar enquanto a página mantém o socket.
 * - Safari macOS: suporte à API Notification em contexto seguro (HTTPS).
 * - Safari iOS: notificações em segundo plano com o site só no Safari são limitadas; a partir do iOS 16.4, Web Push exige app na página inicial (standalone) + subscrição no servidor (não implementado aqui).
 */

const DEFAULT_TITLE = 'MetaWhats';

function notificationIconUrl() {
  if (typeof window === 'undefined') return undefined;
  try {
    const base = (import.meta.env?.BASE_URL ?? '/').replace(/\/?$/, '/');
    return new URL(`${base}pwa-192.png`, window.location.href).href;
  } catch {
    return undefined;
  }
}

export function notificationsSupported() {
  return typeof Notification !== 'undefined';
}

export function getNotificationPermission() {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission;
}

export async function requestNotificationPermission() {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

export function isDocumentInBackground() {
  if (typeof document === 'undefined') return false;
  return document.hidden === true || document.visibilityState === 'hidden';
}

/**
 * Mostra notificação com permissão concedida.
 * `requireBackground`: se true, só mostra com separador/janela em segundo plano (menos intrusivo).
 */
export function showInfoNotification({
  title = DEFAULT_TITLE,
  body,
  tag = 'openzap-info',
  silent = true,
  requireBackground = false,
} = {}) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  if (requireBackground && !isDocumentInBackground()) return;
  if (!body || typeof body !== 'string') return;
  const icon = notificationIconUrl();
  try {
    const n = new Notification(title, {
      body,
      tag,
      silent,
      lang: 'pt-BR',
      renotify: true,
      ...(icon ? { icon, badge: icon } : {}),
    });
    n.onclick = () => {
      try {
        window.focus();
      } catch {
        /* ignore */
      }
      n.close();
    };
  } catch (err) {
    console.warn('MetaWhats: falha ao mostrar notificação', err);
  }
}

export function notifyNewMessageGeneric(conversationId) {
  const tag =
    conversationId != null ? `openzap-msg-${String(conversationId)}` : 'openzap-msg';
  showInfoNotification({
    title: 'Nova mensagem',
    body: 'Você tem uma nova mensagem. Abra o app para ver.',
    tag,
    silent: true,
    requireBackground: false,
  });
}

export function notifyIncomingCallGeneric(callType) {
  const isVideo = callType === 'video';
  showInfoNotification({
    title: 'Chamada recebida',
    body: isVideo ? 'Chamada de vídeo recebida.' : 'Chamada de voz recebida.',
    tag: 'openzap-incoming-call',
    silent: false,
    requireBackground: false,
  });
}

export async function registerOpenZapServiceWorker() {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker?.register) return null;
  if (!window.isSecureContext) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    });
    return reg;
  } catch (err) {
    console.warn('MetaWhats: registo do service worker ignorado', err);
    return null;
  }
}
