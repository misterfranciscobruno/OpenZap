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

  const aSr = document.createElement('audio');
  aSr.autoplay = true;
  aSr.setAttribute('playsinline', '');
  aSr.style.cssText =
    'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0';
  document.body.appendChild(aSr);

  const aOk = document.createElement('audio');
  aOk.autoplay = true;
  aOk.setAttribute('playsinline', '');
  aOk.style.cssText = 'position:fixed;left:-9999px;width:2px;height:2px;opacity:0';
  document.body.appendChild(aOk);

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      return { ok: false, error: 'no getUserMedia', secure: window.isSecureContext };
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const pc1 = new RTCPeerConnection({ iceServers: ICE });
    const pc2 = new RTCPeerConnection({ iceServers: ICE });
    const remoteTracks = [];
    pc1.onicecandidate = (e) => {
      if (e.candidate) pc2.addIceCandidate(e.candidate).catch(() => {});
    };
    pc2.onicecandidate = (e) => {
      if (e.candidate) pc1.addIceCandidate(e.candidate).catch(() => {});
    };
    pc2.ontrack = (e) => {
      remoteTracks.push(e.track);
      aSr.srcObject = new MediaStream([e.track]);
      aOk.srcObject = new MediaStream([e.track]);
      aSr.play().catch(() => {});
      aOk.play().catch(() => {});
    };
    stream.getTracks().forEach((t) => pc1.addTrack(t, stream));
    const offer = await pc1.createOffer();
    await pc1.setLocalDescription(offer);
    await pc2.setRemoteDescription(offer);
    const answer = await pc2.createAnswer();
    await pc2.setLocalDescription(answer);
    await pc1.setRemoteDescription(answer);

    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const ok =
        pc1.iceConnectionState === 'connected' ||
        pc1.iceConnectionState === 'completed' ||
        pc2.iceConnectionState === 'connected' ||
        pc2.iceConnectionState === 'completed' ||
        pc1.connectionState === 'connected' ||
        pc2.connectionState === 'connected';
      if (ok && remoteTracks.length) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    await new Promise((r) => setTimeout(r, 1000));

    return {
      ok: true,
      secure: window.isSecureContext,
      ice1: pc1.iceConnectionState,
      ice2: pc2.iceConnectionState,
      conn1: pc1.connectionState,
      conn2: pc2.connectionState,
      remoteTrackCount: remoteTracks.length,
      remoteLive: remoteTracks.filter((t) => t.readyState === 'live').length,
      audioSrPaused: aSr.paused,
      audioOkPaused: aOk.paused,
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), secure: window.isSecureContext };
  }
});

console.log(JSON.stringify(data, null, 2));
await browser.close();

const connected =
  data.ice1 === 'connected' ||
  data.ice1 === 'completed' ||
  data.conn1 === 'connected' ||
  data.ice2 === 'connected' ||
  data.ice2 === 'completed' ||
  data.conn2 === 'connected';

if (!data.ok || !connected || data.remoteLive < 1) {
  console.error('FAIL: WebRTC');
  process.exit(1);
}
if (data.audioOkPaused && data.audioSrPaused) {
  console.error('FAIL: ambos audio pausados');
  process.exit(1);
}
console.log('PASS: ligação + faixa remota OK');
if (data.audioSrPaused && !data.audioOkPaused) {
  console.log('NOTE: sr-only (clip) QUEBRA play; offscreen sem clip OK — corrigir CallModal');
} else if (!data.audioSrPaused && !data.audioOkPaused) {
  console.log('NOTE: ambos audio a tocar neste browser');
}
process.exit(0);
