import { useState, useEffect } from 'react'
import axios from 'axios'

function BadgeAdmin({ admin }) {
  return admin
    ? <span style={{ padding: '1px 8px', borderRadius: 10, fontSize: '.75rem', fontWeight: 700, background: '#e8f3fb', color: '#1a5e8a' }}>Admin</span>
    : <span style={{ padding: '1px 8px', borderRadius: 10, fontSize: '.75rem', fontWeight: 600, background: '#f5f5f5', color: '#888' }}>Usuário</span>
}

function BadgeAtivo({ ativo }) {
  return ativo
    ? <span style={{ padding: '1px 8px', borderRadius: 10, fontSize: '.75rem', fontWeight: 600, background: '#e8f8e8', color: '#1a5e20' }}>Ativo</span>
    : <span style={{ padding: '1px 8px', borderRadius: 10, fontSize: '.75rem', fontWeight: 600, background: '#fde8e8', color: '#7d1010' }}>Inativo</span>
}

const FORM_VAZIO = { username: '', nome: '', senha: '', admin: false, funcoes: [] }

const FUNCOES = [
  { id: 'vendas',     label: 'Vendas',     bg: '#f3e8fd', cor: '#6c3483' },
  { id: 'financeiro', label: 'Financeiro', bg: '#e0f5eb', cor: '#1a7a44' },
  { id: 'suporte',    label: 'Suporte',    bg: '#e3f0fb', cor: '#1a5276' },
]

function BadgeFuncao({ id }) {
  const f = FUNCOES.find(x => x.id === id)
  if (!f) return null
  return (
    <span style={{
      padding: '1px 8px', borderRadius: 10, fontSize: '.72rem', fontWeight: 600,
      background: f.bg, color: f.cor, marginRight: 4,
    }}>
      {f.label}
    </span>
  )
}

export default function Admin({ user }) {
  const [usuarios,  setUsuarios]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [erro,      setErro]      = useState(null)
  const [sucesso,   setSucesso]   = useState(null)
  const [form,      setForm]      = useState(FORM_VAZIO)
  const [salvando,  setSalvando]  = useState(false)
  const [formErro,  setFormErro]  = useState(null)

  const isAdmin = user?.admin === true

  const carregar = () => {
    setLoading(true)
    axios.get('/api/usuarios')
      .then(r => { setUsuarios(r.data); setLoading(false) })
      .catch(e => { setErro(e.response?.data?.detail || e.message); setLoading(false) })
  }

  useEffect(() => { if (isAdmin) carregar() }, [isAdmin])

  const flash = (msg, ok = true) => {
    if (ok) setSucesso(msg); else setErro(msg)
    setTimeout(() => { setSucesso(null); setErro(null) }, 4000)
  }

  const handleCriar = async (e) => {
    e.preventDefault()
    setFormErro(null)
    if (!form.username.trim() || !form.senha.trim()) { setFormErro('Username e senha são obrigatórios'); return }
    if (form.senha.length < 4) { setFormErro('Senha deve ter ao menos 4 caracteres'); return }
    setSalvando(true)
    try {
      await axios.post('/api/usuarios', form)
      setForm(FORM_VAZIO)
      flash('Usuário criado com sucesso!')
      carregar()
    } catch (err) {
      setFormErro(err.response?.data?.detail || err.message)
    }
    setSalvando(false)
  }

  const toggleAtivo = async (u) => {
    try {
      await axios.patch(`/api/usuarios/${u.id}`, { ativo: !u.ativo })
      flash(`${u.username} ${!u.ativo ? 'ativado' : 'desativado'}.`)
      carregar()
    } catch (err) { flash(err.response?.data?.detail || err.message, false) }
  }

  const toggleAdmin = async (u) => {
    try {
      await axios.patch(`/api/usuarios/${u.id}`, { admin: !u.admin })
      flash(`Permissão de ${u.username} atualizada.`)
      carregar()
    } catch (err) { flash(err.response?.data?.detail || err.message, false) }
  }

  const toggleFuncao = async (u, funcao) => {
    const atuais = u.funcoes || []
    const novas = atuais.includes(funcao) ? atuais.filter(f => f !== funcao) : [...atuais, funcao]
    try {
      await axios.patch(`/api/usuarios/${u.id}`, { funcoes: novas })
      flash(`Funções de ${u.username} atualizadas.`)
      carregar()
    } catch (err) { flash(err.response?.data?.detail || err.message, false) }
  }

  const excluir = async (u) => {
    if (!window.confirm(`Excluir o usuário "${u.username}"? Esta ação não pode ser desfeita.`)) return
    try {
      await axios.delete(`/api/usuarios/${u.id}`)
      flash(`${u.username} excluído.`)
      carregar()
    } catch (err) { flash(err.response?.data?.detail || err.message, false) }
  }

  if (!isAdmin) {
    return (
      <div className="page">
        <div className="page-header"><h1>Administração</h1></div>
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: '#888' }}>
          🔒 Acesso restrito a administradores.
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Administração — Usuários</h1>
        <button className="btn-sync" onClick={carregar} style={{ background: '#6c757d' }}>↻ Atualizar</button>
      </div>

      {sucesso && <div className="alert-success">{sucesso}</div>}
      {erro    && <div className="alert-error">{erro}</div>}

      {/* ── Criar novo usuário ── */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ marginBottom: '1rem', fontSize: '1rem' }}>Novo Usuário</h2>
        <form onSubmit={handleCriar}
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto auto', gap: '0.75rem', alignItems: 'end' }}>
          <div>
            <label style={labelStyle}>Username</label>
            <input style={inputStyle} value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              placeholder="ex: joao.silva" autoComplete="off" />
          </div>
          <div>
            <label style={labelStyle}>Nome completo</label>
            <input style={inputStyle} value={form.nome}
              onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
              placeholder="João Silva" />
          </div>
          <div>
            <label style={labelStyle}>Senha inicial</label>
            <input style={inputStyle} type="password" value={form.senha}
              onChange={e => setForm(f => ({ ...f, senha: e.target.value }))}
              placeholder="mínimo 4 caracteres" autoComplete="new-password" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', paddingBottom: '0.1rem', flexWrap: 'wrap' }}>
            {FUNCOES.map(fn => (
              <span key={fn.id} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <input type="checkbox" id={`chk-${fn.id}`} checked={form.funcoes.includes(fn.id)}
                  onChange={e => setForm(f => ({
                    ...f,
                    funcoes: e.target.checked ? [...f.funcoes, fn.id] : f.funcoes.filter(x => x !== fn.id),
                  }))}
                  style={{ width: 15, height: 15, cursor: 'pointer' }} />
                <label htmlFor={`chk-${fn.id}`} style={{ fontSize: '.83rem', cursor: 'pointer', userSelect: 'none' }}>{fn.label}</label>
              </span>
            ))}
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <input type="checkbox" id="chk-admin" checked={form.admin}
                onChange={e => setForm(f => ({ ...f, admin: e.target.checked }))}
                style={{ width: 15, height: 15, cursor: 'pointer' }} />
              <label htmlFor="chk-admin" style={{ fontSize: '.83rem', cursor: 'pointer', userSelect: 'none', fontWeight: 700 }}>Admin</label>
            </span>
          </div>
          <button type="submit" disabled={salvando}
            style={{ padding: '0.55rem 1.1rem', background: '#27ae60', color: '#fff', border: 'none',
              borderRadius: 8, fontWeight: 700, cursor: salvando ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', fontSize: '.9rem', opacity: salvando ? .7 : 1 }}>
            {salvando ? 'Criando...' : '+ Criar'}
          </button>
        </form>
        {formErro && <div className="alert-error" style={{ marginTop: '0.75rem' }}>{formErro}</div>}
      </div>

      {/* ── Lista de usuários ── */}
      <div className="card">
        <h2 style={{ marginBottom: '1rem', fontSize: '1rem' }}>
          Usuários cadastrados {!loading && `(${usuarios.length})`}
        </h2>
        {loading
          ? <div style={{ color: '#888', padding: '1rem' }}>Carregando...</div>
          : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Username</th>
                    <th>Nome</th>
                    <th>Permissão</th>
                    <th>Funções</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'center' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {usuarios.map(u => (
                    <tr key={u.id}>
                      <td style={{ color: '#aaa', fontSize: '.8rem' }}>{u.id}</td>
                      <td style={{ fontWeight: 600 }}>{u.username}</td>
                      <td>{u.nome || '—'}</td>
                      <td><BadgeAdmin admin={u.admin} /></td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {FUNCOES.map(fn => {
                          const tem = (u.funcoes || []).includes(fn.id)
                          return (
                            <span
                              key={fn.id}
                              onClick={() => toggleFuncao(u, fn.id)}
                              title={tem ? `Remover função ${fn.label}` : `Atribuir função ${fn.label}`}
                              style={{
                                padding: '1px 8px', borderRadius: 10, fontSize: '.72rem', fontWeight: 600,
                                marginRight: 4, cursor: 'pointer', userSelect: 'none',
                                background: tem ? fn.bg : '#f5f5f5',
                                color: tem ? fn.cor : '#bbb',
                                border: tem ? `1px solid ${fn.cor}33` : '1px dashed #ddd',
                              }}
                            >
                              {fn.label}
                            </span>
                          )
                        })}
                      </td>
                      <td><BadgeAtivo ativo={u.ativo} /></td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center' }}>
                          <ActionBtn
                            label={u.ativo ? 'Desativar' : 'Ativar'}
                            color={u.ativo ? '#e67e22' : '#27ae60'}
                            onClick={() => toggleAtivo(u)}
                            disabled={u.username === user?.username}
                          />
                          <ActionBtn
                            label={u.admin ? 'Remover admin' : 'Tornar admin'}
                            color="#2980b9"
                            onClick={() => toggleAdmin(u)}
                            disabled={u.username === user?.username}
                          />
                          <ActionBtn
                            label="Excluir"
                            color="#e74c3c"
                            onClick={() => excluir(u)}
                            disabled={u.username === user?.username}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </div>
    </div>
  )
}

const labelStyle = { display: 'block', fontSize: '.8rem', fontWeight: 600, color: '#555', marginBottom: '0.3rem' }
const inputStyle = {
  width: '100%', padding: '0.55rem 0.75rem', borderRadius: 8,
  border: '1.5px solid #d1d5db', fontSize: '.9rem', fontFamily: 'inherit', outline: 'none',
}

function ActionBtn({ label, color, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        padding: '0.3rem 0.65rem', border: `1.5px solid ${color}`, borderRadius: 6,
        background: 'transparent', color, fontSize: '.78rem', fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .35 : 1,
        fontFamily: 'inherit', transition: 'background .12s',
      }}
      onMouseEnter={e => { if (!disabled) { e.target.style.background = color; e.target.style.color = '#fff' } }}
      onMouseLeave={e => { e.target.style.background = 'transparent'; e.target.style.color = color }}
    >
      {label}
    </button>
  )
}
