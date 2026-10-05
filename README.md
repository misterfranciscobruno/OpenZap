# MetaWhats

Cliente de mensagens descentralizado com identidade gerida pela carteira MetaMask.

## Funcionalidades

- **Identidade MetaMask** — Login via assinatura criptográfica, sem emails ou números de telefone
- **Mensagens em tempo real** — Chat instantâneo via WebSocket (Socket.IO)
- **Conversas privadas** — 1-para-1 entre endereços Ethereum
- **Grupos** — Criação de grupos com múltiplos participantes
- **Gestão de contactos** — Adicionar contactos por endereço Ethereum
- **Perfil editável** — Nome, recado (bio) e avatar
- **Indicadores de estado** — Online/offline, "a escrever...", checkmarks (enviada/entregue/lida)
- **Partilha de imagens** — Upload e envio de fotografias
- **Emojis** — Seletor de emojis integrado
- **Responder a mensagens** — Quote/reply com preview
- **Pesquisa** — Pesquisar conversas e mensagens

## Tecnologias

| Camada    | Tecnologia                                  |
| --------- | ------------------------------------------- |
| Frontend  | React 18 + Vite + Tailwind CSS              |
| Backend   | Node.js + Express + Socket.IO               |
| Base dados| SQLite (via better-sqlite3)                  |
| Carteira  | MetaMask + ethers.js v6                      |

## Pré-requisitos

- **Node.js** >= 18
- **MetaMask** instalado no browser (extensão Chrome/Firefox/Brave)

## Instalação

```bash
# Clonar ou navegar até à pasta do projeto
cd metawhats

# Instalar todas as dependências
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..
```

## Executar

### Opção 1 — Ambos em simultâneo

```bash
npm run dev
```

### Opção 2 — Separadamente

Terminal 1 (servidor):
```bash
cd server
npm start
```

Terminal 2 (cliente):
```bash
cd client
npm run dev
```

O servidor corre na porta **3001** e o cliente na porta **5173**.

Abrir **http://localhost:5173** no browser com MetaMask instalado.

## Como usar

1. **Conectar MetaMask** — Clique em "Conectar MetaMask" na página de login
2. **Assinar mensagem** — O MetaMask pede para assinar uma mensagem de autenticação (sem custo de gas)
3. **Editar perfil** — Clique no avatar no canto superior esquerdo para definir nome e recado
4. **Adicionar contacto** — Clique no ícone de nova conversa e adicione um endereço Ethereum
5. **Enviar mensagem** — Selecione um contacto para iniciar uma conversa
6. **Criar grupo** — Clique no ícone de grupo para criar um grupo com vários participantes

## Arquitetura

```
metawhats/
├── server/
│   ├── index.js          # Servidor Express + Socket.IO
│   ├── db.js             # Camada de dados SQLite
│   ├── auth.js           # Autenticação MetaMask
│   └── uploads/          # Ficheiros enviados
├── client/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── contexts/
│   │   │   ├── AuthContext.jsx    # Estado de autenticação
│   │   │   └── ChatContext.jsx    # Estado de chat + Socket.IO
│   │   └── components/
│   │       ├── Login.jsx          # Ecrã de login
│   │       ├── MainLayout.jsx     # Layout principal
│   │       ├── Sidebar.jsx        # Barra lateral
│   │       ├── ChatWindow.jsx     # Janela de chat
│   │       ├── MessageBubble.jsx  # Bolha de mensagem
│   │       ├── NewChatModal.jsx   # Nova conversa
│   │       ├── NewGroupModal.jsx  # Novo grupo
│   │       └── ProfilePanel.jsx   # Perfil do utilizador
│   ├── tailwind.config.js
│   └── vite.config.js
└── package.json
```

## Notas

- A identidade do utilizador é o seu endereço Ethereum — não há passwords nem emails
- A autenticação usa assinatura criptográfica (sem custo de gas) para provar a posse da carteira
- As mensagens são armazenadas numa base de dados SQLite local no servidor

## Configuração de produção

Variáveis de ambiente do servidor (`server/.env`):

| Variável | Obrigatório | Descrição |
| --- | --- | --- |
| `NODE_ENV` | sim | `production` ativa validações estritas |
| `METAWHATS_JWT_SECRET` (ou `OPENZAP_JWT_SECRET`) | sim em prod | Segredo HMAC para tokens REST (mín. 16 caracteres). Use uma string aleatória forte |
| `METAWHATS_ALLOWED_ORIGINS` (ou `OPENZAP_ALLOWED_ORIGINS`) | sim em prod | Lista CSV de origens permitidas (CORS + Socket.IO), ex.: `https://chat.franciscobruno.com` |
| `PORT` | não | Porta do servidor (defeito 3001) |
| `TRUST_PROXY_HOPS` | não | Saltos de proxy reverso à frente do servidor (defeito 1) |
| `SSL_KEY_PATH` / `SSL_CERT_PATH` / `SSL_CHAIN_PATH` | opcional | Certificados TLS PEM (ou `LETSENCRYPT_DOMAIN` em Linux) |

### Endurecimento de segurança aplicado

- Cabeçalhos HTTP via **helmet** (`X-Content-Type-Options`, `Cross-Origin-*`, `Referrer-Policy`, HSTS em produção, etc.)
- Rate limiting nos endpoints `/api/auth/*`, `/api/upload` e geral em `/api/*`
- CORS estrito: em produção exige `ALLOWED_ORIGINS`; em dev aceita apenas `localhost:5174`
- Tokens REST HMAC com TTL de **24 h** + revogação global por endereço via `POST /api/auth/logout`
- Nonces com TTL de 5 min e limpeza periódica
- Validação de endereços, tamanhos de perfil, formato de avatar, e sanitização de mensagens de erro
- Socket.IO: todos os eventos de conversa exigem autenticação **e** verificação de membro (incluindo `join_conversation`, `typing`, `message_read`, etc.)
- `/uploads`: bloqueio de path traversal, dotfiles, sandbox CSP, `Cache-Control: no-store`, sem listagem de directório
- Para uso em produção, considere adicionar encriptação de ponta a ponta com chaves derivadas da carteira
