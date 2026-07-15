import { useState, useEffect, useRef } from 'react'
import axios from 'axios'

const SUBABAS = [
  { id: 'visao',    label: 'Visão Geral' },
  { id: 'onus',     label: 'ONUs' },
  { id: 'portas',   label: 'Portas' },
  { id: 'clientes', label: 'Clientes Fibra' },
]

const COLETAS = [
  { tipo: 'completo',       label: 'Coleta completa' },
  { tipo: 'ocupacao',       label: 'Ocupação' },
  { tipo: 'onus',           label: 'ONUs' },
  { tipo: 'macs',           label: 'MACs' },
  { tipo: 'clientes_fibra', label: 'Clientes fibra' },
]

function badgeSinal(sig) {
  if (sig === null || sig === undefined) return { txt: '—', bg: '#eee', cor: '#999' }
  if (sig >= -27) return { txt: sig.toFixed(1), bg: '#e8f8e8', cor: '#1a7a44' }
  if (sig >= -29) return { txt: sig.toFixed(1), bg: '#fef3e2', cor: '#9c5700' }
  return { txt: sig.toFixed(1), bg: '#fde8e8', cor: '#c0392b' }
}

function dataHora(iso) {
  return iso ? new Date(iso).toLocaleString('pt-BR') : '—'
}

export default function Olt() {
  const [sub, setSub] = useState('visao')
  const [overview, setOverview] = useState(null)
  const [jobs, setJobs] = useState([])
  const [erro, setErro] = useState(null)
  const [aviso, setAviso] = useState(null)
  const pollRef = useRef(null)

  const carregarOverview = () => {
    axios.get('/api/olt/overview')
      .then(r => setOverview(r.data))
      .catch(e => setErro(e.response?.data?.detail || e.message))
  }

  const carregarJobs = () => {
    axios.get('/api/olt/jobs', { params: { limit: 8 } })
      .then(r => {
        setJobs(r.data)
        const rodando = r.data.some(j => j.status === 'running')
        if (!rodando && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; carregarOverview() }
      })
      .catch(() => {})
  }

  useEffect(() => {
    carregarOverview()
    carregarJobs()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  const dispararColeta = async (tipo) => {
    setErro(null); setAviso(null)
    try {
      const r = await axios.post(`/api/olt/sync/${tipo}`)
      setAviso(r.data.message)
      carregarJobs()
      if (!pollRef.current) pollRef.current = setInterval(carregarJobs, 5000)
    } catch (e) {
      setErro(e.response?.data?.detail || e.message)
    }
  }

  const algumRodando = jobs.some(j => j.status === 'running')

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <div className="page-header">
        <h1>OLT — Gestão de Fibra</h1>
        <div className="page-actions">
          {overview?.ultima_coleta && (
            <span style={{ fontSize: '.8rem', color: '#888', marginRight: '0.5rem' }}>
              Última coleta: {dataHora(overview.ultima_coleta)}
            </span>
          )}
        </div>
      </div>

      {erro  && <div className="alert-error">{erro}</div>}
      {aviso && <div className="alert-success">{aviso}</div>}

      {/* Botões de coleta */}
      <div className="card" style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '.85rem', fontWeight: 600, color: '#4a3670', marginRight: '.3rem' }}>
          Atualizar dados da OLT:
        </span>
        {COLETAS.map(c => (
          <button key={c.tipo} className="btn-sync" onClick={() => dispararColeta(c.tipo)}
            disabled={algumRodando && c.tipo !== 'clientes_fibra'}>
            {c.label}
          </button>
        ))}
        {algumRodando && <span style={{ fontSize: '.82rem', color: '#9c5700' }}>⏳ coleta em andamento…</span>}
      </div>

      {/* Histórico de jobs */}
      {jobs.length > 0 && (
        <div className="card">
          <div style={{ fontSize: '.85rem', fontWeight: 700, color: '#4a3670', marginBottom: '.5rem' }}>Coletas recentes</div>
          <div className="table-wrapper" style={{ maxHeight: 160 }}>
            <table>
              <thead><tr><th>Tipo</th><th>Status</th><th>Detalhe</th><th>Início</th><th>Fim</th><th>Por</th></tr></thead>
              <tbody>
                {jobs.map(j => (
                  <tr key={j.id}>
                    <td>{j.tipo}</td>
                    <td>
                      <span style={{
                        padding: '1px 7px', borderRadius: 8, fontSize: '.72rem', fontWeight: 600,
                        background: j.status === 'done' ? '#e8f8e8' : j.status === 'failed' ? '#fde8e8' : '#fef3e2',
                        color: j.status === 'done' ? '#1a7a44' : j.status === 'failed' ? '#c0392b' : '#9c5700',
                      }}>{j.status}</span>
                    </td>
                    <td style={{ fontSize: '.76rem', color: '#666', maxWidth: 360, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={j.detalhe || ''}>{j.detalhe || '—'}</td>
                    <td style={{ fontSize: '.76rem', whiteSpace: 'nowrap' }}>{dataHora(j.iniciado_em)}</td>
                    <td style={{ fontSize: '.76rem', whiteSpace: 'nowrap' }}>{dataHora(j.terminado_em)}</td>
                    <td style={{ fontSize: '.76rem' }}>{j.usuario}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sub-abas */}
      <div className="cidade-tabs">
        {SUBABAS.map(s => (
          <button key={s.id} className={'cidade-tab' + (sub === s.id ? ' active' : '')} onClick={() => setSub(s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      {overview?.sem_dados && (
        <div className="card" style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>
          Nenhum dado da OLT ainda. Clique em <strong>Coleta completa</strong> acima
          (a primeira leva alguns minutos — a coleta de MACs é a mais demorada).
        </div>
      )}

      {!overview?.sem_dados && sub === 'visao'    && <VisaoGeral overview={overview} />}
      {!overview?.sem_dados && sub === 'onus'     && <TabelaOnus />}
      {!overview?.sem_dados && sub === 'portas'   && <TabelaPortas />}
      {!overview?.sem_dados && sub === 'clientes' && <TabelaClientes />}
    </div>
  )
}

function VisaoGeral({ overview }) {
  if (!overview) return null
  const s = overview.sistema
  const KPIS = [
    { label: 'ONUs total',     valor: overview.total },
    { label: 'Offline',        valor: overview.offline,       cor: '#c0392b' },
    { label: 'Sem MAC',        valor: overview.sem_mac,       cor: '#9c5700' },
    { label: 'Sem cliente',    valor: overview.sem_cliente,   cor: '#6c3483' },
    { label: 'Sinal -27 a -29', valor: overview.sinal_alerta, cor: '#9c5700' },
    { label: 'Sinal < -29',    valor: overview.sinal_critico, cor: '#c0392b' },
  ]
  return (
    <>
      <div className="kpi-row">
        {KPIS.map(k => (
          <div key={k.label} className="kpi-card">
            <div className="kpi-value" style={k.cor ? { color: k.cor } : undefined}>{k.valor}</div>
            <div className="kpi-label">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="charts-row">
        {/* Sistema */}
        <div className="card">
          <h2 style={{ fontSize: '.95rem', fontWeight: 600, color: '#4a3670', marginBottom: '.8rem' }}>Sistema</h2>
          {s ? (
            <div style={{ fontSize: '.85rem', lineHeight: 1.9 }}>
              <div><strong>Versão ISAM:</strong> {s.isam_release}</div>
              <div><strong>Uptime:</strong> {s.uptime_days}d {s.uptime_hours}h {s.uptime_minutes}m</div>
              <div style={{ marginTop: '.6rem', fontWeight: 600, color: '#4a3670' }}>Slots</div>
              {overview.slots.map(sl => (
                <div key={sl.slot_name} style={{ fontSize: '.8rem', color: '#555' }}>
                  {sl.slot_name} — {sl.actual_type} · {sl.availability}
                  {sl.restart_count > 0 && <span style={{ color: '#9c5700' }}> · {sl.restart_count} restarts</span>}
                </div>
              ))}
            </div>
          ) : <div style={{ color: '#999' }}>Sem dados de sistema.</div>}
        </div>

        {/* Temperaturas + top portas */}
        <div className="card">
          <h2 style={{ fontSize: '.95rem', fontWeight: 600, color: '#4a3670', marginBottom: '.8rem' }}>Temperaturas</h2>
          <div className="table-wrapper" style={{ maxHeight: 140, marginBottom: '1rem' }}>
            <table>
              <thead><tr><th>Slot</th><th>Sensor</th><th>°C</th><th>Alarme</th></tr></thead>
              <tbody>
                {overview.temperaturas.map((t, i) => (
                  <tr key={i}>
                    <td>{t.slot_name}</td><td>{t.sensor_id}</td>
                    <td style={{ fontWeight: 600, color: t.status === 'critico' ? '#c0392b' : t.status === 'alerta' ? '#9c5700' : '#1a7a44' }}>{t.actual_temp}</td>
                    <td style={{ fontSize: '.78rem' }}>{t.tca_high}°</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2 style={{ fontSize: '.95rem', fontWeight: 600, color: '#4a3670', marginBottom: '.5rem' }}>Portas mais ocupadas</h2>
          {overview.top_portas.map((p, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: '.35rem' }}>
              <span style={{ fontSize: '.8rem', width: 70 }}>slot {p.slot}/{p.port}</span>
              <div style={{ flex: 1, background: '#efeaf7', borderRadius: 6, height: 14, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, (p.users_connected / 128) * 100)}%`, height: '100%', background: 'var(--roxo)' }} />
              </div>
              <span style={{ fontSize: '.78rem', width: 60 }}>{p.users_connected}/128</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

function TabelaOnus() {
  const [onus, setOnus] = useState([])
  const [busca, setBusca] = useState('')
  const [estado, setEstado] = useState('')
  const [loading, setLoading] = useState(true)

  const carregar = () => {
    setLoading(true)
    axios.get('/api/olt/onus', { params: { busca, estado } })
      .then(r => setOnus(r.data)).finally(() => setLoading(false))
  }
  useEffect(() => { const t = setTimeout(carregar, 300); return () => clearTimeout(t) }, [busca, estado])  // eslint-disable-line

  return (
    <div className="card">
      <div className="table-header">
        <h2 style={{ color: 'var(--roxo)' }}>ONUs {!loading && `(${onus.length})`}</h2>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
          <select className="select-periodo select-periodo--sm" value={estado} onChange={e => setEstado(e.target.value)}>
            <option value="">Todos os estados</option>
            <option value="up">Online (up)</option>
            <option value="down">Offline (down)</option>
          </select>
          <input className="filtro-input" placeholder="Buscar serial, nome, MAC…" value={busca}
            onChange={e => setBusca(e.target.value)} style={{ minWidth: 200 }} />
        </div>
      </div>
      <div className="table-wrapper" style={{ maxHeight: 520 }}>
        <table>
          <thead>
            <tr><th>PON / Pos.</th><th>Serial</th><th>MAC</th><th>Estado</th><th>Sinal (dBm)</th><th>Cliente</th><th>Descrição</th></tr>
          </thead>
          <tbody>
            {onus.map(o => {
              const b = badgeSinal(o.olt_rx_sig)
              return (
                <tr key={o.id}>
                  <td style={{ whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: '.78rem' }}>{o.pon}/{o.position}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '.78rem' }}>{o.serial}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '.76rem', color: o.mac ? '#333' : '#c99' }}>{o.mac || 'sem MAC'}</td>
                  <td>
                    <span style={{ padding: '1px 7px', borderRadius: 8, fontSize: '.72rem', fontWeight: 600,
                      background: o.oper_state === 'up' ? '#e8f8e8' : '#fde8e8', color: o.oper_state === 'up' ? '#1a7a44' : '#c0392b' }}>
                      {o.oper_state}
                    </span>
                  </td>
                  <td><span style={{ padding: '1px 7px', borderRadius: 8, fontSize: '.72rem', fontWeight: 700, background: b.bg, color: b.cor }}>{b.txt}</span></td>
                  <td>{o.cliente_fibra ? '✅' : '—'}</td>
                  <td style={{ fontSize: '.8rem' }}>{o.desc1 || '—'}</td>
                </tr>
              )
            })}
            {!loading && onus.length === 0 && <tr><td colSpan={7} className="sem-resultado">Nenhuma ONU.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TabelaPortas() {
  const [portas, setPortas] = useState([])
  useEffect(() => { axios.get('/api/olt/portas').then(r => setPortas(r.data)) }, [])
  return (
    <div className="card">
      <h2 style={{ color: 'var(--roxo)', marginBottom: '1rem' }}>Ocupação das portas ({portas.length})</h2>
      <div className="table-wrapper">
        <table>
          <thead><tr><th>Slot</th><th>Porta</th><th>ONUs</th><th>Ocupação</th></tr></thead>
          <tbody>
            {portas.map((p, i) => (
              <tr key={i}>
                <td>{p.slot}</td><td>{p.port}</td><td>{p.users_connected}</td>
                <td style={{ minWidth: 220 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                    <div style={{ flex: 1, background: '#efeaf7', borderRadius: 6, height: 12, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(100, (p.users_connected / 128) * 100)}%`, height: '100%',
                        background: p.users_connected >= 115 ? '#c0392b' : p.users_connected >= 90 ? '#9c5700' : 'var(--roxo)' }} />
                    </div>
                    <span style={{ fontSize: '.75rem', width: 48 }}>{Math.round((p.users_connected / 128) * 100)}%</span>
                  </div>
                </td>
              </tr>
            ))}
            {portas.length === 0 && <tr><td colSpan={4} className="sem-resultado">Nenhuma porta com ONUs.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TabelaClientes() {
  const [clientes, setClientes] = useState([])
  const [busca, setBusca] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true)
      axios.get('/api/olt/clientes-fibra', { params: { busca } }).then(r => setClientes(r.data)).finally(() => setLoading(false))
    }, 300)
    return () => clearTimeout(t)
  }, [busca])
  return (
    <div className="card">
      <div className="table-header">
        <h2 style={{ color: 'var(--roxo)' }}>Clientes Fibra {!loading && `(${clientes.length})`}</h2>
        <input className="filtro-input" placeholder="Buscar nome, MAC, endereço…" value={busca}
          onChange={e => setBusca(e.target.value)} style={{ minWidth: 220 }} />
      </div>
      <div className="table-wrapper" style={{ maxHeight: 520 }}>
        <table>
          <thead><tr><th>Nome</th><th>MAC</th><th>Endereço</th><th>Caixa FTTH</th></tr></thead>
          <tbody>
            {clientes.map(c => (
              <tr key={c.id}>
                <td>{c.nome || '—'}</td>
                <td style={{ fontFamily: 'monospace', fontSize: '.76rem' }}>{c.mac}</td>
                <td style={{ fontSize: '.8rem' }}>{c.endereco || '—'}</td>
                <td>{c.id_caixa_ftth || '—'}</td>
              </tr>
            ))}
            {!loading && clientes.length === 0 && <tr><td colSpan={4} className="sem-resultado">Nenhum cliente.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
