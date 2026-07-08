# UniFi Hotspot Portal — Guia de Instalação

## Pré-requisitos

- Ubuntu/Debian com Docker instalado (Node.js **não** é necessário no host — tudo roda em container)
- UniFi Network (UniFi OS) acessível em `https://SEU_IP_DO_CONTROLLER:11443`
- Uma API Key do UniFi gerada em **Settings → Control Plane → Integrations → API Keys**
- Um número de WhatsApp dedicado (chip para a Evolution API)

---

## 1. Configurar as variáveis de ambiente

```bash
cd unifi-hotspot
cp backend/.env.example backend/.env
nano backend/.env
```

Preencha pelo menos:
- `UNIFI_URL`, `UNIFI_API_KEY`, `UNIFI_SITE`
- `EVOLUTION_API_KEY` (invente uma chave forte — ela também precisa estar no `.env` da raiz do projeto, veja abaixo)
- `SUCCESS_REDIRECT_URL` (padrão: `https://www.via01.com.br`)
- `ADMIN_USER` e `ADMIN_PASSWORD` (acesso ao painel `/admin`)

O Docker Compose também lê um `.env` **na raiz do projeto** (arquivo diferente do `backend/.env`) para a variável `EVOLUTION_API_KEY` usada pelo container do Evolution API:

```bash
echo "EVOLUTION_API_KEY=$(grep EVOLUTION_API_KEY backend/.env | cut -d= -f2)" > .env
```
(garante que os dois arquivos usem a mesma chave)

---

## 2. Subir tudo com Docker Compose

```bash
docker compose up -d --build
```

Isso sobe três containers:
- **evolution-api** — WhatsApp/Evolution API (porta `8081` no host)
- **evolution-db** — Postgres usado pelo Evolution API
- **backend** — API + portal (frontend já buildado dentro da imagem), servido na porta `80` do host

Aguarde ~30 segundos e confira:
```bash
docker compose ps
curl http://localhost/health
```

### Criar instância e conectar o WhatsApp

```bash
curl -X POST http://localhost:8081/instance/create \
  -H "apikey: SUA_EVOLUTION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"instanceName": "hotspot", "integration": "WHATSAPP-BAILEYS"}'

curl http://localhost:8081/instance/connect/hotspot \
  -H "apikey: SUA_EVOLUTION_API_KEY"
# → Retorna um QR Code em base64; escaneie com o WhatsApp do chip dedicado
# (ou acesse http://SEU_IP:8081/manager pelo navegador, se essa versão tiver o Manager visual)
```

---

## 3. Configurar o Guest Portal no UniFi

1. Em **Settings → Networks**, confirme que a rede por trás do Wi-Fi de convidados está marcada como **Guest Network**.
2. Em **Settings → WiFi → [sua rede de convidados]**, troque a segurança de WPA para **Open** (sem senha) — quem autentica o acesso é o portal, não uma senha fixa.
3. Ainda na mesma rede, ative **Guest Portal** → **Authentication: External Portal Server**.
4. Em **Redirect URL / Landing Page URL**, coloque **apenas o IP do servidor, sem porta** (o campo do UniFi assume a porta 80 por padrão, que é exatamente onde o backend escuta):
   ```
   http://SEU_IP_DO_SERVIDOR
   ```
5. Salve.

Quando um cliente conectar no Wi-Fi de convidados, o UniFi vai redirecionar para algo como:
```
http://SEU_IP?id=XX:XX:XX:XX:XX:XX&ap=YY:YY:YY:YY:YY:YY&t=...&url=...&ssid=...
```
O portal lê esses parâmetros automaticamente (o MAC do cliente vem no parâmetro `id`).

---

## 4. Identidade visual e painel administrativo

O logo da Via01 fica em `frontend/public/logo-via01.png` (já incluso no build da imagem).

O painel administrativo fica em **`http://SEU_IP_DO_SERVIDOR/admin`** (pede usuário/senha via autenticação básica do navegador — as credenciais são `ADMIN_USER`/`ADMIN_PASSWORD` do `backend/.env`) e lista todos os acessos ao hotspot, marcando quem já é cliente Via01 e quem é um lead.

### Onde ficam os dados

Os registros de acesso (telefone, MAC, se é cliente Via01, data/hora) ficam em `backend/data/guests.jsonl`, um arquivo de texto (uma linha = um acesso) montado como **volume** do host para dentro do container (`./backend/data:/app/data`). Ou seja:
- Os dados **sobrevivem** a `docker compose down`, rebuild da imagem ou reinício do container.
- Ficam fisicamente no servidor em `~/via01hotspot/backend/data/guests.jsonl` — dá pra abrir com `cat`/`less` ou copiar pra backup.
- **Não** vão pro Git (contém dados pessoais — já está no `.gitignore`).
- Se quiser resetar o histórico, basta apagar esse arquivo (o backend recria automaticamente).

Mesma lógica já se aplicava ao WhatsApp (`evolution_instances`) e ao Postgres (`evolution_pgdata`) — ambos em volumes nomeados do Docker, que também sobrevivem a rebuilds.

---

## Aplicando atualizações

Sempre que o código mudar (`git pull`), reconstrua e suba de novo:
```bash
git pull
docker compose up -d --build
```

---

## Estrutura do projeto

```
unifi-hotspot/
├── docker-compose.yml       # Evolution API + Postgres + Backend
├── backend/
│   ├── Dockerfile           # build multi-stage (frontend + backend)
│   ├── server.js            # API Express (send-otp, verify-otp, /admin)
│   ├── package.json
│   ├── .env.example
│   └── data/                # guests.jsonl — registro de acessos (volume persistente)
└── frontend/
    ├── src/App.jsx           # Portal captivo + painel admin, em React
    ├── public/logo-via01.png
    ├── vite.config.js        # Build → ../backend/public (empacotado na imagem)
    └── package.json
```

---

## Fluxo completo

```
Cliente conecta no Wi-Fi
        ↓
UniFi redireciona → http://SEU_IP?id=...&ap=...&url=...
        ↓
Portal React: usuário digita telefone (e marca se já é cliente Via01)
        ↓
Backend → Evolution API → WhatsApp OTP
        ↓
Usuário digita código
        ↓
Backend → UniFi Network Integration API (API Key) → AUTHORIZE_GUEST_ACCESS (libera o MAC)
        ↓
Registra o acesso (backend/data/guests.jsonl) e redireciona para via01.com.br
```
