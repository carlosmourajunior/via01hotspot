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

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  async function handleSendOTP(e) {
    e?.preventDefault();
    setError('');
    const clean = phone.replace(/\D/g, '');
    if (clean.length < 10) { setError('Digite um número válido com DDD.'); return; }
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
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  function handleOtpChange(idx, val) {
    if (!/^\d*$/.test(val)) return;
    const next = [...otp];
    next[idx] = val.slice(-1);
    setOtp(next);
    if (val && idx < 5) otpRefs.current[idx + 1]?.focus();
  }

  function handleOtpKeyDown(idx, e) {
    if (e.key === 'Backspace' && !otp[idx] && idx > 0) otpRefs.current[idx - 1]?.focus();
  }

  async function handleVerifyOTP(e) {
    e?.preventDefault();
    const code = otp.join('');
    if (code.length < 6) { setError('Digite o código completo de 6 dígitos.'); return; }
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
      setTimeout(() => { window.location.href = data.redirectUrl || redirectUrl; }, 3500);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  const stepIndex = step === STEPS.PHONE ? 0 : step === STEPS.OTP ? 1 : 2;

  /* ── ícone SVG por etapa ── */
  const StepIcon = () => {
    if (step === STEPS.PHONE) return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12 20.25h.008v.008H12v-.008z" />
      </svg>
    );
    if (step === STEPS.OTP) return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
      </svg>
    );
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: '#3D1278' }}
    >
      {/* Decoração de fundo */}
      <div className="pointer-events-none select-none absolute inset-0 overflow-hidden">
        <span style={{ position:'absolute', top:'-40px', right:'-30px', fontSize:'200px', fontWeight:900, color:'rgba(192,132,252,0.08)', lineHeight:1 }}>+</span>
        <span style={{ position:'absolute', bottom:'-50px', left:'-20px', fontSize:'150px', fontWeight:900, color:'rgba(192,132,252,0.06)', lineHeight:1 }}>+</span>
        <div style={{ position:'absolute', top:'-100px', right:'-100px', width:'350px', height:'350px', borderRadius:'50%', background:'rgba(255,255,255,0.03)' }} />
        <div style={{ position:'absolute', bottom:'-80px', left:'-80px', width:'250px', height:'250px', borderRadius:'50%', background:'rgba(255,255,255,0.025)' }} />
      </div>

      <div
        className="relative w-full max-w-sm rounded-3xl p-7"
        style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', backdropFilter:'blur(2px)' }}
      >
        {/* Logo branca */}
        <div className="flex justify-center mb-6">
          <Logo className="h-10" />
        </div>

        {/* Ícone da etapa */}
        <div className="flex flex-col items-center mb-2">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3 text-white"
            style={{
              background: step === STEPS.SUCCESS ? 'rgba(250,204,21,0.15)' : 'rgba(255,255,255,0.12)',
              border: step === STEPS.SUCCESS ? '1px solid rgba(250,204,21,0.4)' : '1px solid rgba(255,255,255,0.2)',
              color: step === STEPS.SUCCESS ? '#FACC15' : '#fff',
            }}
          >
            <StepIcon />
          </div>

          <h1 className="text-lg font-bold text-white">
            {step === STEPS.PHONE && 'Acesso à internet'}
            {step === STEPS.OTP && 'Código enviado'}
            {step === STEPS.SUCCESS && 'Conectado!'}
          </h1>
          <p className="text-sm text-center mt-1" style={{ color:'rgba(255,255,255,0.55)' }}>
            {step === STEPS.PHONE && 'Digite seu WhatsApp para receber o código de verificação'}
            {step === STEPS.OTP && <>Verifique o WhatsApp de <strong className="font-semibold" style={{ color:'#FACC15' }}>{phone}</strong></>}
            {step === STEPS.SUCCESS && 'Acesso liberado. Redirecionando em instantes…'}
          </p>
        </div>

        {/* Step dots */}
        <div className="flex justify-center gap-1.5 my-5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-1 rounded-full transition-all duration-300"
              style={{
                width: i === stepIndex ? '20px' : '4px',
                background: i === stepIndex ? '#FACC15' : i < stepIndex ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.15)',
              }}
            />
          ))}
        </div>

        {/* ── Etapa 1: Telefone ── */}
        {step === STEPS.PHONE && (
          <form onSubmit={handleSendOTP} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wide" style={{ color:'rgba(255,255,255,0.5)' }}>
                WhatsApp
              </label>
              <div
                className="flex items-stretch rounded-xl overflow-hidden transition-all"
                style={{ border:'1px solid rgba(255,255,255,0.2)', background:'rgba(255,255,255,0.08)' }}
                onFocus={(e) => e.currentTarget.style.boxShadow='0 0 0 3px rgba(250,204,21,0.2)'}
                onBlur={(e) => e.currentTarget.style.boxShadow='none'}
              >
                <span
                  className="flex items-center gap-1.5 px-3 text-sm select-none whitespace-nowrap"
                  style={{ borderRight:'1px solid rgba(255,255,255,0.12)', color:'rgba(255,255,255,0.45)', background:'rgba(0,0,0,0.15)' }}
                >
                  🇧🇷 +55
                </span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(formatPhone(e.target.value))}
                  placeholder="(11) 99999-9999"
                  className="flex-1 px-3 py-3 text-sm text-white bg-transparent outline-none"
                  style={{ caretColor:'#FACC15' }}
                  autoComplete="tel"
                  inputMode="numeric"
                  autoFocus
                />
              </div>
            </div>

            <label className="flex items-center gap-2.5 text-sm select-none cursor-pointer" style={{ color:'rgba(255,255,255,0.7)' }}>
              <input
                type="checkbox"
                checked={isClient}
                onChange={(e) => setIsClient(e.target.checked)}
                className="w-4 h-4 rounded cursor-pointer"
                style={{ accentColor:'#FACC15' }}
              />
              Já sou cliente Via01
            </label>

            {error && (
              <p className="text-xs text-center rounded-xl py-2 px-3" style={{ background:'rgba(239,68,68,0.15)', border:'1px solid rgba(239,68,68,0.3)', color:'#FCA5A5' }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl text-sm font-bold disabled:opacity-50 transition-all active:scale-[0.98]"
              style={{ background:'#FACC15', color:'#3D1278' }}
            >
              {loading ? 'Enviando…' : 'Receber código via WhatsApp'}
            </button>

            <p className="text-center text-xs pt-1" style={{ color:'rgba(255,255,255,0.3)' }}>
              Ao continuar, você aceita os termos de uso da rede.
            </p>
          </form>
        )}

        {/* ── Etapa 2: OTP ── */}
        {step === STEPS.OTP && (
          <form onSubmit={handleVerifyOTP} className="space-y-5">
            <p className="text-xs text-center" style={{ color:'rgba(255,255,255,0.5)' }}>
              Digite o código de 6 dígitos
            </p>
            <div className="flex justify-center gap-2">
              {otp.map((digit, idx) => {
                const isCursor = !digit && otp.slice(0, idx).every(Boolean);
                return (
                  <input
                    key={idx}
                    ref={(el) => (otpRefs.current[idx] = el)}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(idx, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                    className="w-10 h-12 text-center text-lg font-bold outline-none rounded-xl transition-all"
                    style={{
                      background: digit ? 'rgba(250,204,21,0.12)' : 'rgba(255,255,255,0.07)',
                      border: digit || isCursor ? '1.5px solid #FACC15' : '1.5px solid rgba(255,255,255,0.15)',
                      color: digit ? '#FACC15' : '#fff',
                      boxShadow: isCursor ? '0 0 0 3px rgba(250,204,21,0.15)' : 'none',
                      caretColor: '#FACC15',
                    }}
                    autoFocus={idx === 0}
                  />
                );
              })}
            </div>

            {error && (
              <p className="text-xs text-center rounded-xl py-2 px-3" style={{ background:'rgba(239,68,68,0.15)', border:'1px solid rgba(239,68,68,0.3)', color:'#FCA5A5' }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl text-sm font-bold disabled:opacity-50 transition-all active:scale-[0.98]"
              style={{ background:'#FACC15', color:'#3D1278' }}
            >
              {loading ? 'Verificando…' : 'Conectar'}
            </button>

            <div className="flex flex-col items-center gap-1.5">
              {countdown > 0 ? (
                <p className="text-xs tabular-nums" style={{ color:'rgba(255,255,255,0.4)' }}>
                  Reenviar código em {countdown}s
                </p>
              ) : (
                <button type="button" onClick={handleSendOTP} className="text-xs underline" style={{ color:'#FACC15', background:'none', border:'none', cursor:'pointer' }}>
                  Reenviar código
                </button>
              )}
              <button
                type="button"
                onClick={() => { setStep(STEPS.PHONE); setOtp(['','','','','','']); setError(''); }}
                className="text-xs" style={{ color:'rgba(255,255,255,0.35)', background:'none', border:'none', cursor:'pointer' }}
              >
                ← Alterar número
              </button>
            </div>
          </form>
        )}

        {/* ── Etapa 3: Sucesso ── */}
        {step === STEPS.SUCCESS && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[['↓ Download', '50 Mbps'], ['↑ Upload', '20 Mbps']].map(([label, value]) => (
                <div key={label} className="rounded-2xl p-3 text-center" style={{ background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.12)' }}>
                  <p className="text-sm font-bold" style={{ color:'#FACC15' }}>{value}</p>
                  <p className="text-xs mt-0.5" style={{ color:'rgba(255,255,255,0.45)' }}>{label}</p>
                </div>
              ))}
            </div>
            <div>
              <div className="w-full h-1 rounded-full overflow-hidden" style={{ background:'rgba(255,255,255,0.1)' }}>
                <div className="h-full rounded-full animate-[progress_3.5s_ease_forwards]" style={{ background:'#FACC15' }} />
              </div>
              <p className="text-xs text-center mt-1.5" style={{ color:'rgba(255,255,255,0.4)' }}>Redirecionando…</p>
            </div>
          </div>
        )}

        {/* Tagline */}
        <div className="text-center mt-5 pt-4" style={{ borderTop:'1px solid rgba(255,255,255,0.08)' }}>
          <p className="text-sm font-bold" style={{ color:'#FACC15', letterSpacing:'0.01em' }}>
            #conecteseconosco
          </p>
          <p className="text-xs mt-0.5" style={{ color:'rgba(255,255,255,0.22)', letterSpacing:'0.03em' }}>
            Rede oferecida por Via01
          </p>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  // A área administrativa agora vive em um serviço próprio (porta 8082)
  if (window.location.pathname.startsWith('/admin')) {
    window.location.replace(`http://${window.location.hostname}:8082/`);
    return null;
  }
  return <PortalApp />;
}
