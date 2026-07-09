import { useState, useEffect } from 'react'
import axios from 'axios'
import Login from './pages/Login'
import VendasIXC from './pages/VendasIXC'
import OsAnalise from './pages/OsAnalise'
import Guests from './pages/Guests'
import Admin from './pages/Admin'

// Injeta token em todas as requisições
axios.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Redireciona para login se token inválido
axios.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.reload()
    }
    return Promise.reject(err)
  }
)

const MENU = [
  { id: 'dashboard', label: 'Dashboard',    icon: '📊' },
  { id: 'os',        label: 'OS IXC',       icon: '🔧' },
  { id: 'guests',    label: 'Wi-Fi Guests', icon: '📶' },
  { id: 'admin',     label: 'Admin',        icon: '⚙️'  },
]

export default function App() {
  const [user,   setUser]   = useState(null)   // null = não autenticado
  const [pronto, setPronto] = useState(false)  // evita flash de login antes de validar token
  const [pagina, setPagina] = useState('dashboard')

  // Valida token existente no localStorage
  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) { setPronto(true); return }
    axios.get('/api/auth/me')
      .then(res => { setUser(res.data); setPronto(true) })
      .catch(() => { localStorage.removeItem('token'); setPronto(true) })
  }, [])

  const handleLogin = (userData) => setUser(userData)

  const handleLogout = () => {
    localStorage.removeItem('token')
    setUser(null)
  }

  if (!pronto) return null  // aguarda validação do token

  if (!user) return <Login onLogin={handleLogin} />

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img src="/logo-via01.png" alt="Via01" className="logo-img" />
        </div>

        <nav className="sidebar-nav">
          {MENU.map(item => (
            <button
              key={item.id}
              className={'nav-item' + (pagina === item.id ? ' active' : '')}
              onClick={() => setPagina(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Usuário + logout */}
        <div style={{
          marginTop: 'auto', padding: '1rem 0.75rem',
          borderTop: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.78rem', marginBottom: '0.5rem', paddingLeft: '0.15rem' }}>
            👤 {user.nome || user.username}
          </div>
          <button
            onClick={handleLogout}
            style={{
              width: '100%', padding: '0.5rem 0.9rem',
              background: 'rgba(255,255,255,0.07)', border: 'none',
              borderRadius: 8, color: 'rgba(255,255,255,0.55)',
              cursor: 'pointer', fontSize: '0.82rem', fontFamily: 'inherit',
              textAlign: 'left', transition: 'background 0.15s',
            }}
            onMouseEnter={e => e.target.style.background = 'rgba(255,80,80,0.18)'}
            onMouseLeave={e => e.target.style.background = 'rgba(255,255,255,0.07)'}
          >
            ↩ Sair
          </button>
        </div>
      </aside>

      <main className="main-content">
        {pagina === 'dashboard' && <VendasIXC />}
        {pagina === 'os'        && <OsAnalise />}
        {pagina === 'guests'    && <Guests />}
        {pagina === 'admin'     && <Admin user={user} />}
      </main>
    </div>
  )
}
