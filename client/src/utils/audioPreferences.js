/**
 * Preferências de áudio (mic/saída/volumes/processamento) — localStorage.
 */

export const AUDIO_PREFS_KEY = 'metawhats_audio_prefs_v1';

export const DEFAULT_AUDIO_PREFS = Object.freeze({
  inputDeviceId: '',
  outputDeviceId: '',
  /** 0–1 (microfone via GainNode) */
  inputVolume: 1,
  /** 0–1 (HTMLMediaElement.volume) */
  outputVolume: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
});

function clamp01(n, fallback = 1) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(1, Math.max(0, x));
}

export function loadAudioPreferences() {
  try {
    const raw = localStorage.getItem(AUDIO_PREFS_KEY);
    if (!raw) return { ...DEFAULT_AUDIO_PREFS };
    const parsed = JSON.parse(raw);
    return {
      inputDeviceId: typeof parsed.inputDeviceId === 'string' ? parsed.inputDeviceId : '',
      outputDeviceId: typeof parsed.outputDeviceId === 'string' ? parsed.outputDeviceId : '',
      inputVolume: clamp01(parsed.inputVolume, 1),
      outputVolume: clamp01(parsed.outputVolume, 1),
      echoCancellation: parsed.echoCancellation !== false,
      noiseSuppression: parsed.noiseSuppression !== false,
      autoGainControl: parsed.autoGainControl !== false,
    };
  } catch {
    return { ...DEFAULT_AUDIO_PREFS };
  }
}

export function saveAudioPreferences(prefs) {
  const next = {
    ...DEFAULT_AUDIO_PREFS,
    ...prefs,
    inputVolume: clamp01(prefs.inputVolume, 1),
    outputVolume: clamp01(prefs.outputVolume, 1),
  };
  try {
    localStorage.setItem(AUDIO_PREFS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

/** Constraints de áudio para getUserMedia / applyConstraints. */
export function buildAudioConstraints(prefs, { forApplyConstraints = false } = {}) {
  const p = prefs || DEFAULT_AUDIO_PREFS;
  const base = {
    echoCancellation: p.echoCancellation !== false,
    noiseSuppression: p.noiseSuppression !== false,
    autoGainControl: p.autoGainControl !== false,
  };
  if (forApplyConstraints) return base;
  if (p.inputDeviceId) {
    return { ...base, deviceId: { ideal: p.inputDeviceId } };
  }
  return base;
}

/**
 * Aplica dispositivo de saída (Chrome/Edge). Sem efeito se não suportado.
 * @param {HTMLMediaElement | null | undefined} el
 * @param {string} deviceId
 */
export async function applyOutputSinkId(el, deviceId) {
  if (!el || typeof el.setSinkId !== 'function') return;
  const id = deviceId || '';
  try {
    await el.setSinkId(id);
  } catch (err) {
    console.warn('setSinkId:', err?.message || err);
  }
}

/**
 * @returns {Promise<{ inputs: MediaDeviceInfo[], outputs: MediaDeviceInfo[] }>}
 */
export async function listAudioDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return { inputs: [], outputs: [] };
  }
  const all = await navigator.mediaDevices.enumerateDevices();
  return {
    inputs: all.filter((d) => d.kind === 'audioinput'),
    outputs: all.filter((d) => d.kind === 'audiooutput'),
  };
}

/** Pede permissão de mic para obter labels dos dispositivos. */
export async function ensureAudioPermission() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  stream.getTracks().forEach((t) => t.stop());
}
