import { useState } from 'react'
import axios from 'axios'

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

  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f0f2f5',
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: '2.5rem 2rem',
        width: 360, boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 56, height: 56, borderRadius: 14,
            background: '#1a1a2e', marginBottom: '0.9rem',
          }}>
            <span style={{ fontSize: '1.6rem' }}>📡</span>
          </div>
          <div style={{ fontWeight: 800, fontSize: '1.25rem', color: '#1a1a2e', letterSpacing: '0.02em' }}>
            Via01
          </div>
          <div style={{ fontSize: '0.82rem', color: '#888', marginTop: '0.2rem' }}>
            Controle Interno
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '.82rem', fontWeight: 600, color: '#555', marginBottom: '0.35rem' }}>
              Usuário
            </label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="seu usuário"
              autoFocus
              required
              style={{
                width: '100%', padding: '0.65rem 0.85rem', borderRadius: 8,
                border: '1.5px solid #d1d5db', fontSize: '0.93rem',
                outline: 'none', transition: 'border 0.15s',
                fontFamily: 'inherit',
              }}
              onFocus={e => e.target.style.borderColor = '#4a90d9'}
              onBlur={e => e.target.style.borderColor = '#d1d5db'}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '.82rem', fontWeight: 600, color: '#555', marginBottom: '0.35rem' }}>
              Senha
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={{
                width: '100%', padding: '0.65rem 0.85rem', borderRadius: 8,
                border: '1.5px solid #d1d5db', fontSize: '0.93rem',
                outline: 'none', transition: 'border 0.15s',
                fontFamily: 'inherit',
              }}
              onFocus={e => e.target.style.borderColor = '#4a90d9'}
              onBlur={e => e.target.style.borderColor = '#d1d5db'}
            />
          </div>

          {erro && (
            <div style={{
              background: '#fde8e8', color: '#c0392b', padding: '0.6rem 0.85rem',
              borderRadius: 8, fontSize: '.85rem',
            }}>
              {erro}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: '0.25rem', padding: '0.7rem',
              background: loading ? '#93c5fd' : '#4a90d9',
              color: '#fff', border: 'none', borderRadius: 8,
              fontWeight: 700, fontSize: '0.95rem', cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', transition: 'background 0.15s',
            }}
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
