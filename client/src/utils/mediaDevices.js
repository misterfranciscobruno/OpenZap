/**
 * Compatibilidade Safari / iOS e mensagens claras para permissões (câmera, microfone, WebRTC).
 */

export function ensureGetUserMediaPolyfill() {
  if (typeof navigator === 'undefined') return;
  if (navigator.mediaDevices?.getUserMedia) return;

  const legacy =
    navigator.getUserMedia ||
    navigator.webkitGetUserMedia ||
    navigator.mozGetUserMedia ||
    navigator.msGetUserMedia;

  if (!legacy) return;

  if (!navigator.mediaDevices) {
    navigator.mediaDevices = {};
  }

  navigator.mediaDevices.getUserMedia = function getUserMedia(constraints) {
    return new Promise((resolve, reject) => {
      legacy.call(navigator, constraints, resolve, reject);
    });
  };
}

ensureGetUserMediaPolyfill();

export function isSecureContextForMedia() {
  if (typeof window === 'undefined') return true;
  if (window.isSecureContext) return true;
  const { protocol, hostname } = window.location;
  if (protocol === 'https:') return true;
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
    return true;
  }
  return false;
}

export function hasGetUserMedia() {
  if (typeof navigator === 'undefined') return false;
  ensureGetUserMediaPolyfill();
  return typeof navigator.mediaDevices?.getUserMedia === 'function';
}

export function hasGetDisplayMedia() {
  if (typeof navigator === 'undefined') return false;
  return typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

/**
 * Faixa de vídeo da captura de tela (para adicionar a uma chamada de voz já ativa).
 * @returns {Promise<MediaStreamTrack>}
 */
export async function requestScreenCaptureVideoTrack() {
  if (!isSecureContextForMedia()) {
    const err = new Error('HTTPS_REQUIRED');
    err.code = 'HTTPS_REQUIRED';
    throw err;
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    const err = new Error('DISPLAY_NOT_SUPPORTED');
    err.code = 'DISPLAY_NOT_SUPPORTED';
    throw err;
  }

  let displayStream = null;
  try {
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
  } catch (e) {
    if (displayStream) {
      displayStream.getTracks().forEach((t) => t.stop());
    }
    throw e;
  }

  const screenVideo = displayStream.getVideoTracks()[0];
  if (!screenVideo) {
    displayStream.getTracks().forEach((t) => t.stop());
    const err = new Error('NO_SCREEN_TRACK');
    err.code = 'NO_SCREEN_TRACK';
    throw err;
  }

  displayStream.getAudioTracks().forEach((t) => t.stop());
  return screenVideo;
}

/**
 * @param {MediaStreamConstraints} constraints
 * @returns {Promise<MediaStream>}
 */
export async function requestMediaStream(constraints) {
  ensureGetUserMediaPolyfill();
  if (!isSecureContextForMedia()) {
    const err = new Error('HTTPS_REQUIRED');
    err.code = 'HTTPS_REQUIRED';
    throw err;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    const err = new Error('NOT_SUPPORTED');
    err.code = 'NOT_SUPPORTED';
    throw err;
  }
  return navigator.mediaDevices.getUserMedia(constraints);
}

export function mediaErrorMessagePt(err) {
  if (!err) return 'Não foi possível acessar o microfone ou a câmera.';
  if (err.code === 'HTTPS_REQUIRED') {
    return 'Este site precisa de HTTPS para usar microfone e câmera (em iPhone/Android). Use https:// ou localhost.';
  }
  if (err.code === 'NOT_SUPPORTED') {
    return 'Este navegador não expõe acesso à câmera/microfone. Atualize o Safari ou use outro navegador.';
  }
  if (err.code === 'DISPLAY_NOT_SUPPORTED') {
    return 'Este navegador não suporta compartilhamento de tela. Use Chrome, Edge ou Firefox no computador.';
  }
  if (err.code === 'NO_SCREEN_TRACK' || err.code === 'NO_MIC_TRACK') {
    return 'Não foi possível obter microfone ou tela para a chamada.';
  }
  const name = err.name || '';
  if (name === 'AbortError') {
    return 'Compartilhamento de tela cancelado ou interrompido.';
  }
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Permissão negada. No iPhone: Ajustes > Safari > Câmera/Microfone, ou toque em “Permitir” quando o sistema pedir.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'Não foi encontrado microfone ou câmera neste dispositivo.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Câmera ou microfone estão sendo usados por outro app. Feche-o e tente novamente.';
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return 'Este modo de câmera não está disponível. Tente a outra câmera.';
  }
  if (typeof err.message === 'string' && err.message.length < 120) {
    return err.message;
  }
  return 'Não foi possível acessar o microfone ou a câmera.';
}

/**
 * Espelho horizontal na pré-visualização local: adequado à câmera frontal (efeito espelho).
 * Na câmera traseira (`environment`), espelhar inverte texto e códigos — não espelhar.
 * Em desktop, `facingMode` costuma vir vazio: mantém-se o espelho (comportamento padrão da webcam).
 */
export function shouldMirrorLocalVideoPreview(stream) {
  if (!stream) return true;
  const track = stream.getVideoTracks()[0];
  if (!track) return true;
  if (typeof track.getSettings === 'function') {
    const { facingMode } = track.getSettings();
    if (facingMode === 'environment') return false;
    if (facingMode === 'user') return true;
  }
  const lab = (track.label || '').toLowerCase();
  if (
    lab.includes('back') ||
    lab.includes('rear') ||
    lab.includes('traseira') ||
    lab.includes('posterior') ||
    lab.includes('environment')
  ) {
    return false;
  }
  return true;
}
