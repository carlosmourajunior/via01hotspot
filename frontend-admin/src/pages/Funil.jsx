import { useState, useEffect, useMemo } from 'react'
import axios from 'axios'

function formatPhone(phone) {
  const d = (phone || '').replace(/\D/g, '')
  const local = d.startsWith('55') ? d.slice(2) : d
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`
  return phone
}

function formatData(iso) {
  return iso ? new Date(iso).toLocaleDateString('pt-BR') : '—'
}

const ETAPAS = [
  { id: 'novo',       label: 'Novo Lead',  cor: '#8e44ad' },
  { id: 'contatado',  label: 'Contatado',  cor: '#2980b9' },
  { id: 'respondeu',  label: 'Respondeu',  cor: '#16a085' },
  { id: 'quente',     label: 'Quente 🔥',  cor: '#e67e22' },
  { id: 'frio',       label: 'Frio ❄️',    cor: '#7f8c8d' },
  { id: 'convertido', label: 'Convertido', cor: '#27ae60' },
]

const STATUS_LEAD = {
  ex_cliente: { label: 'Ex-cliente', bg: '#fef3e2', cor: '#9c5700' },
  nunca_foi:  { label: 'Novo',       bg: '#f3e8fd', cor: '#6c3483' },
  cliente:    { label: 'Cliente',    bg: '#e8f8e8', cor: '#1a5e20' },
}

function BadgeLead({ status }) {
  const cfg = STATUS_LEAD[status]
  if (!cfg) return null
  return (
    <span style={{
      padding: '0 6px', borderRadius: 8, fontSize: '.68rem', fontWeight: 600,
      background: cfg.bg, color: cfg.cor, whiteSpace: 'nowrap',
    }}>
      {cfg.label}
    </span>
  )
}

function ModalLead({ lead, onFechar, onSalvo, onErro }) {
  const [obs, setObs]         = useState(lead.obs || '')
  const [msg, setMsg]         = useState('')
  const [salvando, setSalvando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [avisoEnvio, setAvisoEnvio] = useState(null)

  const salvarObs = () => {
    setSalvando(true)
    axios.patch(`/api/leads/${lead.id}`, { obs })
      .then(r => onSalvo(r.data))
      .catch(e => onErro(e.response?.data?.detail || e.message))
      .finally(() => setSalvando(false))
  }

  const moverPara = (etapa) => {
    axios.patch(`/api/leads/${lead.id}`, { etapa })
      .then(r => { onSalvo(r.data); onFechar() })
      .catch(e => onErro(e.response?.data?.detail || e.message))
  }

  const enviarMsg = () => {
    setEnviando(true); setAvisoEnvio(null)
    axios.post('/api/leads/enviar-whatsapp', { ids: [lead.id], message: msg }, { timeout: 60000 })
      .then(r => {
        setAvisoEnvio(r.data.message)
        setMsg('')
        axios.get('/api/leads').then(() => onSalvo(null))
      })
      .catch(e => onErro(e.response?.data?.detail || e.message))
      .finally(() => setEnviando(false))
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
    }}>
      <div style={{
        background: '#fff', borderRadius: 12, padding: '1.5rem', width: '100%',
        maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.05rem', color: '#3D1278' }}>
              {lead.name || formatPhone(lead.phone)}
            </h2>
            <p style={{ margin: '.2rem 0 0', fontSize: '.85rem', color: '#6b5f80' }}>
              {formatPhone(lead.phone)} <BadgeLead status={lead.client_status} />
            </p>
          </div>
          <button className="btn-secondary" onClick={onFechar} style={{ padding: '.2rem .6rem' }}>✕</button>
        </div>

        <p style={{ fontSize: '.78rem', color: '#6b5f80', margin: '.8rem 0 0' }}>
          Primeiro acesso: {formatData(lead.primeiro_acesso)} · Último acesso: {formatData(lead.ultimo_acesso)}
          {lead.ultimo_contato && <> · Último contato: {formatData(lead.ultimo_contato)}</>}
        </p>

        {/* Mover de etapa */}
        <div style={{ margin: '1rem 0 0' }}>
          <div style={{ fontSize: '.78rem', fontWeight: 600, color: '#4a3670', marginBottom: '.4rem' }}>Mover para</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem' }}>
            {ETAPAS.filter(e => e.id !== lead.etapa).map(e => (
              <button
                key={e.id}
                onClick={() => moverPara(e.id)}
                style={{
                  padding: '.3rem .7rem', fontSize: '.78rem', fontWeight: 600,
                  border: `1px solid ${e.cor}`, color: e.cor, background: '#fff',
                  borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>

        {/* Observações */}
        <div style={{ margin: '1rem 0 0' }}>
          <div style={{ fontSize: '.78rem', fontWeight: 600, color: '#4a3670', marginBottom: '.4rem' }}>
            Observações (retornos, interesse, próximos passos)
          </div>
          <textarea
            value={obs}
            onChange={e => setObs(e.target.value)}
            rows={3}
            style={{
              width: '100%', boxSizing: 'border-box', resize: 'vertical',
              padding: '.6rem .7rem', borderRadius: 8, border: '1px solid #d5cbe6',
              fontFamily: 'inherit', fontSize: '.85rem',
            }}
          />
          <button className="btn-secondary" onClick={salvarObs} disabled={salvando} style={{ marginTop: '.4rem' }}>
            {salvando ? 'Salvando…' : 'Salvar observações'}
          </button>
        </div>

        {/* WhatsApp individual */}
        <div style={{ margin: '1.2rem 0 0', paddingTop: '1rem', borderTop: '1px solid #e5dff0' }}>
          <div style={{ fontSize: '.78rem', fontWeight: 600, color: '#4a3670', marginBottom: '.4rem' }}>
            📨 Enviar WhatsApp (use {'{nome}'} para o primeiro nome)
          </div>
          <textarea
            value={msg}
            onChange={e => setMsg(e.target.value)}
            rows={3}
            placeholder={'Olá {nome}! Tudo bem?'}
            style={{
              width: '100%', boxSizing: 'border-box', resize: 'vertical',
              padding: '.6rem .7rem', borderRadius: 8, border: '1px solid #d5cbe6',
              fontFamily: 'inherit', fontSize: '.85rem',
            }}
          />
          {avisoEnvio && <div className="alert-success" style={{ marginTop: '.5rem', marginBottom: 0 }}>{avisoEnvio}</div>}
          <button className="btn-primary" onClick={enviarMsg} disabled={enviando || msg.trim().length < 3} style={{ marginTop: '.4rem' }}>
            {enviando ? 'Enviando…' : 'Enviar mensagem'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Funil() {
  const [leads,   setLeads]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [erro,    setErro]    = useState(null)
  const [aviso,   setAviso]   = useState(null)
  const [busca,   setBusca]   = useState('')
  const [leadAberto, setLeadAberto] = useState(null)
  const [arrastandoSobre, setArrastandoSobre] = useState(null)

  const carregar = () => {
    setLoading(true); setErro(null)
    axios.get('/api/leads')
      .then(r => setLeads(r.data))
      .catch(e => setErro(e.response?.data?.detail || e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { carregar() }, [])

  const popular = () => {
    setLoading(true); setErro(null); setAviso(null)
    axios.post('/api/leads/backfill', {}, { timeout: 120000 })
      .then(r => { setAviso(r.data.message); carregar() })
      .catch(e => { setErro(e.response?.data?.detail || e.message); setLoading(false) })
  }

  const lista = leads ?? []
  const filtrados = useMemo(() => {
    if (!busca) return lista
    const q = busca.toLowerCase()
    return lista.filter(l =>
      (l.name  || '').toLowerCase().includes(q) ||
      (l.phone || '').toLowerCase().includes(q))
  }, [lista, busca])

  const porEtapa = useMemo(() => {
    const m = Object.fromEntries(ETAPAS.map(e => [e.id, []]))
    filtrados.forEach(l => { (m[l.etapa] || m.novo).push(l) })
    return m
  }, [filtrados])

  const moverLead = (leadId, etapa) => {
    const lead = lista.find(l => l.id === leadId)
    if (!lead || lead.etapa === etapa) return
    // Otimista: move na tela e confirma na API
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, etapa } : l))
    axios.patch(`/api/leads/${leadId}`, { etapa })
      .catch(e => { setErro(e.response?.data?.detail || e.message); carregar() })
  }

  const aoSalvarLead = (leadAtualizado) => {
    if (leadAtualizado) {
      setLeads(prev => prev.map(l => l.id === leadAtualizado.id ? leadAtualizado : l))
      setLeadAberto(leadAtualizado)
    } else {
      carregar()
    }
  }

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <div className="page-header">
        <h1>Funil de Vendas — Hotspot</h1>
        <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="filtro-input"
            placeholder="Buscar nome ou telefone…"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            style={{ width: 200 }}
          />
          <button className="btn-secondary" onClick={popular} disabled={loading}
            title="Cria leads a partir dos acessos já registrados no hotspot">
            ⤵ Popular do histórico
          </button>
          <button className="btn-secondary" onClick={carregar} disabled={loading}>
            {loading ? 'Atualizando…' : '↻ Atualizar'}
          </button>
        </div>
      </div>

      {erro  && <div className="alert-error">{erro}</div>}
      {aviso && <div className="alert-success">{aviso}</div>}

      <div className="funil-board">
        {ETAPAS.map(etapa => (
          <div
            key={etapa.id}
            className="funil-col"
            style={arrastandoSobre === etapa.id ? { background: '#efe8fa' } : undefined}
            onDragOver={e => { e.preventDefault(); setArrastandoSobre(etapa.id) }}
            onDragLeave={() => setArrastandoSobre(null)}
            onDrop={e => {
              e.preventDefault()
              setArrastandoSobre(null)
              const id = Number(e.dataTransfer.getData('text/plain'))
              if (id) moverLead(id, etapa.id)
            }}
          >
            <div className="funil-col-header" style={{ borderTopColor: etapa.cor }}>
              <span>{etapa.label}</span>
              <span className="funil-col-count" style={{ background: etapa.cor }}>
                {porEtapa[etapa.id].length}
              </span>
            </div>
            <div className="funil-col-cards">
              {porEtapa[etapa.id].map(lead => (
                <div
                  key={lead.id}
                  className="funil-card"
                  draggable
                  onDragStart={e => e.dataTransfer.setData('text/plain', String(lead.id))}
                  onClick={() => setLeadAberto(lead)}
                >
                  <div className="funil-card-nome">{lead.name || 'Sem nome'}</div>
                  <div className="funil-card-fone">{formatPhone(lead.phone)}</div>
                  <div className="funil-card-meta">
                    <BadgeLead status={lead.client_status} />
                    <span title="Último acesso ao hotspot">📶 {formatData(lead.ultimo_acesso)}</span>
                  </div>
                  {lead.obs && <div className="funil-card-obs" title={lead.obs}>💬 {lead.obs}</div>}
                </div>
              ))}
              {porEtapa[etapa.id].length === 0 && (
                <div className="funil-col-vazia">—</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {leadAberto && (
        <ModalLead
          lead={leadAberto}
          onFechar={() => setLeadAberto(null)}
          onSalvo={aoSalvarLead}
          onErro={e => setErro(e)}
        />
      )}
    </div>
  )
}
