import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Cropper from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';
import {
  IoClose,
  IoRefresh,
  IoArrowUndo,
  IoArrowRedo,
  IoCrop,
  IoCheckmark,
  IoImage,
} from 'react-icons/io5';
import {
  fileToCanvas,
  dataUrlToCanvas,
  canvasToJpegDataUrl,
  rotateCanvas90CW,
  flipCanvasHorizontal,
  flipCanvasVertical,
  blurCanvas,
  getCroppedCanvas,
  dataUrlToJpegFile,
} from '../utils/imageEditCanvas';

export default function ImageSendModal({ open, file, onClose, onSend }) {
  const [present, setPresent] = useState('');
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [originalUrl, setOriginalUrl] = useState('');
  const [cropMode, setCropMode] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const croppedPixelsRef = useRef(null);
  const [blurRadius, setBlurRadius] = useState(8);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(false);
  const presentRef = useRef('');

  useEffect(() => {
    presentRef.current = present;
  }, [present]);

  const commit = useCallback((dataUrl) => {
    const prevUrl = presentRef.current;
    presentRef.current = dataUrl;
    setPast((p) => [...p, prevUrl]);
    setPresent(dataUrl);
    setFuture([]);
  }, []);

  const undo = useCallback(() => {
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    setFuture((f) => [present, ...f]);
    setPresent(prev);
    setPast((p) => p.slice(0, -1));
  }, [past, present]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    setPast((p) => [...p, present]);
    setPresent(next);
    setFuture((f) => f.slice(1));
  }, [future, present]);

  const resetOriginal = useCallback(() => {
    if (!originalUrl) return;
    setPast([]);
    setPresent(originalUrl);
    setFuture([]);
    setCropMode(false);
  }, [originalUrl]);

  useEffect(() => {
    if (!open || !file) return undefined;
    let cancelled = false;
    setLoadError(null);
    setCropMode(false);
    setPast([]);
    setFuture([]);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    (async () => {
      try {
        const canvas = await fileToCanvas(file);
        if (cancelled) return;
        const url = canvasToJpegDataUrl(canvas);
        setOriginalUrl(url);
        setPresent(url);
      } catch (e) {
        if (!cancelled) setLoadError(e?.message || 'Erro ao abrir imagem');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, file]);

  const onCropComplete = useCallback((_, areaPixels) => {
    croppedPixelsRef.current = areaPixels;
  }, []);

  const applyCrop = useCallback(async () => {
    const px = croppedPixelsRef.current;
    const url = presentRef.current;
    if (!px || !url) return;
    setBusy(true);
    try {
      const c = await getCroppedCanvas(url, px);
      commit(canvasToJpegDataUrl(c));
      setCropMode(false);
      setZoom(1);
    } catch {
      setLoadError('Falha ao aplicar corte');
    } finally {
      setBusy(false);
    }
  }, [commit]);

  const applyRotate = useCallback(async () => {
    const url = presentRef.current;
    if (!url) return;
    setBusy(true);
    try {
      const src = await dataUrlToCanvas(url);
      const out = rotateCanvas90CW(src);
      commit(canvasToJpegDataUrl(out));
    } finally {
      setBusy(false);
    }
  }, [commit]);

  const applyFlipH = useCallback(async () => {
    const url = presentRef.current;
    if (!url) return;
    setBusy(true);
    try {
      const src = await dataUrlToCanvas(url);
      commit(canvasToJpegDataUrl(flipCanvasHorizontal(src)));
    } finally {
      setBusy(false);
    }
  }, [commit]);

  const applyFlipV = useCallback(async () => {
    const url = presentRef.current;
    if (!url) return;
    setBusy(true);
    try {
      const src = await dataUrlToCanvas(url);
      commit(canvasToJpegDataUrl(flipCanvasVertical(src)));
    } finally {
      setBusy(false);
    }
  }, [commit]);

  const applyBlur = useCallback(async () => {
    const url = presentRef.current;
    if (!url) return;
    setBusy(true);
    try {
      const src = await dataUrlToCanvas(url);
      const out = blurCanvas(src, blurRadius);
      commit(canvasToJpegDataUrl(out));
    } finally {
      setBusy(false);
    }
  }, [blurRadius, commit]);

  const handleSend = useCallback(async () => {
    const url = presentRef.current;
    if (!url || !file) return;
    setBusy(true);
    try {
      const outFile = await dataUrlToJpegFile(url, file.name || 'foto.jpg');
      onSend?.(outFile);
      onClose?.();
    } catch (e) {
      setLoadError(e?.message || 'Falha ao preparar envio');
    } finally {
      setBusy(false);
    }
  }, [file, onSend, onClose]);

  if (!open || !file) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[500] flex flex-col bg-black/95 text-whatsapp-text"
      role="dialog"
      aria-modal="true"
      aria-label="Editar imagem antes de enviar"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-2 sm:px-4">
        <div className="flex items-center gap-2 min-w-0">
          <IoImage className="h-6 w-6 shrink-0 text-whatsapp-green" />
          <span className="truncate text-sm font-medium">Pré-visualização e edição</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-2 text-whatsapp-text-secondary hover:bg-white/10"
          aria-label="Cancelar envio"
        >
          <IoClose className="h-6 w-6" />
        </button>
      </header>

      {loadError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <p className="text-center text-red-300">{loadError}</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-whatsapp-input px-4 py-2 text-sm"
          >
            Fechar
          </button>
        </div>
      ) : (
        <>
          <div className="shrink-0 border-b border-white/10 px-2 py-2 sm:px-3">
            <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-1.5 sm:gap-2">
              <button
                type="button"
                disabled={busy || cropMode}
                onClick={applyRotate}
                className="rounded-lg bg-whatsapp-input px-2.5 py-1.5 text-xs sm:text-sm hover:bg-whatsapp-hover disabled:opacity-40"
              >
                Girar 90°
              </button>
              <button
                type="button"
                disabled={busy || cropMode}
                onClick={applyFlipH}
                className="rounded-lg bg-whatsapp-input px-2.5 py-1.5 text-xs sm:text-sm hover:bg-whatsapp-hover disabled:opacity-40"
              >
                Inverter H
              </button>
              <button
                type="button"
                disabled={busy || cropMode}
                onClick={applyFlipV}
                className="rounded-lg bg-whatsapp-input px-2.5 py-1.5 text-xs sm:text-sm hover:bg-whatsapp-hover disabled:opacity-40"
              >
                Inverter V
              </button>
              {!cropMode ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setCropMode(true);
                    setZoom(1);
                    setCrop({ x: 0, y: 0 });
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-whatsapp-input px-2.5 py-1.5 text-xs sm:text-sm hover:bg-whatsapp-hover disabled:opacity-40"
                >
                  <IoCrop className="h-4 w-4" />
                  Cortar
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={applyCrop}
                    className="inline-flex items-center gap-1 rounded-lg bg-whatsapp-green px-2.5 py-1.5 text-xs font-medium text-whatsapp-on-primary sm:text-sm disabled:opacity-40"
                  >
                    <IoCheckmark className="h-4 w-4" />
                    Aplicar corte
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setCropMode(false)}
                    className="rounded-lg bg-whatsapp-input px-2.5 py-1.5 text-xs sm:text-sm hover:bg-whatsapp-hover"
                  >
                    Cancelar corte
                  </button>
                </>
              )}
              <span className="hidden h-6 w-px bg-white/20 sm:inline" aria-hidden />
              <div className="flex items-center gap-2 rounded-lg bg-whatsapp-input/80 px-2 py-1">
                <label className="text-[11px] text-whatsapp-text-secondary whitespace-nowrap">
                  Desfoque
                </label>
                <input
                  type="range"
                  min={0}
                  max={25}
                  value={blurRadius}
                  onChange={(e) => setBlurRadius(Number(e.target.value))}
                  disabled={busy || cropMode}
                  className="w-20 sm:w-28 accent-whatsapp-green"
                />
                <button
                  type="button"
                  disabled={busy || cropMode || blurRadius === 0}
                  onClick={applyBlur}
                  className="rounded bg-white/10 px-2 py-0.5 text-[11px] hover:bg-white/20 disabled:opacity-40"
                >
                  Aplicar
                </button>
              </div>
              <span className="hidden h-6 w-px bg-white/20 sm:inline" aria-hidden />
              <button
                type="button"
                disabled={busy || past.length === 0}
                onClick={undo}
                title="Reverter alteração"
                className="rounded-lg bg-whatsapp-input p-2 hover:bg-whatsapp-hover disabled:opacity-40"
                aria-label="Desfazer"
              >
                <IoArrowUndo className="h-5 w-5" />
              </button>
              <button
                type="button"
                disabled={busy || future.length === 0}
                onClick={redo}
                title="Avançar alteração"
                className="rounded-lg bg-whatsapp-input p-2 hover:bg-whatsapp-hover disabled:opacity-40"
                aria-label="Refazer"
              >
                <IoArrowRedo className="h-5 w-5" />
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={resetOriginal}
                title="Repor imagem original"
                className="inline-flex items-center gap-1 rounded-lg bg-whatsapp-input px-2.5 py-1.5 text-xs sm:text-sm hover:bg-whatsapp-hover disabled:opacity-40"
              >
                <IoRefresh className="h-4 w-4" />
                Repor original
              </button>
            </div>
          </div>

          <div className="relative min-h-0 flex-1 overflow-hidden">
            {present && cropMode ? (
              <div className="absolute inset-0 min-h-[min(50vh,360px)]">
                <Cropper
                  image={present}
                  crop={crop}
                  zoom={zoom}
                  aspect={undefined}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={onCropComplete}
                  showGrid
                  objectFit="contain"
                />
              </div>
            ) : present ? (
              <div className="flex h-full items-center justify-center overflow-auto p-4">
                <img
                  src={present}
                  alt="Pré-visualização"
                  className="max-h-full max-w-full object-contain shadow-lg"
                />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-whatsapp-text-secondary">
                Carregando…
              </div>
            )}
          </div>

          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-white/10 px-4 py-3">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-lg px-4 py-2.5 text-sm text-whatsapp-text-secondary hover:bg-white/10"
            >
              Cancelar envio
            </button>
            <button
              type="button"
              onClick={resetOriginal}
              disabled={busy || !originalUrl || present === originalUrl}
              className="rounded-lg px-4 py-2.5 text-sm hover:bg-white/10 disabled:opacity-40"
            >
              Cancelar edição
            </button>
            <button
              type="button"
              disabled={busy || !present}
              onClick={handleSend}
              className="rounded-lg bg-whatsapp-green px-5 py-2.5 text-sm font-semibold text-whatsapp-on-primary hover:bg-whatsapp-green-hover disabled:opacity-40"
            >
              Enviar imagem
            </button>
          </footer>
        </>
      )}
    </div>,
    document.body
  );
}
