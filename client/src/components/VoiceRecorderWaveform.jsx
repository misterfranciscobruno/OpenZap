import { useEffect, useRef } from 'react';

export default function VoiceRecorderWaveform({ stream, barColor = '#34d399' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!stream) return undefined;
    const AC = window.AudioContext || window.webkitAudioContext;
    let audioCtx;
    let rafId;
    try {
      audioCtx = new AC();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.65;
      source.connect(analyser);
      const canvas = canvasRef.current;
      if (!canvas) {
        source.disconnect();
        audioCtx.close();
        return undefined;
      }
      const ctx = canvas.getContext('2d');
      const data = new Uint8Array(analyser.frequencyBinCount);
      const barCount = 40;
      const draw = () => {
        rafId = requestAnimationFrame(draw);
        analyser.getByteFrequencyData(data);
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        const step = Math.max(1, Math.floor(data.length / barCount));
        const barW = w / barCount - 1;
        for (let i = 0; i < barCount; i++) {
          let sum = 0;
          for (let j = 0; j < step; j++) sum += data[i * step + j];
          const v = sum / step / 255;
          const bh = Math.max(3, v * h * 0.92);
          const x = i * (barW + 1);
          ctx.fillStyle = barColor;
          ctx.fillRect(x, h - bh, barW, bh);
        }
      };
      draw();
      return () => {
        if (rafId) cancelAnimationFrame(rafId);
        try {
          source.disconnect();
          analyser.disconnect();
        } catch {
          /* ignore */
        }
        audioCtx.close().catch(() => {});
      };
    } catch {
      if (audioCtx) audioCtx.close().catch(() => {});
      return undefined;
    }
  }, [stream, barColor]);

  return (
    <canvas
      ref={canvasRef}
      width={240}
      height={36}
      className="rounded-md opacity-95 max-w-[min(240px,45vw)]"
      aria-hidden
    />
  );
}
