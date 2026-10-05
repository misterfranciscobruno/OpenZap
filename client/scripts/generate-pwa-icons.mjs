/**
 * Gera ícones PNG a partir de public/logo.svg (Chrome/Edge exigem ~192 e ~512 para instalar o PWA).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const svgPath = join(publicDir, 'logo.svg');
const out192 = join(publicDir, 'pwa-192.png');
const out512 = join(publicDir, 'pwa-512.png');

async function main() {
  let sharp;
  try {
    ({ default: sharp } = await import('sharp'));
  } catch {
    if (existsSync(out192) && existsSync(out512)) {
      console.log('OpenZap: sharp indisponível — a usar ícones PWA já presentes em public/.');
      return;
    }
    console.error(
      'OpenZap: instale dependências (npm install no cliente) para gerar pwa-192.png / pwa-512.png, ou copie esses ficheiros para public/.'
    );
    process.exit(1);
  }

  if (!existsSync(svgPath)) {
    console.error('OpenZap: falta public/logo.svg');
    process.exit(1);
  }

  const svg = readFileSync(svgPath);
  for (const size of [192, 512]) {
    const out = join(publicDir, `pwa-${size}.png`);
    await sharp(svg).resize(size, size).png().toFile(out);
    console.log('OpenZap: escrito', out);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
