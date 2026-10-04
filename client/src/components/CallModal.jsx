import { useEffect, useRef, useState, useLayoutEffect, useCallback, useMemo } from 'react';
import {
  IoCall,
  IoCameraReverse,
  IoChevronUp,
  IoClose,
  IoDesktopOutline,
  IoMic,
  IoMicOff,
  IoVideocam,
  IoVideocamOff,
} from 'react-icons/io5';
import { useCall } from '../contexts/CallContext';
import { useChat } from '../contexts/ChatContext';
import { formatAddress, displayNameFromAgenda } from './MessageBubble';
import { shouldMirrorLocalVideoPreview, hasGetDisplayMedia } from '../utils/mediaDevices';
import { applyOutputSinkId } from '../utils/audioPreferences';
import BottomSheet from './shell/BottomSheet';
import AudioSettingsPanel from './AudioSettingsPanel';

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

const PIP_W = 112;
const PIP_H = 160;
const PIP_MARGIN = 12;

export default function CallModal() {
  const { agendaByAddress } = useChat();
  const {
    callState,
    callType,
    remoteAddress,
    isGroupCall,
    groupRoster,
    selectedScreenPeer,
    setSelectedScreenPeer,
    remoteDisplayVideoStream,
    localUserAddress,
    localStream,
    remoteStream,
    callDuration,
    callError,
    callNotice,
    clearCallError,
    clearCallNotice,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleVideo,
    videoInputCount,
    refreshVideoInputs,
    switchCamera,
    startVoiceScreenShare,
    stopVoiceScreenShare,
    audioSettings,
    updateAudioSettings,
  } = useCall();

  const screenShareSupported =
    typeof navigator !== 'undefined' && hasGetDisplayMedia();

  /** Vídeo grande: remoto (false) ou local (true). */
  const [swapped, setSwapped] = useState(false);
  /** Posição do PiP em px relativos ao palco (canto sup. esq.). */
  const [pipPos, setPipPos] = useState(null);
  const [audioSheetOpen, setAudioSheetOpen] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);

  const mainVideoRef = useRef(null);
  const pipVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const videoStageRef = useRef(null);
  const dragRef = useRef(null);
  const prevCallStateRef = useRef(callState);

  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  /** Espelho só na frontal; traseira (`environment`) sem espelho para texto legível. */
  const [mirrorLocalPreview, setMirrorLocalPreview] = useState(true);
  /** Só mostramos PiP quando o remoto tem faixa de vídeo activa (evita quadradinho vazio). */
  const [remoteVideoLive, setRemoteVideoLive] = useState(false);

  const placePipDefault = useCallback(() => {
    const stage = videoStageRef.current;
    if (!stage) return;
    const r = stage.getBoundingClientRect();
    setPipPos({
      left: Math.max(PIP_MARGIN, r.width - PIP_W - PIP_MARGIN),
      top: PIP_MARGIN,
    });
  }, []);

  const isVideo = callType === 'video';
  const isVoice = callType === 'voice';
  const effectiveRemoteVideo = isGroupCall ? remoteDisplayVideoStream : remoteStream;
  const localVideoLive =
    !!localStream?.getVideoTracks?.().some((t) => t.readyState === 'live');
  const useStageVideo =
    isVideo || (isVoice && (localVideoLive || remoteVideoLive));

  useLayoutEffect(() => {
    if (callState !== 'connected' || !useStageVideo || !remoteVideoLive) return;
    if (!effectiveRemoteVideo || !localStream || !localVideoLive) return;
    if (pipPos !== null) return;
    placePipDefault();
  }, [
    callState,
    useStageVideo,
    effectiveRemoteVideo,
    localStream,
    localVideoLive,
    remoteVideoLive,
    pipPos,
    placePipDefault,
  ]);

  useEffect(() => {
    if (!effectiveRemoteVideo || (!isVideo && !isVoice)) {
      setRemoteVideoLive(false);
      return undefined;
    }
    const update = () => {
      const live = effectiveRemoteVideo.getVideoTracks().some((t) => t.readyState === 'live');
      setRemoteVideoLive(live);
    };
    update();
    const onStreamTrack = () => update();
    effectiveRemoteVideo.addEventListener('addtrack', onStreamTrack);
    effectiveRemoteVideo.addEventListener('removetrack', onStreamTrack);
    const cleanups = [
      () => effectiveRemoteVideo.removeEventListener('addtrack', onStreamTrack),
      () => effectiveRemoteVideo.removeEventListener('removetrack', onStreamTrack),
    ];
    for (const track of effectiveRemoteVideo.getVideoTracks()) {
      const handler = () => update();
      track.addEventListener('ended', handler);
      track.addEventListener('mute', handler);
      track.addEventListener('unmute', handler);
      cleanups.push(() => {
        track.removeEventListener('ended', handler);
        track.removeEventListener('mute', handler);
        track.removeEventListener('unmute', handler);
      });
    }
    return () => cleanups.forEach((fn) => fn());
  }, [effectiveRemoteVideo, isVideo, isVoice]);

  useEffect(() => {
    if (callState === 'idle') {
      setSwapped(false);
      setPipPos(null);
      setMuted(false);
      setVideoOff(false);
      setAudioSheetOpen(false);
    }
  }, [callState]);

  /** Volume / dispositivo de saída nos elementos que tocam o áudio remoto. */
  useEffect(() => {
    const vol = Number.isFinite(audioSettings?.outputVolume) ? audioSettings.outputVolume : 1;
    const sink = audioSettings?.outputDeviceId || '';
    const els = [remoteAudioRef.current, mainVideoRef.current, pipVideoRef.current].filter(Boolean);
    for (const el of els) {
      try {
        if (!el.muted) el.volume = vol;
      } catch {
        /* ignore */
      }
      void applyOutputSinkId(el, sink);
    }
  }, [
    audioSettings?.outputVolume,
    audioSettings?.outputDeviceId,
    remoteStream,
    effectiveRemoteVideo,
    callState,
    swapped,
    remoteVideoLive,
  ]);

  const onAudioSettingsChange = useCallback(
    async (partial) => {
      setAudioBusy(true);
      try {
        await updateAudioSettings(partial);
      } finally {
        setAudioBusy(false);
      }
    },
    [updateAudioSettings]
  );

  /** Ligado (quem liga ou quem atende): sempre interlocutor em grande, câmara local no PiP. */
  useEffect(() => {
    const prev = prevCallStateRef.current;
    prevCallStateRef.current = callState;
    if (callState !== 'connected' || !useStageVideo) return;
    if (prev === 'connected') return;
    setSwapped(false);
  }, [callState, useStageVideo]);

  useEffect(() => {
    const onResize = () => {
      if (callState !== 'connected' || !useStageVideo || pipPos == null) return;
      const stage = videoStageRef.current;
      if (!stage) return;
      const r = stage.getBoundingClientRect();
      setPipPos((prev) => {
        if (!prev) return prev;
        return {
          left: Math.min(Math.max(PIP_MARGIN, prev.left), r.width - PIP_W - PIP_MARGIN),
          top: Math.min(Math.max(PIP_MARGIN, prev.top), r.height - PIP_H - PIP_MARGIN),
        };
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [callState, useStageVideo, pipPos]);

  /** Só local em ecrã cheio (a chamar ou ligado sem vídeo remoto ainda). Ligado com remoto: grande/PiP. */
  useEffect(() => {
    const main = mainVideoRef.current;
    const pip = pipVideoRef.current;
    if (!main) return;

    const soloLocal =
      useStageVideo &&
      localStream &&
      localVideoLive &&
      (callState === 'calling' ||
        (callState === 'connected' && (!effectiveRemoteVideo || !remoteVideoLive)));

    const pipLocal =
      localStream?.getVideoTracks?.().some((t) => t.readyState === 'live') ? localStream : null;

    if (soloLocal) {
      main.srcObject = localStream;
      main.muted = true;
      main.play().catch(() => {});
      if (pip) pip.srcObject = null;
      return;
    }

    if (callState !== 'connected' || !effectiveRemoteVideo) return;

    const remoteOnMain = !swapped;
    if (remoteOnMain) {
      main.srcObject = effectiveRemoteVideo;
      main.muted = false;
      if (pip) {
        if (pipLocal) {
          pip.srcObject = pipLocal;
          pip.muted = true;
        } else {
          pip.srcObject = null;
        }
      }
    } else if (pipLocal) {
      main.srcObject = pipLocal;
      main.muted = true;
      if (pip) {
        pip.srcObject = effectiveRemoteVideo;
        pip.muted = false;
      }
    } else {
      main.srcObject = effectiveRemoteVideo;
      main.muted = false;
      if (pip) pip.srcObject = null;
    }
    main.play().catch(() => {});
    if (pip) pip.play().catch(() => {});
  }, [
    localStream,
    effectiveRemoteVideo,
    swapped,
    callState,
    useStageVideo,
    localVideoLive,
    remoteVideoLive,
    /** PiP só existe após `placePipDefault`; sem re-correr aqui, `pipVideoRef` ficava sem `srcObject`. Usamos só «há posição» para não re-disparar a cada arrasto. */
    pipPos != null,
  ]);

  useEffect(() => {
    const el = remoteAudioRef.current;
    if (!el) return;
    if (!remoteStream || callType !== 'voice') {
      el.srcObject = null;
      return;
    }
    if (!isGroupCall && remoteVideoLive) {
      el.srcObject = null;
      return;
    }
    el.srcObject = remoteStream;
    el.muted = false;
    el.volume = Number.isFinite(audioSettings?.outputVolume) ? audioSettings.outputVolume : 1;
    void applyOutputSinkId(el, audioSettings?.outputDeviceId || '');
    const p = el.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }, [remoteStream, callType, remoteVideoLive, isGroupCall, audioSettings?.outputVolume, audioSettings?.outputDeviceId]);

  useEffect(() => {
    if (callState === 'connected' && isVideo && localStream) {
      void refreshVideoInputs();
    }
  }, [callState, isVideo, localStream, refreshVideoInputs]);

  const localVideoTrackId = localStream?.getVideoTracks?.()[0]?.id;

  useEffect(() => {
    if (!isVideo || !localStream) {
      setMirrorLocalPreview(true);
      return undefined;
    }
    const sync = () => setMirrorLocalPreview(shouldMirrorLocalVideoPreview(localStream));
    sync();
    const track = localStream.getVideoTracks()[0];
    if (!track) return undefined;
    const onCfg = () => sync();
    track.addEventListener('configurationchange', onCfg);
    return () => track.removeEventListener('configurationchange', onCfg);
  }, [localStream, isVideo, localVideoTrackId]);

  const privateCallDisplayName = useMemo(
    () =>
      remoteAddress ? displayNameFromAgenda(remoteAddress, agendaByAddress) : '',
    [remoteAddress, agendaByAddress]
  );

  /** Texto do aviso transitório (ex.: «Fulano encerrou o compartilhamento de tela»). */
  const noticeMessage = useMemo(() => {
    if (!callNotice || callNotice.kind !== 'screen_share_stopped') return null;
    if (isGroupCall) {
      const name =
        displayNameFromAgenda(callNotice.from, agendaByAddress) ||
        formatAddress(callNotice.from);
      return `${name} encerrou o compartilhamento de tela`;
    }
    return 'O interlocutor encerrou o compartilhamento de tela';
  }, [callNotice, isGroupCall, agendaByAddress]);

  const onPipPointerDown = (e) => {
    e.stopPropagation();
    if (pipPos == null) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origLeft: pipPos.left,
      origTop: pipPos.top,
    };
  };

  const onPipPointerMove = (e) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId || pipPos == null) return;
    const stage = videoStageRef.current;
    if (!stage) return;
    const r = stage.getBoundingClientRect();
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    let left = d.origLeft + dx;
    let top = d.origTop + dy;
    left = Math.max(PIP_MARGIN, Math.min(left, r.width - PIP_W - PIP_MARGIN));
    top = Math.max(PIP_MARGIN, Math.min(top, r.height - PIP_H - PIP_MARGIN));
    setPipPos({ left, top });
  };

  const onPipPointerUp = (e) => {
    const d = dragRef.current;
    if (d?.pointerId === e.pointerId) {
      dragRef.current = null;
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  if (callError && callState === 'idle') {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-6">
        <div className="w-full max-w-sm rounded-2xl border border-whatsapp-border bg-whatsapp-sidebar p-6 shadow-2xl">
          <p className="text-sm leading-relaxed text-whatsapp-text">{callError}</p>
          <button
            type="button"
            onClick={clearCallError}
            className="mt-5 w-full rounded-xl bg-whatsapp-green py-3 text-sm font-semibold text-whatsapp-on-primary"
          >
            OK
          </button>
        </div>
      </div>
    );
  }

  if (callState === 'idle') return null;

  const voiceRemoteAudio =
    callType === 'voice' ? (
      <audio
        ref={remoteAudioRef}
        autoPlay
        playsInline
        // NÃO usar sr-only (clip/1px): em vários browsers o MediaStream fica sem som.
        className="pointer-events-none fixed h-px w-px opacity-0"
        aria-hidden
      />
    ) : null;

  const noticeBanner = noticeMessage ? (
    <button
      type="button"
      onClick={clearCallNotice}
      className="absolute left-1/2 top-3 z-30 max-w-[90%] -translate-x-1/2 truncate rounded-full bg-black/75 px-4 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur-sm transition-opacity hover:opacity-90 sm:top-4"
      aria-label="Dispensar aviso"
    >
      {noticeMessage}
    </button>
  ) : null;

  const label = isGroupCall
    ? 'Chamada de grupo'
    : remoteAddress
      ? privateCallDisplayName || formatAddress(remoteAddress)
      : 'Desconhecido';
  const privateCallAddressTitle =
    !isGroupCall && remoteAddress ? { title: remoteAddress } : {};

  const videoDual =
    useStageVideo &&
    callState === 'connected' &&
    effectiveRemoteVideo &&
    remoteVideoLive &&
    localStream;
  const videoSoloLocal =
    useStageVideo &&
    localStream &&
    localVideoLive &&
    (callState === 'calling' ||
      (callState === 'connected' && (!effectiveRemoteVideo || !remoteVideoLive)));

  const groupScreenPeers = (groupRoster || []).filter(
    (a) => a && localUserAddress && String(a).toLowerCase() !== String(localUserAddress).toLowerCase()
  );

  const controls = (
    <div className="relative flex flex-wrap items-center justify-center gap-4 sm:gap-6 py-4 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:py-6 sm:px-4 bg-whatsapp-header">
      {callState === 'connected' && (
        <button
          type="button"
          onClick={() => setAudioSheetOpen(true)}
          className="absolute left-1/2 top-0 z-10 flex h-8 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-whatsapp-input text-white shadow-lg hover:bg-whatsapp-hover transition-colors"
          aria-label="Configurações de áudio"
          title="Áudio"
        >
          <IoChevronUp className="h-5 w-5" aria-hidden />
        </button>
      )}
      {callState === 'connected' && (
        <>
          <button
            type="button"
            onClick={() => {
              const enabled = toggleMute();
              setMuted(!enabled);
            }}
            className={`p-4 rounded-full transition-colors ${
              muted
                ? 'bg-red-500/20 text-red-400'
                : 'bg-whatsapp-hover text-white hover:bg-whatsapp-input'
            }`}
            aria-label={muted ? 'Ativar microfone' : 'Silenciar'}
          >
            {muted ? <IoMicOff className="w-6 h-6" /> : <IoMic className="w-6 h-6" />}
          </button>
          {isVideo && (
            <button
              type="button"
              onClick={() => {
                const enabled = toggleVideo();
                setVideoOff(!enabled);
              }}
              className={`p-4 rounded-full transition-colors ${
                videoOff
                  ? 'bg-red-500/20 text-red-400'
                  : 'bg-whatsapp-hover text-white hover:bg-whatsapp-input'
              }`}
              aria-label={videoOff ? 'Ativar vídeo' : 'Desativar vídeo'}
            >
              {videoOff ? <IoVideocamOff className="w-6 h-6" /> : <IoVideocam className="w-6 h-6" />}
            </button>
          )}
          {isVoice && (
            <button
              type="button"
              disabled={!screenShareSupported}
              onClick={() => {
                if (!screenShareSupported) return;
                void (localVideoLive ? stopVoiceScreenShare() : startVoiceScreenShare());
              }}
              className={`p-4 rounded-full transition-colors ${
                !screenShareSupported
                  ? 'cursor-not-allowed bg-whatsapp-hover/40 text-white/40'
                  : localVideoLive
                    ? 'bg-whatsapp-green/25 text-whatsapp-green'
                    : 'bg-whatsapp-hover text-white hover:bg-whatsapp-input'
              }`}
              aria-label={localVideoLive ? 'Parar compartilhamento de tela' : 'Compartilhar tela'}
              title={
                !screenShareSupported
                  ? 'Compartilhamento de tela indisponível neste navegador ou dispositivo.'
                  : localVideoLive
                    ? 'Parar compartilhamento'
                    : 'Compartilhar tela'
              }
            >
              <IoDesktopOutline className="w-6 h-6" />
            </button>
          )}
          {isGroupCall && callState === 'connected' && groupScreenPeers.length > 0 && (
            <label className="flex min-w-0 max-w-[min(100%,220px)] flex-col gap-1 text-left">
              <span className="text-[10px] font-medium uppercase tracking-wide text-white/60">
                Ver compartilhamento / vídeo de
              </span>
              <select
                value={selectedScreenPeer || ''}
                onChange={(e) => setSelectedScreenPeer(e.target.value || null)}
                className="rounded-lg border border-white/20 bg-whatsapp-input px-2 py-2 text-xs text-white"
              >
                <option value="">Automático</option>
                {groupScreenPeers.map((addr) => (
                  <option key={addr} value={addr}>
                    {displayNameFromAgenda(addr, agendaByAddress)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {isVideo && videoInputCount > 1 && (
            <button
              type="button"
              onClick={() => void switchCamera()}
              className="p-4 rounded-full bg-whatsapp-hover text-white transition-colors hover:bg-whatsapp-input"
              aria-label="Trocar câmera"
              title="Trocar câmera"
            >
              <IoCameraReverse className="w-6 h-6" />
            </button>
          )}
        </>
      )}

      {callState === 'ringing' && (
        <button
          type="button"
          onClick={acceptCall}
          className="p-4 rounded-full bg-whatsapp-green text-white hover:bg-whatsapp-green/80 transition-colors"
          aria-label="Aceitar chamada"
        >
          <IoCall className="w-7 h-7" />
        </button>
      )}

      <button
        type="button"
        onClick={callState === 'ringing' ? rejectCall : endCall}
        className="p-4 rounded-full bg-red-600 text-white hover:bg-red-700 transition-colors"
        aria-label={callState === 'ringing' ? 'Rejeitar chamada' : 'Encerrar chamada'}
      >
        <IoClose className="w-7 h-7" />
      </button>
    </div>
  );

  const audioSheet = (
    <BottomSheet
      open={audioSheetOpen && callState === 'connected'}
      onClose={() => setAudioSheetOpen(false)}
      titleId="call-audio-settings-title"
      zClass="z-[80]"
    >
      <div className="px-4 pb-2 pt-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 id="call-audio-settings-title" className="text-base font-semibold text-whatsapp-text">
            Configurações de áudio
          </h3>
          <button
            type="button"
            onClick={() => setAudioSheetOpen(false)}
            className="rounded-full p-2 text-whatsapp-text-secondary hover:bg-whatsapp-hover hover:text-whatsapp-text"
            aria-label="Fechar"
          >
            <IoClose className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-3 text-[12px] leading-relaxed text-whatsapp-text-secondary">
          Alterações aplicam-se de imediato nesta chamada.
        </p>
        <div className="max-h-[min(58dvh,420px)] overflow-y-auto pr-0.5">
          <AudioSettingsPanel
            prefs={audioSettings}
            onChange={onAudioSettingsChange}
            compact
            busy={audioBusy}
          />
        </div>
      </div>
    </BottomSheet>
  );

  /** Só câmera local em tela cheia: discando ou conectado aguardando vídeo remoto. */
  if (videoSoloLocal) {
    const soloTitle = (() => {
      if (callState === 'calling') return 'Chamando…';
      if (isVoice && localVideoLive) return 'Compartilhando sua tela…';
      return 'Estabelecendo vídeo…';
    })();
    const soloFit = isVideo ? 'object-cover' : 'object-contain';
    const soloMirror = isVideo && mirrorLocalPreview ? 'scale-x-[-1]' : '';
    return (
      <>
        {voiceRemoteAudio}
        <div className="fixed inset-0 z-[60] flex flex-col bg-black">
        <div ref={videoStageRef} className="relative min-h-0 w-full flex-1 overflow-hidden">
          <div className="absolute inset-0 z-0 bg-black">
            <video
              ref={mainVideoRef}
              autoPlay
              playsInline
              muted
              className={`pointer-events-none h-full w-full ${soloFit} ${soloMirror}`}
            />
          </div>
          {noticeBanner}
          <div className="pointer-events-none absolute left-3 top-3 z-20 flex flex-col gap-1 sm:left-4 sm:top-4">
            <span className="rounded-full bg-black/55 px-3 py-1 text-sm text-white">{soloTitle}</span>
            <span
              className="rounded-full bg-black/45 px-3 py-1 text-xs text-white/85"
              {...privateCallAddressTitle}
            >
              {label}
            </span>
            {callState === 'connected' && (
              <span className="rounded-full bg-black/45 px-3 py-1 text-xs text-white/85">
                {formatDuration(callDuration)}
              </span>
            )}
          </div>
        </div>
        {controls}
      </div>
      {audioSheet}
      </>
    );
  }

  /** Videochamada com remoto visível: grande + PiP; toque no grande troca. */
  if (videoDual) {
    const stageFit = isVideo ? 'object-cover' : 'object-contain';
    const mainMirror = swapped && isVideo && mirrorLocalPreview ? 'scale-x-[-1]' : '';
    const pipMirror = !swapped && isVideo && mirrorLocalPreview ? 'scale-x-[-1]' : '';
    return (
      <>
        {voiceRemoteAudio}
        <div className="fixed inset-0 z-[60] flex flex-col bg-black">
        <div ref={videoStageRef} className="relative min-h-0 w-full flex-1 overflow-hidden">
          <button
            type="button"
            className={`absolute inset-0 z-0 block h-full w-full border-0 bg-black p-0 outline-none focus-visible:ring-2 focus-visible:ring-whatsapp-green ${
              localVideoLive ? 'cursor-pointer' : 'cursor-default'
            }`}
            onClick={() => {
              if (localVideoLive) setSwapped((s) => !s);
            }}
            aria-label="Trocar entre vista grande e miniatura"
          >
            <video
              ref={mainVideoRef}
              autoPlay
              playsInline
              className={`pointer-events-none h-full w-full ${stageFit} ${mainMirror}`}
            />
          </button>

          {localStream && localVideoLive && pipPos != null && (
            <div
              role="presentation"
              className="absolute z-10 cursor-grab active:cursor-grabbing overflow-hidden rounded-xl border-2 border-white/25 bg-black shadow-lg [touch-action:none]"
              style={{
                left: pipPos.left,
                top: pipPos.top,
                width: PIP_W,
                height: PIP_H,
              }}
              onPointerDown={onPipPointerDown}
              onPointerMove={onPipPointerMove}
              onPointerUp={onPipPointerUp}
              onPointerCancel={onPipPointerUp}
              onClick={(e) => e.stopPropagation()}
            >
              <video
                ref={pipVideoRef}
                autoPlay
                playsInline
                className={`pointer-events-none h-full min-h-0 w-full min-w-0 rounded-[10px] ${stageFit} bg-black ${pipMirror}`}
              />
            </div>
          )}

          {noticeBanner}
          <div className="pointer-events-none absolute left-3 top-3 z-20 rounded-full bg-black/55 px-3 py-1 text-sm text-white sm:left-4 sm:top-4">
            {formatDuration(callDuration)}
          </div>
        </div>
        {controls}
      </div>
      {audioSheet}
      </>
    );
  }

  /** Voz ou a chamar / a tocar: cartão compacto. */
  return (
    <>
      {voiceRemoteAudio}
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95">
      {noticeBanner}
      <div className="relative mx-4 w-full max-w-md overflow-hidden rounded-2xl bg-whatsapp-sidebar shadow-2xl">
        <div className="flex flex-col items-center justify-center px-6 py-12">
          <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-whatsapp-green/20">
            {isVideo ? (
              <IoVideocam className="h-12 w-12 text-whatsapp-green" />
            ) : (
              <IoCall className="h-12 w-12 text-whatsapp-green" />
            )}
          </div>
          <h2 className="mb-1 text-xl font-medium text-white" {...privateCallAddressTitle}>
            {label}
          </h2>
          <p className="mb-2 text-sm text-whatsapp-text-secondary">
            {callState === 'calling' && 'Chamando...'}
            {callState === 'ringing' && (isVideo ? 'Videochamada recebida' : 'Chamada de voz recebida')}
            {callState === 'connected' && formatDuration(callDuration)}
          </p>
          {callState === 'calling' && (
            <div className="mt-2 flex gap-1">
              <span
                className="h-2 w-2 animate-bounce rounded-full bg-whatsapp-green"
                style={{ animationDelay: '0ms' }}
              />
              <span
                className="h-2 w-2 animate-bounce rounded-full bg-whatsapp-green"
                style={{ animationDelay: '200ms' }}
              />
              <span
                className="h-2 w-2 animate-bounce rounded-full bg-whatsapp-green"
                style={{ animationDelay: '400ms' }}
              />
            </div>
          )}
        </div>
        {controls}
      </div>
    </div>
    {audioSheet}
    </>
  );
}
