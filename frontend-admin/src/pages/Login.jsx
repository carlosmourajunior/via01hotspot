import { useState } from 'react'
import axios from 'axios'

const campo = {
  width: '100%', padding: '0.7rem 0.85rem', borderRadius: 12,
  border: '1px solid rgba(255,255,255,0.2)', fontSize: '0.93rem',
  outline: 'none', transition: 'border 0.15s, box-shadow 0.15s',
  fontFamily: 'inherit', background: 'rgba(255,255,255,0.08)',
  color: '#fff', caretColor: '#FACC15',
}

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [erro,     setErro]     = useState(null)
  const [loading,  setLoading]  = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setErro(null)
    try {
      const res = await axios.post('/api/auth/login', { username: username.trim(), password })
      localStorage.setItem('token', res.data.access_token)
      onLogin({ username: res.data.username, nome: res.data.nome, admin: res.data.admin })
    } catch (err) {
      setErro(err.response?.data?.detail || 'Erro ao conectar com o servidor')
    }
    setLoading(false)
  }

  const focar   = e => { e.target.style.borderColor = '#FACC15'; e.target.style.boxShadow = '0 0 0 3px rgba(250,204,21,0.2)' }
  const desfocar = e => { e.target.style.borderColor = 'rgba(255,255,255,0.2)'; e.target.style.boxShadow = 'none' }

  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#3D1278', position: 'relative', overflow: 'hidden', padding: '1rem',
    }}>
      {/* Decoração de fundo (mesma linguagem do portal) */}
      <span style={{ position: 'absolute', top: '-40px', right: '-30px', fontSize: '200px', fontWeight: 900, color: 'rgba(192,132,252,0.08)', lineHeight: 1, pointerEvents: 'none' }}>+</span>
      <span style={{ position: 'absolute', bottom: '-50px', left: '-20px', fontSize: '150px', fontWeight: 900, color: 'rgba(192,132,252,0.06)', lineHeight: 1, pointerEvents: 'none' }}>+</span>
      <div style={{ position: 'absolute', top: '-100px', right: '-100px', width: 350, height: 350, borderRadius: '50%', background: 'rgba(255,255,255,0.03)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: '-80px', left: '-80px', width: 250, height: 250, borderRadius: '50%', background: 'rgba(255,255,255,0.025)', pointerEvents: 'none' }} />

      <div style={{
        background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 24, padding: '2.5rem 2rem', width: 380, position: 'relative',
        backdropFilter: 'blur(2px)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <img src="/logo-via01.png" alt="Via01" style={{ height: 40, marginBottom: '0.9rem' }} />
          <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.55)' }}>
            Controle Interno — Área restrita
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '.75rem', fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Usuário
            </label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="seu usuário"
              autoFocus
              required
              style={campo}
              onFocus={focar}
              onBlur={desfocar}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '.75rem', fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Senha
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={campo}
              onFocus={focar}
              onBlur={desfocar}
            />
          </div>

          {erro && (
            <div style={{
              background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
              color: '#FCA5A5', padding: '0.6rem 0.85rem', borderRadius: 12,
              fontSize: '.85rem', textAlign: 'center',
            }}>
              {erro}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: '0.25rem', padding: '0.75rem',
              background: '#FACC15', opacity: loading ? 0.6 : 1,
              color: '#3D1278', border: 'none', borderRadius: 12,
              fontWeight: 700, fontSize: '0.95rem', cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', transition: 'opacity 0.15s',
            }}
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '1.4rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <p style={{ fontSize: '.85rem', fontWeight: 700, color: '#FACC15' }}>#conecteseconosco</p>
          <p style={{ fontSize: '.72rem', color: 'rgba(255,255,255,0.22)', marginTop: 2 }}>Via01 Telecom</p>
        </div>
      </div>
    </div>
  )
}
