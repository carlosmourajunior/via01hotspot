import { useState, useEffect, useMemo, useRef } from 'react'
import axios from 'axios'
import { useModelos, BarraModelos, ModalModelos, ModalEnvioLeads } from '../components/MensagensLeads'

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

const FONTES = {
  hotspot:  { label: '📶 Hotspot',  bg: '#e8f1fd', cor: '#1b4f9c' },
  planilha: { label: '📄 Planilha', bg: '#fdf2e8', cor: '#8a4b12' },
}

function BadgeFonte({ fonte }) {
  const cfg = FONTES[fonte]
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

function ModalLead({ lead, modelos, onRecarregarModelos, onFechar, onSalvo, onErro }) {
  const [obs, setObs]         = useState(lead.obs || '')
  const [msg, setMsg]         = useState('')
  const [salvando, setSalvando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [avisoEnvio, setAvisoEnvio] = useState(null)
  const [gerenciandoModelos, setGerenciandoModelos] = useState(false)

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
              {formatPhone(lead.phone)} <BadgeLead status={lead.client_status} /> <BadgeFonte fonte={lead.fonte} />
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
          <BarraModelos
            modelos={modelos}
            texto={msg}
            onEscolher={setMsg}
            onSalvo={onRecarregarModelos}
            onGerenciar={() => setGerenciandoModelos(true)}
          />
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

        {gerenciandoModelos && (
          <ModalModelos
            modelos={modelos}
            onFechar={() => setGerenciandoModelos(false)}
            onMudou={onRecarregarModelos}
          />
        )}
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
  const [fonte,   setFonte]   = useState('')
  const [etapaFiltro, setEtapaFiltro] = useState('')
  const [visao,   setVisao]   = useState('kanban')
  const [leadAberto, setLeadAberto] = useState(null)
  const [arrastandoSobre, setArrastandoSobre] = useState(null)
  const [importando, setImportando] = useState(false)
  const [selecionados, setSelecionados] = useState(new Set())
  const [modalEnvio, setModalEnvio] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [gerenciandoModelos, setGerenciandoModelos] = useState(false)
  const inputArquivo = useRef(null)
  const { modelos, recarregar: recarregarModelos } = useModelos()

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

  const importar = (e) => {
    const arquivo = e.target.files?.[0]
    e.target.value = ''  // permite reenviar o mesmo arquivo
    if (!arquivo) return
    const form = new FormData()
    form.append('file', arquivo)
    setImportando(true); setErro(null); setAviso(null)
    axios.post('/api/leads/importar-planilha', form, { timeout: 300000 })
      .then(r => { setAviso(r.data.message); carregar() })
      .catch(e => setErro(e.response?.data?.detail || e.message))
      .finally(() => setImportando(false))
  }

  const lista = leads ?? []
  const filtrados = useMemo(() => {
    const q = busca.toLowerCase()
    return lista.filter(l =>
      (!fonte || l.fonte === fonte) &&
      (!q ||
        (l.name  || '').toLowerCase().includes(q) ||
        (l.phone || '').toLowerCase().includes(q)))
  }, [lista, busca, fonte])

  // A visão em lista tem um filtro de etapa próprio (no kanban a etapa é a coluna)
  const daLista = useMemo(() => (
    etapaFiltro ? filtrados.filter(l => l.etapa === etapaFiltro) : filtrados
  ), [filtrados, etapaFiltro])

  const idsVisiveis = useMemo(() => daLista.map(l => l.id), [daLista])
  const todosVisiveisSelecionados = idsVisiveis.length > 0 && idsVisiveis.every(id => selecionados.has(id))

  const toggleUm = (id) => setSelecionados(prev => {
    const s = new Set(prev)
    s.has(id) ? s.delete(id) : s.add(id)
    return s
  })

  const toggleTodosVisiveis = () => setSelecionados(prev => {
    const s = new Set(prev)
    if (todosVisiveisSelecionados) idsVisiveis.forEach(id => s.delete(id))
    else idsVisiveis.forEach(id => s.add(id))
    return s
  })

  const enviarEmMassa = (mensagem) => {
    setEnviando(true); setErro(null); setAviso(null)
    axios.post('/api/leads/enviar-whatsapp', {
      ids: Array.from(selecionados),
      message: mensagem,
    }, { timeout: 600000 })
      .then(r => {
        setAviso(r.data.message)
        setModalEnvio(false)
        setSelecionados(new Set())
        carregar()
      })
      .catch(e => setErro(e.response?.data?.detail || e.message))
      .finally(() => setEnviando(false))
  }

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
          {/* Alternador de visão: kanban para trabalhar etapa a etapa,
              lista para selecionar vários e disparar mensagem em massa */}
          <div style={{ display: 'flex', border: '1px solid #d5cbe6', borderRadius: 8, overflow: 'hidden' }}>
            {[['kanban', '▦ Kanban'], ['lista', '☰ Lista']].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setVisao(id)}
                style={{
                  padding: '.35rem .8rem', fontSize: '.8rem', fontWeight: 600, border: 'none',
                  cursor: 'pointer', fontFamily: 'inherit',
                  background: visao === id ? '#3D1278' : '#fff',
                  color: visao === id ? '#fff' : '#4a3670',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            className="filtro-input"
            placeholder="Buscar nome ou telefone…"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            style={{ width: 200 }}
          />
          <select className="filtro-input" value={fonte} onChange={e => setFonte(e.target.value)}>
            <option value="">Todas as fontes</option>
            <option value="hotspot">📶 Hotspot</option>
            <option value="planilha">📄 Planilha</option>
          </select>
          <input
            ref={inputArquivo}
            type="file"
            accept=".xlsx,.xls,.xlsm"
            onChange={importar}
            style={{ display: 'none' }}
          />
          <button className="btn-secondary" onClick={() => inputArquivo.current?.click()} disabled={importando || loading}
            title="Importa contatos de uma planilha (modelo Novos_Contatos_Filtrados.xlsx). Clientes ativos são ignorados.">
            {importando ? 'Importando…' : '📄 Importar planilha'}
          </button>
          <button className="btn-secondary" onClick={popular} disabled={loading}
            title="Cria leads a partir dos acessos já registrados no hotspot">
            ⤵ Popular do histórico
          </button>
          <button className="btn-secondary" onClick={carregar} disabled={loading}>
            {loading ? 'Atualizando…' : '↻ Atualizar'}
          </button>
          <button className="btn-secondary" onClick={() => setGerenciandoModelos(true)}
            title="Modelos de mensagem reutilizáveis">
            📋 Modelos
          </button>
          {visao === 'lista' && (
            <button
              className="btn-primary"
              onClick={() => setModalEnvio(true)}
              disabled={selecionados.size === 0}
              title={selecionados.size === 0 ? 'Selecione leads na tabela' : ''}
            >
              📨 Enviar WhatsApp ({selecionados.size})
            </button>
          )}
        </div>
      </div>

      {erro  && <div className="alert-error">{erro}</div>}
      {aviso && <div className="alert-success">{aviso}</div>}

      {visao === 'kanban' && (
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
                    {lead.fonte === 'planilha'
                      ? <BadgeFonte fonte={lead.fonte} />
                      : <span title="Último acesso ao hotspot">📶 {formatData(lead.ultimo_acesso)}</span>}
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
      )}

      {visao === 'lista' && (
        <>
          <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap', margin: '0 0 .8rem' }}>
            <select className="filtro-input" value={etapaFiltro} onChange={e => setEtapaFiltro(e.target.value)}>
              <option value="">Todas as etapas</option>
              {ETAPAS.map(e => (
                <option key={e.id} value={e.id}>{e.label} ({porEtapa[e.id].length})</option>
              ))}
            </select>
            <span style={{ fontSize: '.82rem', color: '#6b5f80' }}>
              {daLista.length} lead(s){selecionados.size > 0 && ` · ${selecionados.size} selecionado(s)`}
            </span>
            {selecionados.size > 0 && (
              <button className="btn-secondary" onClick={() => setSelecionados(new Set())}
                style={{ padding: '.15rem .6rem', fontSize: '.78rem' }}>
                limpar seleção
              </button>
            )}
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
                      title="Selecionar todos os visíveis (respeita os filtros atuais)"
                      style={{ cursor: 'pointer' }}
                    />
                  </th>
                  <th>Nome</th>
                  <th>Telefone</th>
                  <th>Etapa</th>
                  <th>Classificação</th>
                  <th>Origem</th>
                  <th>Último acesso</th>
                  <th>Último contato</th>
                  <th>Observações</th>
                </tr>
              </thead>
              <tbody>
                {daLista.map(lead => (
                  <tr key={lead.id} style={selecionados.has(lead.id) ? { background: '#f0edff' } : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selecionados.has(lead.id)}
                        onChange={() => toggleUm(lead.id)}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                    <td>
                      <button
                        onClick={() => setLeadAberto(lead)}
                        style={{
                          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                          color: '#3D1278', fontWeight: 600, fontFamily: 'inherit', fontSize: 'inherit',
                          textAlign: 'left', textDecoration: 'underline',
                        }}
                      >
                        {lead.name || 'Sem nome'}
                      </button>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatPhone(lead.phone)}</td>
                    <td>
                      {/* Mudar a etapa direto na lista, sem abrir o lead */}
                      <select
                        value={lead.etapa}
                        onChange={e => moverLead(lead.id, e.target.value)}
                        style={{
                          padding: '.15rem .3rem', borderRadius: 6, fontFamily: 'inherit',
                          fontSize: '.78rem', fontWeight: 600, cursor: 'pointer',
                          border: `1px solid ${ETAPAS.find(x => x.id === lead.etapa)?.cor || '#d5cbe6'}`,
                          color: ETAPAS.find(x => x.id === lead.etapa)?.cor || '#4a3670',
                          background: '#fff',
                        }}
                      >
                        {ETAPAS.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
                      </select>
                    </td>
                    <td><BadgeLead status={lead.client_status} /></td>
                    <td><BadgeFonte fonte={lead.fonte} /></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatData(lead.ultimo_acesso)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatData(lead.ultimo_contato)}</td>
                    <td style={{ maxWidth: 260, fontSize: '.8rem', color: '#6b5f80' }} title={lead.obs || ''}>
                      {lead.obs || '—'}
                    </td>
                  </tr>
                ))}
                {!loading && daLista.length === 0 && (
                  <tr><td colSpan={9} className="sem-resultado">Nenhum lead encontrado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {modalEnvio && (
        <ModalEnvioLeads
          total={selecionados.size}
          enviando={enviando}
          modelos={modelos}
          onRecarregarModelos={recarregarModelos}
          onEnviar={enviarEmMassa}
          onFechar={() => setModalEnvio(false)}
        />
      )}

      {gerenciandoModelos && (
        <ModalModelos
          modelos={modelos}
          onFechar={() => setGerenciandoModelos(false)}
          onMudou={recarregarModelos}
        />
      )}

      {leadAberto && (
        <ModalLead
          lead={leadAberto}
          modelos={modelos}
          onRecarregarModelos={recarregarModelos}
          onFechar={() => setLeadAberto(null)}
          onSalvo={aoSalvarLead}
          onErro={e => setErro(e)}
        />
      )}
    </div>
  )
}
