# UniFi Hotspot Portal — Guia de Instalação

## Pré-requisitos

- Ubuntu/Debian com Node.js 20+ e Docker instalados
- UniFi Network (UniFi OS) acessível em `https://SEU_IP_DO_CONTROLLER:11443`
- Uma API Key do UniFi gerada em **Settings → Control Plane → Integrations → API Keys**
- Um número de WhatsApp dedicado (chip para a Evolution API)

---

## 1. Subir a Evolution API

```bash
cd unifi-hotspot
cp backend/.env.example backend/.env
# Edite o .env com suas credenciais

docker compose up -d
```

Aguarde ~30 segundos e acesse `http://localhost:8081` para confirmar que está rodando.

### Criar instância e conectar o WhatsApp

```bash
# Substitua SUA_API_KEY pela chave definida em EVOLUTION_API_KEY no .env
curl -X POST http://localhost:8081/instance/create \
  -H "apikey: SUA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"instanceName": "hotspot", "integration": "WHATSAPP-BAILEYS"}'

# Gerar QR Code para conectar o celular
curl http://localhost:8081/instance/connect/hotspot \
  -H "apikey: SUA_API_KEY"
# → Retorna um QR Code em base64; escaneie com o WhatsApp do chip dedicado
```

---

## 2. Instalar e rodar o Backend

```bash
cd backend
cp .env.example .env
# Preencha: UNIFI_URL, UNIFI_API_KEY, EVOLUTION_API_KEY

npm install
npm start
# Backend roda em http://localhost:3000
```

---

## 3. Build e servir o Frontend

```bash
cd frontend
npm install
npm run build
# Build vai para backend/public/
```

Adicione ao `backend/server.js` (já incluso — confirme que a linha abaixo está presente):

```js
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, 'public')));
```

> **Nota:** já está no server.js. Após o build, o backend serve o frontend em `http://SEU_IP:3000`.

---

## 4. Configurar o Guest Portal no UniFi

1. Em **Settings → Networks**, confirme que a rede por trás do Wi-Fi de convidados está marcada como **Guest Network**.
2. Em **Settings → WiFi → [sua rede de convidados]**, troque a segurança de WPA para **Open** (sem senha) — quem autentica o acesso é o portal, não uma senha fixa.
3. Ainda na mesma rede, ative **Guest Portal** → **Authentication: External Portal Server**.
4. Em **Redirect URL / Landing Page URL**, coloque:
   ```
   http://SEU_IP_DO_SERVIDOR:3000
   ```
5. Salve.

Quando um cliente conectar no Wi-Fi de convidados, o UniFi vai redirecionar para:
```
http://SEU_IP:3000?mac=XX:XX:XX:XX&ap=YY:YY:YY:YY&url=https://destino.com
```
O portal lê esses parâmetros automaticamente.

---

## 5. Rodar em produção com PM2

```bash
npm install -g pm2
cd backend
pm2 start server.js --name hotspot-backend
pm2 save
pm2 startup  # configura reinício automático no boot
```

---

## Estrutura do projeto

```
unifi-hotspot/
├── docker-compose.yml       # Evolution API + Postgres
├── backend/
│   ├── server.js            # API Express (send-otp, verify-otp)
│   ├── package.json
│   ├── .env.example
│   └── public/              # Frontend buildado (gerado pelo npm run build)
└── frontend/
    ├── src/App.jsx           # Portal captivo em React
    ├── vite.config.js        # Build → ../backend/public
    └── package.json
```

---

## Fluxo completo

```
Cliente conecta no Wi-Fi
        ↓
UniFi redireciona → http://SEU_IP:3000?mac=...&ap=...&url=...
        ↓
Portal React: usuário digita telefone
        ↓
Backend → Evolution API → WhatsApp OTP
        ↓
Usuário digita código
        ↓
Backend → UniFi Network Integration API (API Key) → AUTHORIZE_GUEST_ACCESS (libera o MAC)
        ↓
Redireciona para a URL original
```
