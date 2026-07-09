import { useState, useEffect, useMemo } from 'react'
import axios from 'axios'

function formatPhone(phone) {
  const d = (phone || '').replace(/\D/g, '')
  // 55 + DDD + número → (DDD) XXXXX-XXXX
  const local = d.startsWith('55') ? d.slice(2) : d
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`
  return phone
}

// Status vindo da classificação IXC; registros antigos sem client_status
// caem no is_client marcado pelo próprio visitante no sistema anterior
function statusDe(g) {
  if (g.client_status) return g.client_status
  return g.is_client ? 'cliente' : 'sem_classificacao'
}

const STATUS_CFG = {
  cliente:           { label: 'Cliente Via01', bg: '#e8f8e8', cor: '#1a5e20' },
  ex_cliente:        { label: 'Ex-cliente',    bg: '#fef3e2', cor: '#9c5700' },
  nunca_foi:         { label: 'Nunca foi',     bg: '#f3e8fd', cor: '#6c3483' },
  sem_classificacao: { label: 'Sem classificação', bg: '#eef1f4', cor: '#5d6d7e' },
}

function BadgeStatus({ status }) {
  const cfg = STATUS_CFG[status] || STATUS_CFG.sem_classificacao
  return (
    <span style={{
      padding: '1px 7px', borderRadius: 10, fontSize: '.75rem', fontWeight: 600,
      background: cfg.bg, color: cfg.cor, whiteSpace: 'nowrap',
    }}>
      {cfg.label}
    </span>
  )
}

export default function Guests() {
  const [guests,  setGuests]  = useState(null)
  const [loading, setLoading] = useState(false)
  const [reclass, setReclass] = useState(false)
  const [erro,    setErro]    = useState(null)
  const [aviso,   setAviso]   = useState(null)
  const [filtro,  setFiltro]  = useState('todos')
  const [busca,   setBusca]   = useState('')

  const carregar = () => {
    setLoading(true); setErro(null)
    axios.get('/api/guests')
      .then(r => setGuests(r.data))
      .catch(e => setErro(e.response?.data?.detail || e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { carregar() }, [])

  const reclassificar = () => {
    setReclass(true); setErro(null); setAviso(null)
    axios.post('/api/guests/reclassificar')
      .then(r => { setAviso(r.data.message); carregar() })
      .catch(e => setErro(e.response?.data?.detail || e.message))
      .finally(() => setReclass(false))
  }

  const lista = guests ?? []
  const contagem = useMemo(() => {
    const c = { cliente: 0, ex_cliente: 0, nunca_foi: 0, sem_classificacao: 0 }
    lista.forEach(g => { c[statusDe(g)] = (c[statusDe(g)] || 0) + 1 })
    return c
  }, [lista])

  const visiveis = useMemo(() => {
    let r = lista
    if (filtro !== 'todos') r = r.filter(g => statusDe(g) === filtro)
    if (busca) {
      const q = busca.toLowerCase()
      r = r.filter(g =>
        (g.phone || '').toLowerCase().includes(q) ||
        (g.name  || '').toLowerCase().includes(q) ||
        (g.mac   || '').toLowerCase().includes(q))
    }
    return r
  }, [lista, filtro, busca])

  const KPIS = [
    { id: 'todos',      label: 'Total de acessos', valor: lista.length },
    { id: 'cliente',    label: 'Clientes Via01',   valor: contagem.cliente },
    { id: 'ex_cliente', label: 'Ex-clientes',      valor: contagem.ex_cliente },
    { id: 'nunca_foi',  label: 'Nunca foram',      valor: contagem.nunca_foi },
  ]

  return (
    <div className="page">
      <div className="page-header">
        <h1>Wi-Fi Guests — Hotspot</h1>
        <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="filtro-input"
            placeholder="Buscar nome, telefone ou MAC…"
            value={busca}
            onChange={e => setBusca(e.target.value)}
          />
          <button className="btn-secondary" onClick={reclassificar} disabled={reclass}
            title="Reclassifica todos os acessos contra a base IXC (rode os syncs antes)">
            {reclass ? 'Reclassificando…' : '⟳ Reclassificar'}
          </button>
          <button className="btn-secondary" onClick={carregar} disabled={loading}>
            {loading ? 'Atualizando…' : '↻ Atualizar'}
          </button>
        </div>
      </div>

      {erro  && <div className="alert-error">{erro}</div>}
      {aviso && <div className="alert-success">{aviso}</div>}

      <div className="kpi-row">
        {KPIS.map(k => (
          <div
            key={k.id}
            className="kpi-card"
            onClick={() => setFiltro(k.id)}
            style={{
              cursor: 'pointer',
              outline: filtro === k.id ? '2px solid #6c5ce7' : 'none',
            }}
          >
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value">{k.valor}</div>
          </div>
        ))}
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Telefone</th>
              <th>Classificação</th>
              <th>MAC</th>
              <th>Data/Hora</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map(g => (
              <tr key={g.id}>
                <td>{g.name || '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{formatPhone(g.phone)}</td>
                <td><BadgeStatus status={statusDe(g)} /></td>
                <td style={{ fontFamily: 'monospace', fontSize: '.8rem' }}>{g.mac}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{new Date(g.connected_at).toLocaleString('pt-BR')}</td>
              </tr>
            ))}
            {!loading && visiveis.length === 0 && (
              <tr><td colSpan={5} className="sem-resultado">Nenhum acesso registrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
