import { useState, useEffect, useRef } from 'react';

// Lê parâmetros que o UniFi envia na URL do portal captivo:
// ?mac=XX:XX:XX:XX:XX:XX&ap=XX:XX:XX:XX:XX:XX&id=...&url=https://...
function getParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    mac: p.get('mac') || '',
    ap: p.get('ap') || '',
    redirectUrl: p.get('url') || 'https://www.google.com',
  };
}

const STEPS = { PHONE: 'phone', OTP: 'otp', SUCCESS: 'success' };

export default function App() {
  const { mac, ap, redirectUrl } = getParams();
  const [step, setStep] = useState(STEPS.PHONE);
  const [phone, setPhone] = useState('');
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

  function formatPhone(raw) {
    const d = raw.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }

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
        body: JSON.stringify({ phone: clean, mac, ap, redirectUrl }),
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-8">
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">📶</div>
          <h1 className="text-2xl font-bold text-gray-800">Acesso Wi-Fi</h1>
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
              <div className="flex items-center border border-gray-300 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent">
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

            {error && <p className="text-red-500 text-sm text-center">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors"
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
                    className="w-11 h-13 text-center text-xl font-bold border-2 border-gray-300 rounded-xl focus:border-indigo-500 focus:outline-none transition-colors"
                    autoFocus={idx === 0}
                  />
                ))}
              </div>
            </div>

            {error && <p className="text-red-500 text-sm text-center">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors"
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
                  className="text-indigo-600 text-sm hover:underline"
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
            <p className="text-gray-400 text-sm">Redirecionando em instantes...</p>
          </div>
        )}

        <p className="text-center text-gray-300 text-xs mt-8">
          Powered by UniFi Hotspot Portal
        </p>
      </div>
    </div>
  );
}
