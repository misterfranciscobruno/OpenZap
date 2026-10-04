/**
 * Simula a corrida MetaWhats: oferta chega antes do PC do destinatário.
 * Sem wait → oferta perdida. Com wait → answer + tracks OK.
 */
import { chromium } from 'playwright-core';
import { existsSync } from 'fs';

const edge =
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const executablePath = existsSync(edge) ? edge : chrome;

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--ignore-certificate-errors',
  ],
});

const context = await browser.newContext({ ignoreHTTPSErrors: true });
await context.grantPermissions(['microphone', 'camera'], {
  origin: 'https://localhost:5174',
});
const page = await context.newPage();
await page.goto('https://localhost:5174/', { waitUntil: 'domcontentloaded', timeout: 20000 });

const data = await page.evaluate(async () => {
  const ICE = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

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

  async function runScenario(useWait) {
    const streamA = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    // B atrasa getUserMedia (como acceptCall lento)
    let streamB = null;
    let pcB = null;
    const pcBRef = { current: null };

    const pcA = new RTCPeerConnection({ iceServers: ICE });
    const remoteOnB = [];

    pcA.onicecandidate = (e) => {
      if (!e.candidate) return;
      const apply = async () => {
        const pc = useWait ? await waitFor(() => pcBRef.current, 8000) : pcBRef.current;
        if (!pc) return { dropped: true };
        if (!pc.remoteDescription) {
          // fila simples
          pc._pending = pc._pending || [];
          pc._pending.push(e.candidate);
          return { queued: true };
        }
        await pc.addIceCandidate(e.candidate);
        return { ok: true };
      };
      void apply();
    };

    // Chamador (A) já tem stream; ao "accept" envia oferta imediatamente
    streamA.getTracks().forEach((t) => pcA.addTrack(t, streamA));

    // Oferta criada ANTES de B ter PC (corrida)
    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);

    const offerHandling = (async () => {
      let pc;
      if (useWait) {
        pc = await waitFor(() => pcBRef.current, 8000);
      } else {
        pc = pcBRef.current;
        if (!pc) return { offerDropped: true, remoteLive: 0 };
      }
      pc.ontrack = (e) => {
        if (e.streams?.[0]) remoteOnB.push(...e.streams[0].getAudioTracks());
        else if (e.track) remoteOnB.push(e.track);
      };
      pc.onicecandidate = (e) => {
        if (e.candidate) pcA.addIceCandidate(e.candidate).catch(() => {});
      };
      await pc.setRemoteDescription(offer);
      if (pc._pending) {
        for (const c of pc._pending) await pc.addIceCandidate(c).catch(() => {});
        pc._pending = [];
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await pcA.setRemoteDescription(answer);
      return { offerDropped: false };
    })();

    // B só cria PC 400ms depois (simula getUserMedia)
    await new Promise((r) => setTimeout(r, 400));
    streamB = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    pcB = new RTCPeerConnection({ iceServers: ICE });
    streamB.getTracks().forEach((t) => pcB.addTrack(t, streamB));
    pcBRef.current = pcB;

    const handle = await offerHandling;

    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (
        (pcA.iceConnectionState === 'connected' || pcA.iceConnectionState === 'completed') &&
        remoteOnB.some((t) => t.readyState === 'live')
      ) {
        break;
      }
      await new Promise((r) => setTimeout(r, 150));
    }

    const result = {
      useWait,
      offerDropped: Boolean(handle.offerDropped),
      iceA: pcA.iceConnectionState,
      iceB: pcB.iceConnectionState,
      remoteLiveOnB: remoteOnB.filter((t) => t.readyState === 'live').length,
    };

    pcA.close();
    pcB.close();
    streamA.getTracks().forEach((t) => t.stop());
    streamB.getTracks().forEach((t) => t.stop());
    return result;
  }

  const withoutWait = await runScenario(false);
  const withWait = await runScenario(true);
  return { withoutWait, withWait };
});

console.log(JSON.stringify(data, null, 2));
await browser.close();

const broken = data.withoutWait.offerDropped || data.withoutWait.remoteLiveOnB < 1;
const fixed =
  !data.withWait.offerDropped &&
  data.withWait.remoteLiveOnB >= 1 &&
  (data.withWait.iceA === 'connected' ||
    data.withWait.iceA === 'completed' ||
    data.withWait.iceB === 'connected' ||
    data.withWait.iceB === 'completed');

if (!broken) {
  console.log('NOTE: neste ambiente a corrida sem wait não reproduziu drop (timing)');
}
if (!fixed) {
  console.error('FAIL: waitFor não restabeleceu áudio remoto');
  process.exit(1);
}
console.log('PASS: waitFor na oferta repara a corrida accept/offer');
process.exit(0);
