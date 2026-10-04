import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { useChat } from './ChatContext';
import { useAuth } from './AuthContext';
import {
  requestMediaStream,
  requestScreenCaptureVideoTrack,
  mediaErrorMessagePt,
} from '../utils/mediaDevices';
import {
  buildAudioConstraints,
  loadAudioPreferences,
  saveAudioPreferences,
} from '../utils/audioPreferences';
import { notifyIncomingCallGeneric } from '../utils/browserNotifications';

const CallContext = createContext(null);

const FALLBACK_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

let cachedIceServers = null;
let iceServersPromise = null;

async function getIceServers() {
  if (cachedIceServers?.length) return cachedIceServers;
  if (!iceServersPromise) {
    iceServersPromise = (async () => {
      try {
        const r = await fetch('/api/ice-servers', { credentials: 'same-origin' });
        if (!r.ok) throw new Error(`ice_http_${r.status}`);
        const data = await r.json();
        if (Array.isArray(data?.iceServers) && data.iceServers.length) {
          cachedIceServers = data.iceServers;
          return cachedIceServers;
        }
      } catch (err) {
        console.warn('ICE servers API:', err);
      }
      return FALLBACK_ICE_SERVERS;
    })().finally(() => {
      iceServersPromise = null;
    });
  }
  return iceServersPromise;
}

async function createRtcPeerConnection() {
  const iceServers = await getIceServers();
  return new RTCPeerConnection({ iceServers, iceCandidatePoolSize: 8 });
}

/** Reserva m-line de vídeo (ecrã) sem faixa — evita renegociação a meio da chamada. */
function ensureVideoTransceiver(pc) {
  const found = pc.getTransceivers().find(
    (t) => t.receiver?.track?.kind === 'video' || t.sender?.track?.kind === 'video'
  );
  if (found) return found;
  return pc.addTransceiver('video', { direction: 'sendrecv' });
}

function attachLocalMedia(pc, stream, callType) {
  stream.getTracks().forEach((track) => pc.addTrack(track, stream));
  if (callType === 'voice' || stream.getVideoTracks().length === 0) {
    ensureVideoTransceiver(pc);
  }
}

function normAddr(a) {
  return String(a || '').toLowerCase();
}

/** Espera um valor (ex.: RTCPeerConnection) ficar disponível — evita descartar oferta/ICE em corrida. */
function waitFor(getValue, timeoutMs = 10000, intervalMs = 50) {
  const existing = getValue();
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const id = setInterval(() => {
      const v = getValue();
      if (v) {
        clearInterval(id);
        resolve(v);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        clearInterval(id);
        reject(new Error('timeout'));
      }
    }, intervalMs);
  });
}

export function CallProvider({ children }) {
  const { socketRef, socket } = useChat();
  const { user } = useAuth();
  const myAddr = normAddr(user?.address);

  const [callState, setCallState] = useState('idle');
  const [callType, setCallType] = useState(null);
  const [remoteAddress, setRemoteAddress] = useState(null);
  const [callConversationId, setCallConversationId] = useState(null);
  const [isGroupCall, setIsGroupCall] = useState(false);
  const [groupRoster, setGroupRoster] = useState([]);
  const [selectedScreenPeer, setSelectedScreenPeer] = useState(null);
  const [remoteDisplayVideoStream, setRemoteDisplayVideoStream] = useState(null);

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  /** Pipeline mic → GainNode → faixa enviada (volume de entrada). */
  const audioPipelineRef = useRef(null);
  const [audioSettings, setAudioSettings] = useState(() => loadAudioPreferences());
  const audioSettingsRef = useRef(audioSettings);
  audioSettingsRef.current = audioSettings;
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [callDuration, setCallDuration] = useState(0);
  const [callError, setCallError] = useState(null);
  /** Aviso transitório exibido na UI da chamada (ex.: interlocutor parou de partilhar ecrã). */
  const [callNotice, setCallNotice] = useState(null);
  const callNoticeTimeoutRef = useRef(null);
  const [videoInputCount, setVideoInputCount] = useState(0);
  const videoInputIdsRef = useRef([]);
  const durationInterval = useRef(null);
  const pendingCandidates = useRef([]);

  const callStateRef = useRef(callState);
  const callTypeRef = useRef(callType);
  const endCallRef = useRef(() => {});
  const remoteAddressRef = useRef(null);
  const stopVoiceScreenShareRef = useRef(async () => {});
  const isGroupCallRef = useRef(false);
  const callConversationIdRef = useRef(null);
  const selectedScreenPeerRef = useRef(null);
  /** @type {React.MutableRefObject<Map<string, { pc: RTCPeerConnection, pendingIce: unknown[], remoteInbound: Map<string, MediaStreamTrack>, remoteStream: MediaStream | null }>>} */
  const groupPeersRef = useRef(new Map());

  callStateRef.current = callState;
  callTypeRef.current = callType;
  remoteAddressRef.current = remoteAddress;
  isGroupCallRef.current = isGroupCall;
  callConversationIdRef.current = callConversationId;
  selectedScreenPeerRef.current = selectedScreenPeer;

  const refreshVideoInputs = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      videoInputIdsRef.current = [];
      setVideoInputCount(0);
      return;
    }
    try {
      const list = (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.kind === 'videoinput'
      );
      const ids = [...new Set(list.map((d) => d.deviceId).filter(Boolean))];
      videoInputIdsRef.current = ids;
      setVideoInputCount(ids.length);
    } catch {
      videoInputIdsRef.current = [];
      setVideoInputCount(0);
    }
  }, []);

  const rebuildGroupMedia = useCallback(() => {
    const audioTracks = [];
    let firstVideoPeer = null;
    let firstVideoMs = null;
    for (const [addr, peer] of groupPeersRef.current) {
      if (!peer.remoteStream) continue;
      for (const t of peer.remoteStream.getAudioTracks()) {
        if (t.readyState === 'live') audioTracks.push(t);
      }
      const vids = peer.remoteStream.getVideoTracks().filter((t) => t.readyState === 'live');
      if (vids.length && !firstVideoPeer) {
        firstVideoPeer = addr;
        firstVideoMs = new MediaStream(vids);
      }
    }
    const mixedAudio = audioTracks.length ? new MediaStream(audioTracks) : null;
    remoteStreamRef.current = mixedAudio;
    setRemoteStream(mixedAudio);

    const pick = selectedScreenPeerRef.current;
    let displayMs = null;
    if (pick && groupPeersRef.current.has(pick)) {
      const pr = groupPeersRef.current.get(pick);
      if (pr?.remoteStream) {
        const vt = pr.remoteStream.getVideoTracks().filter((t) => t.readyState === 'live');
        if (vt.length) displayMs = new MediaStream(vt);
      }
    } else if (firstVideoMs) {
      displayMs = firstVideoMs;
    }
    setRemoteDisplayVideoStream(displayMs);
  }, []);

  const removeGroupPeer = useCallback(
    (addrRaw) => {
      const addr = normAddr(addrRaw);
      const peer = groupPeersRef.current.get(addr);
      if (!peer) return;
      try {
        peer.pc.close();
      } catch {
        /* ignore */
      }
      groupPeersRef.current.delete(addr);
      rebuildGroupMedia();
    },
    [rebuildGroupMedia]
  );

  const closeAllGroupPeers = useCallback(() => {
    for (const [, peer] of groupPeersRef.current) {
      try {
        peer.pc.close();
      } catch {
        /* ignore */
      }
    }
    groupPeersRef.current.clear();
    setRemoteDisplayVideoStream(null);
  }, []);

  const stopAudioPipeline = useCallback(() => {
    const pipe = audioPipelineRef.current;
    audioPipelineRef.current = null;
    if (!pipe) return;
    try {
      pipe.rawTrack?.stop();
    } catch {
      /* ignore */
    }
    try {
      pipe.outTrack?.stop();
    } catch {
      /* ignore */
    }
    try {
      if (pipe.ctx && pipe.ctx.state !== 'closed') void pipe.ctx.close();
    } catch {
      /* ignore */
    }
  }, []);

  const openMicPipeline = useCallback(
    async (prefs) => {
      const cap = await requestMediaStream({
        audio: buildAudioConstraints(prefs),
        video: false,
      });
      const rawTrack = cap.getAudioTracks()[0];
      if (!rawTrack) {
        cap.getTracks().forEach((t) => t.stop());
        const err = new Error('NO_MIC_TRACK');
        err.code = 'NO_MIC_TRACK';
        throw err;
      }
      cap.getTracks().forEach((t) => {
        if (t !== rawTrack) t.stop();
      });

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch {
          /* ignore */
        }
      }
      const source = ctx.createMediaStreamSource(new MediaStream([rawTrack]));
      const gain = ctx.createGain();
      gain.gain.value = Number.isFinite(prefs?.inputVolume) ? prefs.inputVolume : 1;
      const dest = ctx.createMediaStreamDestination();
      source.connect(gain);
      gain.connect(dest);
      const outTrack = dest.stream.getAudioTracks()[0];
      if (!outTrack) {
        rawTrack.stop();
        try {
          await ctx.close();
        } catch {
          /* ignore */
        }
        const err = new Error('NO_MIC_TRACK');
        err.code = 'NO_MIC_TRACK';
        throw err;
      }
      audioPipelineRef.current = { ctx, rawTrack, gain, outTrack };
      return outTrack;
    },
    []
  );

  const acquireCallMedia = useCallback(
    async (type) => {
      const prefs = audioSettingsRef.current;
      stopAudioPipeline();
      const audioTrack = await openMicPipeline(prefs);
      if (type === 'video') {
        const vs = await requestMediaStream({ audio: false, video: true });
        const videoTrack = vs.getVideoTracks()[0];
        vs.getTracks().forEach((t) => {
          if (t !== videoTrack) t.stop();
        });
        if (!videoTrack) {
          stopAudioPipeline();
          const err = new Error('NOT_FOUND');
          err.name = 'NotFoundError';
          throw err;
        }
        return new MediaStream([audioTrack, videoTrack]);
      }
      return new MediaStream([audioTrack]);
    },
    [openMicPipeline, stopAudioPipeline]
  );

  const replaceOutboundAudioTrack = useCallback(async (newAudioTrack) => {
    if (isGroupCallRef.current) {
      for (const [, peer] of groupPeersRef.current) {
        const sender = peer.pc.getSenders().find((s) => s.track?.kind === 'audio');
        if (sender) {
          try {
            await sender.replaceTrack(newAudioTrack);
          } catch (err) {
            console.error('replaceTrack áudio grupo:', err);
          }
        }
      }
      return;
    }
    const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === 'audio');
    if (sender) {
      try {
        await sender.replaceTrack(newAudioTrack);
      } catch (err) {
        console.error('replaceTrack áudio:', err);
      }
    }
  }, []);

  const swapLocalMicrophone = useCallback(
    async (prefs) => {
      const oldStream = localStreamRef.current;
      if (!oldStream) return;
      const prevAudio = oldStream.getAudioTracks()[0];
      const wasEnabled = prevAudio ? prevAudio.enabled : true;
      const videoTracks = oldStream.getVideoTracks();

      const prevPipe = audioPipelineRef.current;
      audioPipelineRef.current = null;

      let newOut;
      try {
        newOut = await openMicPipeline(prefs);
        newOut.enabled = wasEnabled;
      } catch (err) {
        audioPipelineRef.current = prevPipe;
        throw err;
      }

      if (prevPipe) {
        try {
          prevPipe.rawTrack?.stop();
        } catch {
          /* ignore */
        }
        try {
          prevPipe.outTrack?.stop();
        } catch {
          /* ignore */
        }
        try {
          if (prevPipe.ctx && prevPipe.ctx.state !== 'closed') void prevPipe.ctx.close();
        } catch {
          /* ignore */
        }
      }

      if (prevAudio) {
        try {
          oldStream.removeTrack(prevAudio);
        } catch {
          /* ignore */
        }
      }
      oldStream.addTrack(newOut);
      const newMs = new MediaStream([...oldStream.getAudioTracks(), ...videoTracks]);
      localStreamRef.current = newMs;
      setLocalStream(newMs);
      await replaceOutboundAudioTrack(newOut);
    },
    [openMicPipeline, replaceOutboundAudioTrack]
  );

  const updateAudioSettings = useCallback(
    async (partial) => {
      const next = saveAudioPreferences({ ...audioSettingsRef.current, ...partial });
      audioSettingsRef.current = next;
      setAudioSettings(next);

      const live = localStreamRef.current?.getAudioTracks?.().some((t) => t.readyState === 'live');
      if (!live) return;

      if (partial.inputVolume != null && audioPipelineRef.current?.gain) {
        audioPipelineRef.current.gain.gain.value = next.inputVolume;
      }

      const processingTouched = ['echoCancellation', 'noiseSuppression', 'autoGainControl'].some(
        (k) => Object.prototype.hasOwnProperty.call(partial, k)
      );
      if (processingTouched && audioPipelineRef.current?.rawTrack) {
        try {
          await audioPipelineRef.current.rawTrack.applyConstraints(
            buildAudioConstraints(next, { forApplyConstraints: true })
          );
        } catch (err) {
          console.warn('applyConstraints áudio:', err);
        }
      }

      if (Object.prototype.hasOwnProperty.call(partial, 'inputDeviceId')) {
        try {
          await swapLocalMicrophone(next);
        } catch (err) {
          console.error('Troca de microfone:', err);
          setCallError(mediaErrorMessagePt(err));
        }
      }
    },
    [swapLocalMicrophone]
  );

  const cleanup = useCallback(() => {
    if (durationInterval.current) {
      clearInterval(durationInterval.current);
      durationInterval.current = null;
    }
    if (callNoticeTimeoutRef.current) {
      clearTimeout(callNoticeTimeoutRef.current);
      callNoticeTimeoutRef.current = null;
    }
    setCallNotice(null);
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    stopAudioPipeline();
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    closeAllGroupPeers();
    remoteStreamRef.current = null;
    pendingCandidates.current = [];
    setLocalStream(null);
    setRemoteStream(null);
    setCallDuration(0);
    setIsGroupCall(false);
    setGroupRoster([]);
    setSelectedScreenPeer(null);
  }, [closeAllGroupPeers, stopAudioPipeline]);

  const createPeerConnection = useCallback(
    async (targetAddress) => {
      const pc = await createRtcPeerConnection();
      pcRef.current = pc;

      const remoteInbound = new Map();
      const mergeRemoteMedia = () => {
        const tracks = [...remoteInbound.values()].filter((t) => t.readyState !== 'ended');
        if (tracks.length === 0) {
          remoteStreamRef.current = null;
          setRemoteStream(null);
          return;
        }
        // Nova instância sempre — garante que áudio+vídeo (ecrã) atualizam a UI.
        const ms = new MediaStream(tracks);
        remoteStreamRef.current = ms;
        setRemoteStream(ms);
      };

      pc.onicecandidate = (e) => {
        if (e.candidate && socketRef.current) {
          socketRef.current.emit('call_ice_candidate', {
            to: targetAddress,
            candidate: e.candidate.toJSON(),
          });
        }
      };

      pc.ontrack = (e) => {
        const t = e.track;
        if (!t) return;
        // Sempre mapear faixas: quando o ecrã chega no mesmo MediaStream do áudio,
        // a referência do stream não muda e o React não re-renderiza só com setRemoteStream(stream).
        remoteInbound.set(t.id, t);
        const onEnded = () => {
          remoteInbound.delete(t.id);
          mergeRemoteMedia();
        };
        t.addEventListener('ended', onEnded);
        mergeRemoteMedia();
      };

      pc.onconnectionstatechange = () => {
        try {
          socketRef.current?.emit('call_debug', {
            to: targetAddress,
            connectionState: pc.connectionState,
            iceConnectionState: pc.iceConnectionState,
            iceGatheringState: pc.iceGatheringState,
          });
        } catch {
          /* ignore */
        }
        if (pc.connectionState === 'connected') {
          pc._iceRestartAttempts = 0;
        }
        if (pc.connectionState === 'failed') {
          const attempts = Number(pc._iceRestartAttempts || 0);
          if (attempts < 2 && socketRef.current && targetAddress) {
            pc._iceRestartAttempts = attempts + 1;
            void (async () => {
              try {
                const offer = await pc.createOffer({ iceRestart: true });
                await pc.setLocalDescription(offer);
                socketRef.current?.emit('call_offer', {
                  to: targetAddress,
                  sdp: pc.localDescription.toJSON(),
                });
              } catch (err) {
                console.error('ICE restart falhou:', err);
                endCallRef.current();
              }
            })();
          } else {
            endCallRef.current();
          }
        }
      };
      pc.oniceconnectionstatechange = () => {
        try {
          socketRef.current?.emit('call_debug', {
            to: targetAddress,
            connectionState: pc.connectionState,
            iceConnectionState: pc.iceConnectionState,
            iceGatheringState: pc.iceGatheringState,
          });
        } catch {
          /* ignore */
        }
      };

      return pc;
    },
    [socketRef]
  );

  const attachGroupPeer = useCallback(
    async (targetLower, stream) => {
      if (groupPeersRef.current.has(targetLower)) return groupPeersRef.current.get(targetLower);
      const remoteInbound = new Map();
      const pendingIce = [];
      const peer = {
        pc: await createRtcPeerConnection(),
        pendingIce,
        remoteInbound,
        remoteStream: null,
      };
      const merge = () => {
        const tracks = [...remoteInbound.values()].filter((t) => t.readyState !== 'ended');
        peer.remoteStream = tracks.length ? new MediaStream(tracks) : null;
        rebuildGroupMedia();
      };
      peer.pc.onicecandidate = (e) => {
        if (e.candidate && socketRef.current) {
          socketRef.current.emit('call_ice_candidate', {
            to: targetLower,
            candidate: e.candidate.toJSON(),
          });
        }
      };
      peer.pc.ontrack = (e) => {
        const t = e.track;
        if (!t) return;
        remoteInbound.set(t.id, t);
        const onEnded = () => {
          remoteInbound.delete(t.id);
          merge();
        };
        t.addEventListener('ended', onEnded);
        merge();
      };
      peer.pc.onconnectionstatechange = () => {
        if (peer.pc.connectionState === 'connected') {
          peer.pc._iceRestartAttempts = 0;
        }
        if (peer.pc.connectionState === 'failed') {
          const attempts = Number(peer.pc._iceRestartAttempts || 0);
          if (attempts < 2 && socketRef.current) {
            peer.pc._iceRestartAttempts = attempts + 1;
            void (async () => {
              try {
                const offer = await peer.pc.createOffer({ iceRestart: true });
                await peer.pc.setLocalDescription(offer);
                socketRef.current?.emit('call_offer', {
                  to: targetLower,
                  sdp: peer.pc.localDescription.toJSON(),
                });
              } catch (err) {
                console.error('ICE restart grupo falhou:', err);
                removeGroupPeer(targetLower);
              }
            })();
          } else {
            removeGroupPeer(targetLower);
          }
        }
      };
      stream.getTracks().forEach((track) => peer.pc.addTrack(track, stream));
      if (callTypeRef.current === 'voice' || stream.getVideoTracks().length === 0) {
        ensureVideoTransceiver(peer.pc);
      }
      groupPeersRef.current.set(targetLower, peer);
      return peer;
    },
    [rebuildGroupMedia, removeGroupPeer, socketRef]
  );

  const flushPeerIce = async (peer) => {
    const queued = peer.pendingIce.splice(0);
    for (const c of queued) {
      if (!c || !peer.pc?.remoteDescription) continue;
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (err) {
        console.error('Erro ICE (grupo):', err);
      }
    }
  };

  const ensureGroupMesh = useCallback(
    async (members, stream) => {
      if (!stream || !myAddr) return;
      const set = new Set((members || []).map(normAddr).filter(Boolean));
      for (const addr of set) {
        if (addr === myAddr) continue;
        if (groupPeersRef.current.has(addr)) continue;
        if (myAddr < addr) {
          await attachGroupPeer(addr, stream);
          const peer = groupPeersRef.current.get(addr);
          try {
            const offer = await peer.pc.createOffer();
            await peer.pc.setLocalDescription(offer);
            socketRef.current?.emit('call_offer', {
              to: addr,
              sdp: peer.pc.localDescription.toJSON(),
            });
          } catch (err) {
            console.error('Oferta mesh grupo:', err);
          }
        }
      }
    },
    [attachGroupPeer, myAddr]
  );

  const clearCallError = useCallback(() => setCallError(null), []);

  const clearCallNotice = useCallback(() => {
    if (callNoticeTimeoutRef.current) {
      clearTimeout(callNoticeTimeoutRef.current);
      callNoticeTimeoutRef.current = null;
    }
    setCallNotice(null);
  }, []);

  /** Mostra um aviso temporário na UI da chamada; auto-limpa após ~4,5 s. */
  const showCallNotice = useCallback((notice) => {
    if (callNoticeTimeoutRef.current) {
      clearTimeout(callNoticeTimeoutRef.current);
    }
    setCallNotice(notice);
    callNoticeTimeoutRef.current = setTimeout(() => {
      setCallNotice(null);
      callNoticeTimeoutRef.current = null;
    }, 4500);
  }, []);

  const endCall = useCallback(() => {
    setCallError(null);
    const convId = callConversationIdRef.current;
    if (isGroupCallRef.current && convId) {
      socketRef.current?.emit('group_call_leave', { conversationId: convId });
      for (const addr of groupPeersRef.current.keys()) {
        socketRef.current?.emit('call_end', { to: addr });
      }
    } else if (remoteAddress) {
      socketRef.current?.emit('call_end', { to: remoteAddress });
    }
    cleanup();
    setCallState('idle');
    setCallType(null);
    setRemoteAddress(null);
    setCallConversationId(null);
  }, [remoteAddress, socketRef, cleanup]);

  endCallRef.current = endCall;

  const renegotiateAllGroupPeers = useCallback(async () => {
    if (!isGroupCallRef.current) return;
    const sock = socketRef.current;
    if (!sock) return;
    for (const [addr, peer] of groupPeersRef.current) {
      try {
        const offer = await peer.pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        await peer.pc.setLocalDescription(offer);
        sock.emit('call_offer', { to: addr, sdp: peer.pc.localDescription.toJSON() });
      } catch (err) {
        console.error('Renegociação grupo:', err);
      }
    }
  }, []);

  const stopVoiceScreenShare = useCallback(async () => {
    if (callTypeRef.current !== 'voice' || callStateRef.current !== 'connected') return;
    const stream = localStreamRef.current;
    if (!stream) return;
    const videoTracks = stream.getVideoTracks();
    if (videoTracks.length === 0) return;

    const noticeSock = socketRef.current;
    if (noticeSock) {
      if (isGroupCallRef.current) {
        const convId = callConversationIdRef.current;
        if (convId) noticeSock.emit('screen_share_stopped', { conversationId: convId });
      } else if (remoteAddressRef.current) {
        noticeSock.emit('screen_share_stopped', { to: remoteAddressRef.current });
      }
    }

    const clearVideoSender = async (pc) => {
      if (!pc) return;
      const tr = ensureVideoTransceiver(pc);
      try {
        await tr.sender.replaceTrack(null);
      } catch (err) {
        console.warn('replaceTrack(null) ecrã:', err);
      }
    };

    if (isGroupCallRef.current) {
      for (const [, peer] of groupPeersRef.current) {
        await clearVideoSender(peer.pc);
      }
    } else {
      await clearVideoSender(pcRef.current);
    }

    for (const t of videoTracks) {
      if (t.readyState === 'live') t.stop();
      try {
        stream.removeTrack(t);
      } catch {
        /* ignore */
      }
    }
    const newLocal = new MediaStream(stream.getTracks());
    localStreamRef.current = newLocal;
    setLocalStream(newLocal);
    // Sem renegociação SDP — o m-line de vídeo já existia desde o início da chamada.
  }, []);

  stopVoiceScreenShareRef.current = stopVoiceScreenShare;

  const startVoiceScreenShare = useCallback(async () => {
    if (callTypeRef.current !== 'voice' || callStateRef.current !== 'connected') return;
    const stream = localStreamRef.current;
    if (!stream || stream.getVideoTracks().length > 0) return;

    let screenTrack;
    try {
      screenTrack = await requestScreenCaptureVideoTrack();
    } catch (err) {
      console.error(err);
      setCallError(mediaErrorMessagePt(err));
      return;
    }

    try {
      await screenTrack.applyConstraints({
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 },
        frameRate: { ideal: 10, max: 15 },
      });
    } catch {
      /* ignore */
    }
    try {
      screenTrack.contentHint = 'detail';
    } catch {
      /* ignore */
    }

    const bindScreen = async (pc) => {
      if (!pc) throw new Error('no pc');
      const tr = ensureVideoTransceiver(pc);
      await tr.sender.replaceTrack(screenTrack);
    };

    try {
      if (isGroupCallRef.current) {
        for (const [, peer] of groupPeersRef.current) {
          await bindScreen(peer.pc);
        }
      } else {
        await bindScreen(pcRef.current);
      }
      stream.addTrack(screenTrack);
      setLocalStream(new MediaStream(stream.getTracks()));
      screenTrack.addEventListener('ended', () => {
        void stopVoiceScreenShareRef.current();
      });
    } catch (err) {
      console.error('replaceTrack ecrã:', err);
      screenTrack.stop();
      setCallError('Não foi possível enviar o compartilhamento de tela.');
    }
  }, []);

  const rejectCall = useCallback(() => {
    setCallError(null);
    socketRef.current?.emit('call_reject', { to: remoteAddress });
    cleanup();
    setCallState('idle');
    setCallType(null);
    setRemoteAddress(null);
    setCallConversationId(null);
  }, [remoteAddress, socketRef, cleanup]);

  const startCall = useCallback(
    async (targetAddress, type, conversationId) => {
      if (callState !== 'idle') return;
      setCallError(null);
      try {
        const stream = await acquireCallMedia(type);
        localStreamRef.current = stream;
        setLocalStream(stream);
        if (type === 'video') {
          void refreshVideoInputs();
        }
        setCallState('calling');
        setCallType(type);
        setIsGroupCall(false);
        setRemoteAddress(normAddr(targetAddress));
        setCallConversationId(conversationId);
        socketRef.current?.emit('call_initiate', {
          to: normAddr(targetAddress),
          type,
          conversationId,
        });
      } catch (err) {
        console.error(err);
        setCallError(mediaErrorMessagePt(err));
        cleanup();
      }
    },
    [callState, socketRef, cleanup, refreshVideoInputs, acquireCallMedia]
  );

  const startGroupCall = useCallback(
    async (type, conversationId) => {
      if (callState !== 'idle' || !conversationId) return;
      setCallError(null);
      try {
        const stream = await acquireCallMedia(type);
        localStreamRef.current = stream;
        setLocalStream(stream);
        if (type === 'video') {
          void refreshVideoInputs();
        }
        setCallState('calling');
        setCallType(type);
        setIsGroupCall(true);
        setRemoteAddress(null);
        setCallConversationId(conversationId);
        socketRef.current?.emit('call_initiate', {
          conversationId,
          type,
        });
      } catch (err) {
        console.error(err);
        setCallError(mediaErrorMessagePt(err));
        cleanup();
      }
    },
    [callState, socketRef, cleanup, refreshVideoInputs, acquireCallMedia]
  );

  const acceptCall = useCallback(async () => {
    if (callStateRef.current !== 'ringing') return;
    const addr = remoteAddress;
    const type = callTypeRef.current;
    const convId = callConversationId;
    const group = isGroupCallRef.current;
    try {
      const stream = await acquireCallMedia(type);
      localStreamRef.current = stream;
      setLocalStream(stream);
      if (type === 'video') {
        void refreshVideoInputs();
      }

      if (group) {
        await attachGroupPeer(normAddr(addr), stream);
        socketRef.current?.emit('call_accept', {
          to: normAddr(addr),
          conversationId: convId,
        });
      } else {
        const pc = await createPeerConnection(addr);
        attachLocalMedia(pc, stream, type);
        socketRef.current?.emit('call_accept', { to: normAddr(addr), conversationId: convId });
      }

      setCallState('connected');
      durationInterval.current = setInterval(() => {
        setCallDuration((d) => d + 1);
      }, 1000);
    } catch (err) {
      console.error('Erro ao aceitar chamada:', err);
      setCallError(mediaErrorMessagePt(err));
      socketRef.current?.emit('call_reject', { to: normAddr(addr) });
      cleanup();
      setCallState('idle');
      setCallType(null);
      setRemoteAddress(null);
      setCallConversationId(null);
    }
  }, [remoteAddress, createPeerConnection, socketRef, cleanup, refreshVideoInputs, attachGroupPeer, acquireCallMedia]);

  const switchCamera = useCallback(async () => {
    if (callTypeRef.current !== 'video' || !localStreamRef.current) return;
    const ids = videoInputIdsRef.current;
    if (ids.length < 2) return;

    const oldStream = localStreamRef.current;
    const oldVideo = oldStream.getVideoTracks()[0];
    if (!oldVideo) return;

    const currentId = oldVideo.getSettings?.()?.deviceId || '';
    let nextIdx = 0;
    if (currentId && ids.includes(currentId)) {
      nextIdx = (ids.indexOf(currentId) + 1) % ids.length;
    } else {
      nextIdx = 1 % ids.length;
    }
    const nextId = ids[nextIdx];

    let newVideoTrack;
    try {
      const cap = await requestMediaStream({
        video: { deviceId: { exact: nextId } },
        audio: false,
      });
      newVideoTrack = cap.getVideoTracks()[0];
      cap.getTracks().forEach((t) => {
        if (t !== newVideoTrack) t.stop();
      });
    } catch {
      try {
        const cap = await requestMediaStream({
          video: { deviceId: { ideal: nextId } },
          audio: false,
        });
        newVideoTrack = cap.getVideoTracks()[0];
        cap.getTracks().forEach((t) => {
          if (t !== newVideoTrack) t.stop();
        });
      } catch (err) {
        console.error('switchCamera:', err);
        setCallError(mediaErrorMessagePt(err));
        return;
      }
    }

    if (!newVideoTrack) return;

    const audios = [...oldStream.getAudioTracks()];
    oldStream.removeTrack(oldVideo);
    oldVideo.stop();

    const newMs = new MediaStream([...audios, newVideoTrack]);
    localStreamRef.current = newMs;
    setLocalStream(newMs);

    if (isGroupCallRef.current) {
      for (const [, peer] of groupPeersRef.current) {
        const sender = peer.pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) {
          try {
            await sender.replaceTrack(newVideoTrack);
          } catch (err) {
            console.error('replaceTrack grupo:', err);
          }
        }
      }
      await renegotiateAllGroupPeers();
    } else {
      const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) {
        try {
          await sender.replaceTrack(newVideoTrack);
        } catch (err) {
          console.error('replaceTrack:', err);
        }
      }
    }
  }, [renegotiateAllGroupPeers]);

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        return audioTrack.enabled;
      }
    }
    return true;
  }, []);

  const toggleVideo = useCallback(() => {
    if (callTypeRef.current !== 'video') return true;
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        return videoTrack.enabled;
      }
    }
    return true;
  }, []);

  useEffect(() => {
    void getIceServers();
  }, []);

  useEffect(() => {
    if (!socket) return;

    const onIncomingCall = ({ from, type, conversationId, isGroup: incomingGroup }) => {
      const conv = conversationId ? String(conversationId) : '';
      if (
        incomingGroup &&
        conv &&
        callConversationIdRef.current === conv &&
        (callStateRef.current === 'connected' ||
          callStateRef.current === 'calling' ||
          callStateRef.current === 'ringing')
      ) {
        /* Novo membro ou quem saiu a voltar: o servidor envia «incoming_call» mas a malha vem do roster. */
        return;
      }
      if (callStateRef.current !== 'idle') {
        socket.emit('call_reject', { to: normAddr(from) });
        return;
      }
      setCallState('ringing');
      setCallType(type);
      setRemoteAddress(normAddr(from));
      setCallConversationId(conversationId);
      setIsGroupCall(Boolean(incomingGroup));
      notifyIncomingCallGeneric(type);
    };

    const flushPendingIce = async (pc) => {
      const queued = pendingCandidates.current.splice(0);
      for (const c of queued) {
        if (!c || !pc?.remoteDescription) continue;
        try {
          await pc.addIceCandidate(new RTCIceCandidate(c));
        } catch (err) {
          console.error('Erro ICE (flush):', err);
        }
      }
    };

    const onCallAccepted = async ({ from }) => {
      if (callStateRef.current !== 'calling') return;
      const type = callTypeRef.current;
      const group = isGroupCallRef.current;
      try {
        let stream = localStreamRef.current;
        const hasLive = stream && stream.getTracks().some((t) => t.readyState === 'live');
        if (!hasLive) {
          stream = await acquireCallMedia(type);
          localStreamRef.current = stream;
          setLocalStream(stream);
        }
        if (type === 'video') {
          void refreshVideoInputs();
        }

        const fromL = normAddr(from);
        if (group) {
          /* Malha: ofertas criadas em «group_call_roster» / ensureGroupMesh (evita colisão A/B quem oferta). */
        } else {
          const pc = await createPeerConnection(fromL);
          attachLocalMedia(pc, stream, type);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('call_offer', {
            to: fromL,
            sdp: pc.localDescription.toJSON(),
          });
        }

        setCallState('connected');
        durationInterval.current = setInterval(() => {
          setCallDuration((d) => d + 1);
        }, 1000);
      } catch (err) {
        console.error('Erro ao configurar chamada:', err);
        setCallError(mediaErrorMessagePt(err));
        endCallRef.current();
      }
    };

    const onGroupCallRoster = ({ conversationId, members }) => {
      if (!isGroupCallRef.current || callConversationIdRef.current !== conversationId) return;
      const list = Array.isArray(members) ? members.map(normAddr) : [];
      setGroupRoster(list);

      if (list.length === 0) {
        setCallError(null);
        cleanup();
        setCallState('idle');
        setCallType(null);
        setRemoteAddress(null);
        setCallConversationId(null);
        return;
      }

      const rosterSet = new Set(list);
      for (const addr of [...groupPeersRef.current.keys()]) {
        if (!rosterSet.has(addr)) removeGroupPeer(addr);
      }

      const stream = localStreamRef.current;
      if (
        stream &&
        (callStateRef.current === 'connected' || callStateRef.current === 'calling')
      ) {
        void ensureGroupMesh(list, stream);
      }

      const others = list.filter((a) => a && myAddr && a !== myAddr);
      if (others.length > 0 && callStateRef.current === 'calling') {
        setCallState('connected');
        if (!durationInterval.current) {
          durationInterval.current = setInterval(() => {
            setCallDuration((d) => d + 1);
          }, 1000);
        }
      }
    };

    const onGroupCallPeerLeft = ({ conversationId, address }) => {
      if (!isGroupCallRef.current || callConversationIdRef.current !== conversationId) return;
      removeGroupPeer(address);
    };

    const onCallOffer = async ({ from, sdp }) => {
      const fromL = normAddr(from);
      if (isGroupCallRef.current) {
        let stream;
        try {
          stream = await waitFor(() => localStreamRef.current, 12000);
        } catch {
          console.error('Oferta grupo sem stream local');
          return;
        }
        let peer = groupPeersRef.current.get(fromL);
        if (!peer) {
          await attachGroupPeer(fromL, stream);
          peer = groupPeersRef.current.get(fromL);
        }
        try {
          await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
          await flushPeerIce(peer);
          const answer = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(answer);
          socket.emit('call_answer', {
            to: fromL,
            sdp: peer.pc.localDescription.toJSON(),
          });
        } catch (err) {
          console.error('Erro ao processar oferta (grupo):', err);
        }
        return;
      }

      // Corrida: o chamador envia a oferta assim que recebe call_accepted, enquanto o
      // destinatário ainda pode estar em getUserMedia / createPeerConnection.
      let pc;
      try {
        pc = await waitFor(() => pcRef.current, 12000);
      } catch {
        console.error('Oferta WebRTC ignorada: PC local ainda não existia');
        return;
      }
      try {
        // Perfect negotiation (glare): se já temos oferta local (ex.: os dois renegociam
        // ao partilhar ecrã), o peer "polite" faz rollback; o outro ignora a oferta remota.
        if (pc.signalingState === 'have-local-offer') {
          const polite = myAddr > fromL;
          if (polite && typeof pc.setLocalDescription === 'function') {
            try {
              await pc.setLocalDescription({ type: 'rollback' });
            } catch (rollErr) {
              console.warn('Rollback oferta local:', rollErr);
              return;
            }
          } else {
            console.warn('Oferta remota ignorada (glare, impolite)');
            return;
          }
        }
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        await flushPendingIce(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('call_answer', {
          to: fromL,
          sdp: pc.localDescription.toJSON(),
        });
      } catch (err) {
        console.error('Erro ao processar oferta:', err);
      }
    };

    const onCallAnswer = async ({ from, sdp }) => {
      const fromL = normAddr(from);
      if (isGroupCallRef.current) {
        const peer = groupPeersRef.current.get(fromL);
        if (!peer) return;
        try {
          await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
          await flushPeerIce(peer);
        } catch (err) {
          console.error('Erro ao processar resposta (grupo):', err);
        }
        return;
      }
      const pc = pcRef.current;
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        await flushPendingIce(pc);
      } catch (err) {
        console.error('Erro ao processar resposta:', err);
      }
    };

    const onIceCandidate = async ({ from, candidate }) => {
      if (!candidate) return;
      const fromL = normAddr(from);
      if (isGroupCallRef.current) {
        const peer = groupPeersRef.current.get(fromL);
        if (!peer) return;
        if (!peer.pc.remoteDescription) {
          peer.pendingIce.push(candidate);
          return;
        }
        try {
          await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.error('Erro ICE (grupo):', err);
        }
        return;
      }
      const pc = pcRef.current;
      if (!pc || !pc.remoteDescription) {
        pendingCandidates.current.push(candidate);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('Erro ao adicionar ICE candidate:', err);
      }
    };

    const onCallRejected = () => {
      setCallError('Chamada recusada.');
      cleanup();
      setCallState('idle');
      setCallType(null);
      setRemoteAddress(null);
      setCallConversationId(null);
    };

    const onCallEnded = ({ from }) => {
      const fromL = normAddr(from);
      if (isGroupCallRef.current) {
        /* Só fecha a chamada local com «endCall» ou roster vazio; pode ficar só na sala até outros voltarem. */
        removeGroupPeer(fromL);
        return;
      }
      setCallError(null);
      cleanup();
      setCallState('idle');
      setCallType(null);
      setRemoteAddress(null);
      setCallConversationId(null);
    };

    const onCallUnavailable = () => {
      setCallError('O contato está offline ou indisponível.');
      cleanup();
      setCallState('idle');
      setCallType(null);
      setRemoteAddress(null);
      setCallConversationId(null);
    };

    const onScreenShareStopped = ({ from, conversationId } = {}) => {
      if (callStateRef.current !== 'connected') return;
      const fromL = normAddr(from);
      if (!fromL) return;
      if (isGroupCallRef.current) {
        const conv = conversationId ? String(conversationId) : '';
        if (!conv || callConversationIdRef.current !== conv) return;
      } else if (remoteAddressRef.current && fromL !== remoteAddressRef.current) {
        return;
      }
      showCallNotice({
        kind: 'screen_share_stopped',
        from: fromL,
        ts: Date.now(),
      });
    };

    socket.on('incoming_call', onIncomingCall);
    socket.on('call_accepted', onCallAccepted);
    socket.on('group_call_roster', onGroupCallRoster);
    socket.on('group_call_peer_left', onGroupCallPeerLeft);
    socket.on('call_offer', onCallOffer);
    socket.on('call_answer', onCallAnswer);
    socket.on('call_ice_candidate', onIceCandidate);
    socket.on('call_rejected', onCallRejected);
    socket.on('call_ended', onCallEnded);
    socket.on('call_unavailable', onCallUnavailable);
    socket.on('screen_share_stopped', onScreenShareStopped);

    return () => {
      socket.off('incoming_call', onIncomingCall);
      socket.off('call_accepted', onCallAccepted);
      socket.off('group_call_roster', onGroupCallRoster);
      socket.off('group_call_peer_left', onGroupCallPeerLeft);
      socket.off('call_offer', onCallOffer);
      socket.off('call_answer', onCallAnswer);
      socket.off('call_ice_candidate', onIceCandidate);
      socket.off('call_rejected', onCallRejected);
      socket.off('call_ended', onCallEnded);
      socket.off('call_unavailable', onCallUnavailable);
      socket.off('screen_share_stopped', onScreenShareStopped);
    };
  }, [
    socket,
    myAddr,
    createPeerConnection,
    cleanup,
    refreshVideoInputs,
    attachGroupPeer,
    ensureGroupMesh,
    removeGroupPeer,
    showCallNotice,
    acquireCallMedia,
  ]);

  useEffect(() => {
    selectedScreenPeerRef.current = selectedScreenPeer;
    if (isGroupCall) rebuildGroupMedia();
  }, [selectedScreenPeer, isGroupCall, rebuildGroupMedia]);

  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return undefined;
    const onDeviceChange = () => {
      if (callTypeRef.current === 'video' && localStreamRef.current?.getVideoTracks().length) {
        void refreshVideoInputs();
      }
    };
    md.addEventListener('devicechange', onDeviceChange);
    return () => md.removeEventListener('devicechange', onDeviceChange);
  }, [refreshVideoInputs]);

  return (
    <CallContext.Provider
      value={{
        callState,
        callType,
        remoteAddress,
        callConversationId,
        isGroupCall,
        groupRoster,
        selectedScreenPeer,
        setSelectedScreenPeer,
        remoteDisplayVideoStream,
        localStream,
        remoteStream,
        callDuration,
        callError,
        callNotice,
        videoInputCount,
        refreshVideoInputs,
        audioSettings,
        updateAudioSettings,
        clearCallError,
        clearCallNotice,
        startCall,
        startGroupCall,
        acceptCall,
        rejectCall,
        endCall,
        toggleMute,
        toggleVideo,
        switchCamera,
        startVoiceScreenShare,
        stopVoiceScreenShare,
        localUserAddress: myAddr || '',
      }}
    >
      {children}
    </CallContext.Provider>
  );
}

export function useCall() {
  const context = useContext(CallContext);
  if (!context) {
    throw new Error('useCall deve ser usado dentro de um CallProvider');
  }
  return context;
}
