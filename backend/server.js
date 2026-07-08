import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import https from 'https';
import NodeCache from 'node-cache';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
app.use(cors());

// ─── Painel administrativo (Basic Auth) ──────────────────────────
function requireAdminAuth(req, res, next) {
  const expectedUser = process.env.ADMIN_USER || 'admin';
  const expectedPassword = process.env.ADMIN_PASSWORD || 'admin';
  const header = req.headers.authorization || '';

  const [user, password] = header.startsWith('Basic ')
    ? Buffer.from(header.slice(6), 'base64').toString().split(':')
    : [];

  if (user !== expectedUser || password !== expectedPassword) {
    res.set('WWW-Authenticate', 'Basic realm="Painel Via01"');
    return res.status(401).send('Autenticação necessária.');
  }
  next();
}

app.use('/admin', requireAdminAuth);
app.get('/api/admin/guests', requireAdminAuth, (_req, res) => {
  res.json(readGuestRecords());
});

// Serve o frontend buildado
// (index.html nunca é cacheado pelo navegador — os nomes dos arquivos em
// /assets mudam a cada build, então esses sim podem ser cacheados sem risco)
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);

// ─── Registro de acessos (JSON Lines) ────────────────────────────
const dataDir = path.join(__dirname, 'data');
const guestsFile = path.join(dataDir, 'guests.jsonl');
fs.mkdirSync(dataDir, { recursive: true });

function appendGuestRecord(record) {
  fs.appendFileSync(guestsFile, JSON.stringify(record) + '\n');
}

function readGuestRecords() {
  if (!fs.existsSync(guestsFile)) return [];
  return fs
    .readFileSync(guestsFile, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .reverse();
}

// ─── Cache em memória para OTPs ──────────────────────────────────
// Chave: telefone → valor: { otp, mac, ap, url }
const otpCache = new NodeCache({ stdTTL: Number(process.env.OTP_TTL_SECONDS) || 300 });

// ─── Axios para a UniFi Network Integration API (API Key) ────────
const unifiAxios = axios.create({
  baseURL: `${process.env.UNIFI_URL}/proxy/network/integrations/v1`,
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  headers: { 'X-API-KEY': process.env.UNIFI_API_KEY },
});

// Id do site resolvido a partir do nome (UNIFI_SITE), cacheado em memória
let unifiSiteId = null;

async function getUnifiSiteId() {
  if (unifiSiteId) return unifiSiteId;

  const { data } = await unifiAxios.get('/sites');
  const siteName = process.env.UNIFI_SITE || 'default';
  const site = data.data.find((s) => s.internalReference === siteName) || data.data[0];

  if (!site) throw new Error('Nenhum site encontrado no UniFi.');

  unifiSiteId = site.id;
  return unifiSiteId;
}

async function findClientIdByMac(siteId, mac) {
  const normalizedMac = mac.toLowerCase();
  const limit = 200;
  let offset = 0;

  while (true) {
    const { data } = await unifiAxios.get(`/sites/${siteId}/clients`, { params: { limit, offset } });
    const match = data.data.find((c) => c.macAddress?.toLowerCase() === normalizedMac);
    if (match) return match.id;

    offset += limit;
    if (offset >= data.totalCount) return null;
  }
}

async function unifiAuthorize(mac, minutes = 480) {
  const siteId = await getUnifiSiteId();
  const clientId = await findClientIdByMac(siteId, mac);

  if (!clientId) {
    throw new Error(`Cliente com MAC ${mac} não encontrado no UniFi (precisa estar conectado à rede de convidados).`);
  }

  await unifiAxios.post(`/sites/${siteId}/clients/${clientId}/actions`, {
    action: 'AUTHORIZE_GUEST_ACCESS',
    timeLimitMinutes: minutes,
  });
}

// ─── Evolution API: enviar OTP via WhatsApp ───────────────────────
async function sendWhatsAppOTP(phone, otp) {
  const cleanPhone = phone.replace(/\D/g, '');
  // Garante código do país (Brasil = 55)
  const jid = cleanPhone.startsWith('55') ? `${cleanPhone}@s.whatsapp.net` : `55${cleanPhone}@s.whatsapp.net`;

  await axios.post(
    `${process.env.EVOLUTION_URL}/message/sendText/${process.env.EVOLUTION_INSTANCE}`,
    {
      number: jid,
      text: `🔐 Seu código de acesso ao Wi-Fi é: *${otp}*\n\nVálido por ${Math.round((Number(process.env.OTP_TTL_SECONDS) || 300) / 60)} minutos.`,
    },
    {
      headers: {
        apikey: process.env.EVOLUTION_API_KEY,
        'Content-Type': 'application/json',
      },
    }
  );
}

function generateOTP(length = 6) {
  return String(Math.floor(Math.random() * Math.pow(10, length))).padStart(length, '0');
}

// ─── Rotas ───────────────────────────────────────────────────────

/**
 * POST /api/send-otp
 * Body: { phone, mac, ap, redirectUrl }
 */
app.post('/api/send-otp', async (req, res) => {
  const { phone, mac, ap, redirectUrl, isClient } = req.body;

  if (!phone || !mac) {
    return res.status(400).json({ error: 'Telefone e MAC são obrigatórios.' });
  }

  const cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length < 10) {
    return res.status(400).json({ error: 'Número de telefone inválido.' });
  }

  const otp = generateOTP(Number(process.env.OTP_LENGTH) || 6);

  try {
    await sendWhatsAppOTP(cleanPhone, otp);
    otpCache.set(cleanPhone, { otp, mac, ap, redirectUrl, isClient: !!isClient });
    console.log(`[OTP] Enviado para ${cleanPhone} | MAC: ${mac}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[OTP] Erro ao enviar WhatsApp:', err.response?.data || err.message);
    res.status(502).json({ error: 'Não foi possível enviar o WhatsApp. Tente novamente.' });
  }
});

/**
 * POST /api/verify-otp
 * Body: { phone, otp }
 */
app.post('/api/verify-otp', async (req, res) => {
  const { phone, otp } = req.body;
  const cleanPhone = phone?.replace(/\D/g, '');

  const entry = otpCache.get(cleanPhone);

  if (!entry) {
    return res.status(400).json({ error: 'Código expirado ou telefone não encontrado.' });
  }

  if (entry.otp !== otp) {
    return res.status(400).json({ error: 'Código incorreto.' });
  }

  // OTP válido — autoriza no UniFi
  try {
    await unifiAuthorize(entry.mac);
    otpCache.del(cleanPhone);
    appendGuestRecord({
      phone: cleanPhone,
      mac: entry.mac,
      ap: entry.ap || null,
      isClient: !!entry.isClient,
      connectedAt: new Date().toISOString(),
    });
    console.log(`[AUTH] MAC ${entry.mac} autorizado para telefone ${cleanPhone}`);
    res.json({ ok: true, redirectUrl: process.env.SUCCESS_REDIRECT_URL || 'https://www.via01.com.br' });
  } catch (err) {
    console.error('[AUTH] Erro ao autorizar no UniFi:', err.response?.data || err.message);
    res.status(502).json({ error: 'Erro ao liberar o acesso. Contate o suporte.' });
  }
});

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// SPA fallback
app.get('*', (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend rodando em http://localhost:${PORT}`));
