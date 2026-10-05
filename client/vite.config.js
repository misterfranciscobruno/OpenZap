import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const certDir = path.resolve(__dirname, '../cert');
const keyFile = path.join(certDir, 'privkey.pem');
const certFile = path.join(certDir, 'fullchain.pem');
const useHttps = fs.existsSync(keyFile) && fs.existsSync(certFile);
const apiOrigin = useHttps ? 'https://127.0.0.1:3001' : 'http://127.0.0.1:3001';
const apiProxy = {
  target: apiOrigin,
  changeOrigin: true,
  ...(useHttps ? { secure: false } : {}),
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    https: useHttps
      ? {
          key: fs.readFileSync(keyFile),
          cert: fs.readFileSync(certFile),
        }
      : undefined,
    allowedHosts: [
      'chat.franciscobruno.com',
      'franciscobruno.com',
      'www.franciscobruno.com',
      '.franciscobruno.com',
      'localhost',
    ],
    proxy: {
      '/api': { ...apiProxy },
      '/uploads': { ...apiProxy },
      '/socket.io': {
        ...apiProxy,
        ws: true,
      },
    },
  },
});
