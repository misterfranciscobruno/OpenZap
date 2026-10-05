#!/bin/bash
set -euo pipefail

echo "==> Instalar dependências"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx certbot python3-certbot-nginx curl ca-certificates gnupg

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs
fi

echo "==> Diretórios"
sudo mkdir -p /var/www/franciscobruno
sudo chown site:site /var/www/franciscobruno
mkdir -p /home/site/openzap

echo "==> Landing page"
cp -f /home/site/deploy/landing/index.html /var/www/franciscobruno/
sudo chown -R www-data:www-data /var/www/franciscobruno

echo "==> OpenZap app"
rsync -a --delete \
  --exclude deploy \
  --exclude .git \
  --exclude node_modules \
  /home/site/openzap-src/ /home/site/openzap/

cd /home/site/openzap
cp -f /home/site/deploy/server.env ./server/.env

echo "==> npm install"
cd /home/site/openzap/server && npm ci --omit=dev 2>/dev/null || npm install --omit=dev

echo "==> Nginx"
sudo cp /home/site/deploy/nginx/franciscobruno.conf /etc/nginx/sites-available/franciscobruno
sudo ln -sf /etc/nginx/sites-available/franciscobruno /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl reload nginx

echo "==> systemd"
sudo cp /home/site/deploy/openzap.service /etc/systemd/system/openzap.service
sudo systemctl daemon-reload
sudo systemctl enable openzap
sudo systemctl restart openzap

echo "==> Certbot TLS"
sudo certbot --nginx --non-interactive --agree-tos --register-unsafely-without-email \
  -d franciscobruno.com -d www.franciscobruno.com -d chat.franciscobruno.com \
  || echo "WARN: certbot falhou — confirme DNS apontando para este servidor e rode certbot manualmente"

echo "==> Firewall GCP: abra UDP 3478 e 49152-65535 para TURN/WebRTC"
sudo systemctl status openzap --no-pager || true
curl -sI http://127.0.0.1:3001/ | head -3 || true
echo "==> Deploy concluído"
