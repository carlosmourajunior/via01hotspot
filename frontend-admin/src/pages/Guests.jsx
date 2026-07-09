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

function BadgeTipo({ isClient }) {
  return (
    <span style={{
      padding: '1px 7px', borderRadius: 10, fontSize: '.75rem', fontWeight: 600,
      background: isClient ? '#e8f8e8' : '#f3e8fd',
      color:      isClient ? '#1a5e20' : '#6c3483',
    }}>
      {isClient ? 'Cliente Via01' : 'Lead'}
    </span>
  )
}

export default function Guests() {
  const [guests,  setGuests]  = useState(null)
  const [loading, setLoading] = useState(false)
  const [erro,    setErro]    = useState(null)
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

  const lista    = guests ?? []
  const clientes = lista.filter(g => g.is_client).length
  const leads    = lista.length - clientes

  const visiveis = useMemo(() => {
    let r = lista
    if (filtro === 'clientes') r = r.filter(g => g.is_client)
    if (filtro === 'leads')    r = r.filter(g => !g.is_client)
    if (busca) {
      const q = busca.toLowerCase()
      r = r.filter(g =>
        (g.phone || '').toLowerCase().includes(q) ||
        (g.mac   || '').toLowerCase().includes(q))
    }
    return r
  }, [lista, filtro, busca])

  const KPIS = [
    { id: 'todos',    label: 'Total de acessos', valor: lista.length },
    { id: 'clientes', label: 'Clientes Via01',   valor: clientes },
    { id: 'leads',    label: 'Possíveis leads',  valor: leads },
  ]

  return (
    <div className="page">
      <div className="page-header">
        <h1>Wi-Fi Guests — Hotspot</h1>
        <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="filtro-input"
            placeholder="Buscar telefone ou MAC…"
            value={busca}
            onChange={e => setBusca(e.target.value)}
          />
          <button className="btn-secondary" onClick={carregar} disabled={loading}>
            {loading ? 'Atualizando…' : '↻ Atualizar'}
          </button>
        </div>
      </div>

      {erro && <div className="alert-error">{erro}</div>}

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
              <th>Telefone</th>
              <th>Tipo</th>
              <th>MAC</th>
              <th>AP</th>
              <th>Data/Hora</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map(g => (
              <tr key={g.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{formatPhone(g.phone)}</td>
                <td><BadgeTipo isClient={g.is_client} /></td>
                <td style={{ fontFamily: 'monospace', fontSize: '.8rem' }}>{g.mac}</td>
                <td style={{ fontFamily: 'monospace', fontSize: '.8rem' }}>{g.ap || '—'}</td>
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
