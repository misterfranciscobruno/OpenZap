/** Carrega ficheiro para canvas (limita aresta máxima). */
export function fileToCanvas(file, maxEdge = 2048) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { naturalWidth: w, naturalHeight: h } = img;
      if (!w || !h) {
        reject(new Error('Imagem inválida'));
        return;
      }
      const r = Math.min(1, maxEdge / w, maxEdge / h);
      w = Math.round(w * r);
      h = Math.round(h * r);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Falha ao carregar imagem'));
    };
    img.src = url;
  });
}

export function dataUrlToCanvas(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      resolve(c);
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

export function canvasToJpegDataUrl(canvas, quality = 0.92) {
  return canvas.toDataURL('image/jpeg', quality);
}

export function rotateCanvas90CW(source) {
  const w = source.width;
  const h = source.height;
  const c = document.createElement('canvas');
  c.width = h;
  c.height = w;
  const ctx = c.getContext('2d');
  ctx.translate(h, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(source, 0, 0);
  return c;
}

export function flipCanvasHorizontal(source) {
  const c = document.createElement('canvas');
  c.width = source.width;
  c.height = source.height;
  const ctx = c.getContext('2d');
  ctx.translate(source.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(source, 0, 0);
  return c;
}

export function flipCanvasVertical(source) {
  const c = document.createElement('canvas');
  c.width = source.width;
  c.height = source.height;
  const ctx = c.getContext('2d');
  ctx.translate(0, source.height);
  ctx.scale(1, -1);
  ctx.drawImage(source, 0, 0);
  return c;
}

export function blurCanvas(source, radiusPx) {
  const c = document.createElement('canvas');
  c.width = source.width;
  c.height = source.height;
  const ctx = c.getContext('2d');
  const r = Math.max(0, Math.min(40, Number(radiusPx) || 0));
  ctx.filter = r > 0 ? `blur(${r}px)` : 'none';
  ctx.drawImage(source, 0, 0);
  ctx.filter = 'none';
  return c;
}

/** pixelCrop do react-easy-crop: x, y, width, height em pixels da imagem natural. */
export async function getCroppedCanvas(imageDataUrl, pixelCrop) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = imageDataUrl;
  });
  const { x, y, width, height } = pixelCrop;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  const ctx = c.getContext('2d');
  ctx.drawImage(img, x, y, width, height, 0, 0, c.width, c.height);
  return c;
}

/** data:image/jpeg;base64,... → File (sem fetch; CSP bloqueia connect-src data:). */
export async function dataUrlToJpegFile(dataUrl, filename = 'image.jpg') {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) throw new Error('Data URL inválido');
  const base64 = dataUrl.slice(comma + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new File([bytes], filename.replace(/\.[^.]+$/, '') + '.jpg', {
    type: 'image/jpeg',
  });
}
