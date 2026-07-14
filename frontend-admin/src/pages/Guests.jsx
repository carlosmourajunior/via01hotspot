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

// Badge "Enviado" com a mensagem no hover (tooltip nativo do navegador)
function BadgeEnvio({ mensagem, quando }) {
  if (!mensagem) return <span style={{ color: '#b9aed0', fontSize: '.78rem' }}>—</span>
  const data = quando ? new Date(quando).toLocaleDateString('pt-BR') : ''
  return (
    <span
      title={`Mensagem enviada${data ? ` em ${data}` : ''}:\n\n${mensagem}`}
      style={{
        padding: '1px 7px', borderRadius: 10, fontSize: '.75rem', fontWeight: 600,
        background: '#e3f0fb', color: '#1a5276', whiteSpace: 'nowrap', cursor: 'help',
      }}
    >
      ✉️ Enviado {data}
    </span>
  )
}

function ModalWhatsApp({ total, enviando, onEnviar, onFechar }) {
  const [msg, setMsg] = useState('')
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
    }}>
      <div style={{
        background: '#fff', borderRadius: 12, padding: '1.5rem', width: '100%',
        maxWidth: 520, boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        <h2 style={{ margin: '0 0 .25rem', fontSize: '1.1rem' }}>
          📨 Enviar WhatsApp para {total} contato{total > 1 ? 's' : ''}
        </h2>
        <p style={{ margin: '0 0 1rem', fontSize: '.82rem', color: '#7f8c8d' }}>
          Use <code style={{ background: '#f0f0f0', padding: '0 4px', borderRadius: 4 }}>{'{nome}'}</code>{' '}
          para incluir o primeiro nome do contato na mensagem.
        </p>
        <textarea
          value={msg}
          onChange={e => setMsg(e.target.value)}
          placeholder={'Olá {nome}! A Via01 tem uma oferta especial de internet fibra para você…'}
          rows={6}
          autoFocus
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'vertical',
            padding: '.7rem .8rem', borderRadius: 8, border: '1px solid #d5dbdb',
            fontFamily: 'inherit', fontSize: '.9rem',
          }}
        />
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem',
        }}>
          <span style={{ fontSize: '.78rem', color: '#95a5a6' }}>{msg.trim().length} caracteres</span>
          <div style={{ display: 'flex', gap: '.6rem' }}>
            <button className="btn-secondary" onClick={onFechar} disabled={enviando}>Cancelar</button>
            <button
              className="btn-primary"
              onClick={() => onEnviar(msg)}
              disabled={enviando || msg.trim().length < 3}
            >
              {enviando ? `Enviando… (~${total}s)` : 'Enviar mensagens'}
            </button>
          </div>
        </div>
      </div>
    </div>
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
  const [selecionados, setSelecionados] = useState(new Set())
  const [modalAberto,  setModalAberto]  = useState(false)
  const [enviando,     setEnviando]     = useState(false)

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

  const idsVisiveis = useMemo(() => visiveis.map(g => g.id), [visiveis])
  const todosVisiveisSelecionados = idsVisiveis.length > 0 && idsVisiveis.every(id => selecionados.has(id))

  const toggleUm = (id) => {
    setSelecionados(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  const toggleTodosVisiveis = () => {
    setSelecionados(prev => {
      const s = new Set(prev)
      if (todosVisiveisSelecionados) idsVisiveis.forEach(id => s.delete(id))
      else idsVisiveis.forEach(id => s.add(id))
      return s
    })
  }

  const enviarWhatsApp = (mensagem) => {
    setEnviando(true); setErro(null); setAviso(null)
    axios.post('/api/guests/enviar-whatsapp', {
      ids: Array.from(selecionados),
      message: mensagem,
    }, { timeout: 300000 })
      .then(r => {
        setAviso(r.data.message)
        setModalAberto(false)
        setSelecionados(new Set())
      })
      .catch(e => setErro(e.response?.data?.detail || e.message))
      .finally(() => setEnviando(false))
  }

  const KPIS = [
    { id: 'todos',      label: 'Total de acessos', valor: lista.length },
    { id: 'cliente',    label: 'Clientes Via01',   valor: contagem.cliente },
    { id: 'ex_cliente', label: 'Ex-clientes',      valor: contagem.ex_cliente },
    { id: 'nunca_foi',  label: 'Novos contatos',   valor: contagem.nunca_foi },
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
          <button
            className="btn-primary"
            onClick={() => setModalAberto(true)}
            disabled={selecionados.size === 0}
            title={selecionados.size === 0 ? 'Selecione contatos na tabela' : ''}
          >
            📨 Enviar WhatsApp ({selecionados.size})
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
              outline: filtro === k.id ? '2px solid #3D1278' : 'none',
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
              <th style={{ width: 34 }}>
                <input
                  type="checkbox"
                  checked={todosVisiveisSelecionados}
                  onChange={toggleTodosVisiveis}
                  title="Selecionar todos os visíveis (respeita o filtro atual)"
                  style={{ cursor: 'pointer' }}
                />
              </th>
              <th>Nome</th>
              <th>Telefone</th>
              <th>Classificação</th>
              <th>Contato</th>
              <th>MAC</th>
              <th>Data/Hora</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map(g => (
              <tr key={g.id} style={selecionados.has(g.id) ? { background: '#f0edff' } : undefined}>
                <td>
                  <input
                    type="checkbox"
                    checked={selecionados.has(g.id)}
                    onChange={() => toggleUm(g.id)}
                    style={{ cursor: 'pointer' }}
                  />
                </td>
                <td>{g.name || '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{formatPhone(g.phone)}</td>
                <td><BadgeStatus status={statusDe(g)} /></td>
                <td><BadgeEnvio mensagem={g.ultima_mensagem} quando={g.ultimo_envio} /></td>
                <td style={{ fontFamily: 'monospace', fontSize: '.8rem' }}>{g.mac}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{new Date(g.connected_at).toLocaleString('pt-BR')}</td>
              </tr>
            ))}
            {!loading && visiveis.length === 0 && (
              <tr><td colSpan={7} className="sem-resultado">Nenhum acesso registrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modalAberto && (
        <ModalWhatsApp
          total={selecionados.size}
          enviando={enviando}
          onEnviar={enviarWhatsApp}
          onFechar={() => setModalAberto(false)}
        />
      )}
    </div>
  )
}
