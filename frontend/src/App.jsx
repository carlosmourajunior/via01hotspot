import { useState, useEffect, useRef } from 'react';

// Lê parâmetros que o UniFi envia na URL do portal captivo:
// ?id=XX:XX:XX:XX:XX:XX&ap=XX:XX:XX:XX:XX:XX&t=...&url=...&ssid=...
// (o UniFi manda o MAC do cliente no parâmetro "id"; "mac" fica como fallback
// para compatibilidade com outras versões/controladores)
function getParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    mac: p.get('id') || p.get('mac') || '',
    ap: p.get('ap') || '',
    redirectUrl: p.get('url') || 'https://www.via01.com.br',
  };
}

function formatPhone(raw) {
  const d = raw.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function formatPhoneDisplay(raw) {
  const d = (raw || '').replace(/\D/g, '');
  const local = d.startsWith('55') ? d.slice(2) : d;
  return formatPhone(local) || raw;
}

function Logo({ className }) {
  return <img src="/logo-via01.png" alt="Via01" className={className} />;
}

const STEPS = { PHONE: 'phone', OTP: 'otp', SUCCESS: 'success' };

function PortalApp() {
  const { mac, ap, redirectUrl } = getParams();
  const [step, setStep] = useState(STEPS.PHONE);
  const [phone, setPhone] = useState('');
  const [isClient, setIsClient] = useState(false);
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);
  const otpRefs = useRef([]);

  // Countdown para reenvio
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  async function handleSendOTP(e) {
    e?.preventDefault();
    setError('');
    const clean = phone.replace(/\D/g, '');
    if (clean.length < 10) {
      setError('Digite um número válido com DDD.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: clean, mac, ap, redirectUrl, isClient }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao enviar.');
      setStep(STEPS.OTP);
      setCountdown(60);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleOtpChange(idx, val) {
    if (!/^\d*$/.test(val)) return;
    const next = [...otp];
    next[idx] = val.slice(-1);
    setOtp(next);
    if (val && idx < 5) otpRefs.current[idx + 1]?.focus();
  }

  function handleOtpKeyDown(idx, e) {
    if (e.key === 'Backspace' && !otp[idx] && idx > 0) {
      otpRefs.current[idx - 1]?.focus();
    }
  }

  async function handleVerifyOTP(e) {
    e?.preventDefault();
    const code = otp.join('');
    if (code.length < 6) {
      setError('Digite o código completo de 6 dígitos.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.replace(/\D/g, ''), otp: code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Código inválido.');
      setStep(STEPS.SUCCESS);
      // Redireciona após 3 segundos
      setTimeout(() => {
        window.location.href = data.redirectUrl || redirectUrl;
      }, 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-8 border border-gray-100">
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <Logo className="h-14 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900">Acesso Wi-Fi</h1>
          <p className="text-gray-500 text-sm mt-1">
            {step === STEPS.PHONE && 'Digite seu WhatsApp para receber o código'}
            {step === STEPS.OTP && `Código enviado para ${phone}`}
            {step === STEPS.SUCCESS && 'Acesso liberado!'}
          </p>
        </div>

        {/* ── Etapa 1: Telefone ── */}
        {step === STEPS.PHONE && (
          <form onSubmit={handleSendOTP} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Número do WhatsApp
              </label>
              <div className="flex items-center border border-gray-300 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-black focus-within:border-transparent">
                <span className="px-3 py-3 bg-gray-50 text-gray-500 text-sm border-r border-gray-300 select-none">
                  🇧🇷 +55
                </span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(formatPhone(e.target.value))}
                  placeholder="(11) 99999-9999"
                  className="flex-1 px-3 py-3 text-gray-800 text-sm outline-none bg-white"
                  autoComplete="tel"
                  inputMode="numeric"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-600 select-none">
              <input
                type="checkbox"
                checked={isClient}
                onChange={(e) => setIsClient(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-black focus:ring-black"
              />
              Já sou cliente Via01
            </label>

            {error && <p className="text-red-500 text-sm text-center">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-black hover:bg-gray-800 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors"
            >
              {loading ? 'Enviando...' : 'Receber código via WhatsApp'}
            </button>
          </form>
        )}

        {/* ── Etapa 2: OTP ── */}
        {step === STEPS.OTP && (
          <form onSubmit={handleVerifyOTP} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3 text-center">
                Digite o código de 6 dígitos
              </label>
              <div className="flex justify-center gap-2">
                {otp.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => (otpRefs.current[idx] = el)}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(idx, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                    className="w-11 h-13 text-center text-xl font-bold border-2 border-gray-300 rounded-xl focus:border-black focus:outline-none transition-colors"
                    autoFocus={idx === 0}
                  />
                ))}
              </div>
            </div>

            {error && <p className="text-red-500 text-sm text-center">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-black hover:bg-gray-800 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors"
            >
              {loading ? 'Verificando...' : 'Conectar'}
            </button>

            <div className="text-center">
              {countdown > 0 ? (
                <p className="text-gray-400 text-sm">Reenviar em {countdown}s</p>
              ) : (
                <button
                  type="button"
                  onClick={handleSendOTP}
                  className="text-gray-900 text-sm hover:underline"
                >
                  Reenviar código
                </button>
              )}
              <button
                type="button"
                onClick={() => { setStep(STEPS.PHONE); setOtp(['','','','','','']); setError(''); }}
                className="block mx-auto mt-2 text-gray-400 text-xs hover:underline"
              >
                Alterar número
              </button>
            </div>
          </form>
        )}

        {/* ── Etapa 3: Sucesso ── */}
        {step === STEPS.SUCCESS && (
          <div className="text-center space-y-4">
            <div className="text-6xl animate-bounce">✅</div>
            <p className="text-gray-700 font-medium">Internet liberada!</p>
            <p className="text-gray-400 text-sm">Redirecionando para via01.com.br...</p>
          </div>
        )}

        <p className="text-center text-gray-300 text-xs mt-8">
          Rede oferecida por Via01
        </p>
      </div>
    </div>
  );
}

function StatCard({ label, value, active }) {
  return (
    <div
      className={`w-full bg-white rounded-xl shadow p-4 border transition-colors ${
        active ? 'border-black ring-1 ring-black' : 'border-gray-100 hover:border-gray-300'
      }`}
    >
      <p className="text-gray-400 text-xs uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
    </div>
  );
}

function AdminLogin({ onLoggedIn }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha no login.');
      onLoggedIn();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-8 border border-gray-100">
        <div className="text-center mb-8">
          <Logo className="h-14 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900">Painel Administrativo</h1>
          <p className="text-gray-500 text-sm mt-1">Entre para ver os acessos ao hotspot</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Usuário</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-3 border border-gray-300 rounded-xl text-sm text-gray-800 outline-none focus:ring-2 focus:ring-black focus:border-transparent"
              autoComplete="username"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-3 border border-gray-300 rounded-xl text-sm text-gray-800 outline-none focus:ring-2 focus:ring-black focus:border-transparent"
              autoComplete="current-password"
            />
          </div>

          {error && <p className="text-red-500 text-sm text-center">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-black hover:bg-gray-800 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}

function AdminDashboard({ guests, onLogout }) {
  const [filter, setFilter] = useState('all'); // all | clients | leads

  const clients = guests.filter((g) => g.isClient).length;
  const leads = guests.length - clients;
  const visibleGuests =
    filter === 'clients' ? guests.filter((g) => g.isClient) : filter === 'leads' ? guests.filter((g) => !g.isClient) : guests;

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <Logo className="h-9" />
            <h1 className="text-lg sm:text-xl font-bold text-gray-900">Painel do Hotspot</h1>
          </div>
          <button
            onClick={onLogout}
            className="text-sm text-gray-500 hover:text-gray-900 hover:underline"
          >
            Sair
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <button onClick={() => setFilter('all')} className="text-left">
            <StatCard label="Total de acessos" value={guests.length} active={filter === 'all'} />
          </button>
          <button onClick={() => setFilter('clients')} className="text-left">
            <StatCard label="Clientes Via01" value={clients} active={filter === 'clients'} />
          </button>
          <button onClick={() => setFilter('leads')} className="text-left">
            <StatCard label="Possíveis leads" value={leads} active={filter === 'leads'} />
          </button>
        </div>

        <div className="bg-white rounded-xl shadow overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-black text-white text-left">
              <tr>
                <th className="px-4 py-3">Telefone</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">MAC</th>
                <th className="px-4 py-3">Data/Hora</th>
              </tr>
            </thead>
            <tbody>
              {visibleGuests.map((g, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="px-4 py-3 whitespace-nowrap">{formatPhoneDisplay(g.phone)}</td>
                  <td className="px-4 py-3">
                    {g.isClient ? (
                      <span className="inline-block px-2 py-0.5 rounded-full bg-black text-white text-xs font-medium">
                        Cliente Via01
                      </span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded-full bg-gray-200 text-gray-700 text-xs font-medium">
                        Lead
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{g.mac}</td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {new Date(g.connectedAt).toLocaleString('pt-BR')}
                  </td>
                </tr>
              ))}
              {visibleGuests.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                    Nenhum acesso registrado ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AdminPage() {
  const [authed, setAuthed] = useState(null); // null = verificando, true/false depois
  const [guests, setGuests] = useState(null);
  const [error, setError] = useState('');

  function loadGuests() {
    setError('');
    return fetch('/api/admin/guests')
      .then((res) => {
        if (res.status === 401) {
          setAuthed(false);
          return null;
        }
        if (!res.ok) throw new Error('Erro ao carregar os dados.');
        return res.json();
      })
      .then((data) => {
        if (!data) return;
        setGuests(data);
        setAuthed(true);
      })
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    loadGuests();
  }, []);

  async function handleLogout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    setGuests(null);
    setAuthed(false);
  }

  if (authed === null) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">Carregando...</div>;
  }

  if (!authed) {
    return <AdminLogin onLoggedIn={loadGuests} />;
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-red-600 p-4 text-center">
        <p>{error}</p>
        <button onClick={loadGuests} className="text-sm underline text-gray-500">
          Tentar de novo
        </button>
      </div>
    );
  }

  return <AdminDashboard guests={guests} onLogout={handleLogout} />;
}

export default function App() {
  return window.location.pathname.startsWith('/admin') ? <AdminPage /> : <PortalApp />;
}
