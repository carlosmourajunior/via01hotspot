import { useState, useEffect, useMemo } from 'react'
import axios from 'axios'
import {
  BarChart, Bar, ComposedChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

const MESES       = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
const MESES_ABREV = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
const ANO_ATUAL   = new Date().getFullYear()

const CIDADES = [
  { id: 'todas',         label: '🏢 Via01 — Total' },
  { id: 'borda_mata',    label: 'Borda da Mata' },
  { id: 'ouro_fino',     label: 'Ouro Fino' },
  { id: 'inconfidentes', label: 'Inconfidentes' },
]

const COR_VENDAS      = '#27ae60'
const COR_CANC        = '#e74c3c'
const COR_CRESCIMENTO = '#2980b9'

const inStyle = {
  padding: '0.4rem 0.6rem', borderRadius: 6,
  border: '1.5px solid #d1d5db', fontSize: '.85rem',
  fontFamily: 'inherit', outline: 'none',
}

function BadgeAtivo({ ativo }) {
  const ok = ativo === 'S'
  return (
    <span style={{
      padding: '1px 7px', borderRadius: 10, fontSize: '.75rem', fontWeight: 600,
      background: ok ? '#e8f8e8' : '#fde8e8',
      color:      ok ? '#1a5e20' : '#7d1010',
    }}>
      {ok ? 'Ativo' : 'Inativo'}
    </span>
  )
}

function BadgeManual() {
  return (
    <span style={{
      padding: '1px 6px', borderRadius: 8, fontSize: '.7rem', fontWeight: 700,
      background: '#fef9c3', color: '#92400e', marginLeft: 5, verticalAlign: 'middle',
    }}>
      Manual
    </span>
  )
}

function BadgeValidado() {
  return (
    <span title="Validado manualmente como nova instalação" style={{
      padding: '1px 6px', borderRadius: 8, fontSize: '.7rem', fontWeight: 700,
      background: '#e0f5eb', color: '#1a7a44', marginLeft: 5, verticalAlign: 'middle',
    }}>
      Validado
    </span>
  )
}

function BadgePontoAdicional() {
  return (
    <span title="Cliente antigo que contratou mais um ponto (login novo criado junto deste contrato)" style={{
      padding: '1px 6px', borderRadius: 8, fontSize: '.7rem', fontWeight: 700,
      background: '#e3f0fb', color: '#1a5276', marginLeft: 5, verticalAlign: 'middle',
    }}>
      Ponto adicional
    </span>
  )
}

function BtnLixeira({ onClick }) {
  return (
    <button onClick={onClick} title="Remover da lista"
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e74c3c',
        fontSize: '1rem', padding: '0 0.15rem', lineHeight: 1 }}>
      🗑
    </button>
  )
}

function toDate(s) {
  if (!s) return null
  const d = new Date(s + 'T00:00:00')
  return isNaN(d) ? null : d
}

function useIXCData(url, cidade) {
  const [dados,   setDados]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [erro,    setErro]    = useState(null)

  const carregar = (orig = cidade) => {
    setLoading(true)
    setErro(null)
    axios.get(`${url}?origem=${orig}`)
      .then(r => { setDados(r.data); setLoading(false) })
      .catch(e => { setErro(e.response?.data?.detail || e.message); setLoading(false) })
  }

  return { dados, loading, erro, carregar }
}

function useKpis(registros, campoDt, mesFiltro, anoFiltro, anoGrafico) {
  return useMemo(() => {
    const hoje = new Date()
    const limite7 = new Date()
    limite7.setDate(hoje.getDate() - 7)
    limite7.setHours(0, 0, 0, 0)

    const doMes = []
    const ultimos7 = []
    let totalAno = 0
    const contagem = Array(12).fill(0)

    for (const r of registros) {
      const d = toDate(r[campoDt])
      if (!d) continue
      if (d.getFullYear() === anoFiltro && d.getMonth() === mesFiltro) doMes.push(r)
      if (d >= limite7) ultimos7.push(r)
      if (d.getFullYear() === anoFiltro) totalAno++
      if (d.getFullYear() === anoGrafico) contagem[d.getMonth()]++
    }

    const porMes = MESES_ABREV.map((nome, i) => ({ nome, total: contagem[i] }))
    return { doMes, ultimos7, totalAno, porMes }
  }, [registros, campoDt, mesFiltro, anoFiltro, anoGrafico])
}

function KpiCard({ valor, label, cor }) {
  return (
    <div className="kpi-card">
      <div className="kpi-value" style={cor ? { color: cor } : undefined}>{valor}</div>
      <div className="kpi-label">{label}</div>
    </div>
  )
}

function corCrescimento(n) {
  if (n > 0) return COR_VENDAS
  if (n < 0) return COR_CANC
  return '#888'
}

function SecaoTitulo({ label, cor, bg }) {
  return (
    <div style={{ margin: '1.75rem 0 0.6rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
      <h2 style={{ margin: 0, fontSize: '1.05rem', color: cor }}>{label}</h2>
      <span style={{ height: 2, flex: 1, background: bg, borderRadius: 2 }} />
    </div>
  )
}

const FORM_VENDA_VAZIO = { nome: '', data_ativacao: '', bairro: '', fone: '', obs: '' }
const FORM_CANC_VAZIO  = { nome: '', data_abertura: '',  bairro: '', fone: '', obs: '' }

export default function VendasIXC() {
  const hoje = new Date()

  const [cidade,     setCidade]     = useState('borda_mata')
  const [mesFiltro,  setMesFiltro]  = useState(hoje.getMonth())
  const [anoFiltro,  setAnoFiltro]  = useState(ANO_ATUAL)
  const [anoGrafico, setAnoGrafico] = useState(ANO_ATUAL)

  const [syncing,    setSyncing]    = useState(false)
  const [syncInfo,   setSyncInfo]   = useState(null)
  const [erroGlobal, setErroGlobal] = useState(null)

  const [buscaVendas, setBuscaVendas] = useState('')
  const [buscaCanc,   setBuscaCanc]   = useState('')

  // formulários de inserção manual
  const [addVendaOpen, setAddVendaOpen] = useState(false)
  const [addCancOpen,  setAddCancOpen]  = useState(false)
  const [formVenda,    setFormVenda]    = useState(FORM_VENDA_VAZIO)
  const [formCanc,     setFormCanc]     = useState(FORM_CANC_VAZIO)
  const [salvandoV,    setSalvandoV]    = useState(false)
  const [salvandoC,    setSalvandoC]    = useState(false)
  const [formErroV,    setFormErroV]    = useState(null)
  const [formErroC,    setFormErroC]    = useState(null)

  const { dados: dadosV, loading: loadV, erro: erroV, carregar: carregarV } =
    useIXCData('/api/ixc/vendas', cidade)
  const { dados: dadosC, loading: loadC, erro: erroC, carregar: carregarC } =
    useIXCData('/api/ixc/cancelamentos-ixc', cidade)

  useEffect(() => { carregarV(); carregarC() }, [])

  const handleCidadeChange = (nova) => {
    setCidade(nova)
    setSyncInfo(null)
    setAddVendaOpen(false)
    setAddCancOpen(false)
    carregarV(nova)
    carregarC(nova)
  }

  const handleSync = async () => {
    setSyncing(true)
    setErroGlobal(null)
    try {
      await axios.post('/api/ixc/sync-clientes')
      await axios.post('/api/ixc/sync-contratos')
      await Promise.all([
        axios.post(`/api/ixc/sync-os?ano=${ANO_ATUAL}`),
        axios.post(`/api/ixc/sync-os?ano=${ANO_ATUAL - 1}`),
      ])
      const [resV, resC] = await Promise.all([
        axios.get(`/api/ixc/vendas?origem=${cidade}`),
        axios.get(`/api/ixc/cancelamentos-ixc?origem=${cidade}`),
      ])
      setSyncInfo({ contratos: resV.data.total, cancelamentos: resC.data.total })
      carregarV()
      carregarC()
    } catch (err) {
      setErroGlobal('Erro na sincronização: ' + (err.response?.data?.detail || err.message))
    }
    setSyncing(false)
  }

  // ── handlers manuais ──
  const criarContrato = async (e) => {
    e.preventDefault()
    setSalvandoV(true)
    setFormErroV(null)
    try {
      await axios.post('/api/ixc/contratos-manuais', { ...formVenda, origem: cidade })
      setFormVenda(FORM_VENDA_VAZIO)
      setAddVendaOpen(false)
      carregarV(cidade)
    } catch(err) {
      setFormErroV(err.response?.data?.detail || err.message)
    }
    setSalvandoV(false)
  }

  const excluirContrato = async (source_id) => {
    if (!window.confirm('Remover este contrato manual?')) return
    try {
      await axios.delete(`/api/ixc/contratos-manuais/${source_id}`)
      carregarV(cidade)
    } catch(err) {
      setErroGlobal(err.response?.data?.detail || err.message)
    }
  }

  const criarCancelamento = async (e) => {
    e.preventDefault()
    setSalvandoC(true)
    setFormErroC(null)
    try {
      await axios.post('/api/ixc/cancelamentos-manuais', { ...formCanc, origem: cidade })
      setFormCanc(FORM_CANC_VAZIO)
      setAddCancOpen(false)
      carregarC(cidade)
    } catch(err) {
      setFormErroC(err.response?.data?.detail || err.message)
    }
    setSalvandoC(false)
  }

  const excluirCancelamento = async (source_id) => {
    if (!window.confirm('Remover este cancelamento manual?')) return
    try {
      await axios.delete(`/api/ixc/cancelamentos-manuais/${source_id}`)
      carregarC(cidade)
    } catch(err) {
      setErroGlobal(err.response?.data?.detail || err.message)
    }
  }

  // ── Trilha de ajustes manuais (ocultados / validados / inseridos) ──
  const [mostrarAjustes, setMostrarAjustes] = useState(false)
  const [ajustes, setAjustes] = useState(null)

  const carregarAjustes = async (orig = cidade) => {
    try {
      const r = await axios.get('/api/ixc/ajustes-manuais', { params: { origem: orig } })
      setAjustes(r.data)
    } catch(err) {
      setErroGlobal(err.response?.data?.detail || err.message)
    }
  }

  const toggleAjustes = () => {
    const abrir = !mostrarAjustes
    setMostrarAjustes(abrir)
    if (abrir) carregarAjustes()
  }

  // Painel aberto acompanha a troca de cidade
  useEffect(() => {
    if (mostrarAjustes) { setAjustes(null); carregarAjustes(cidade) }
  }, [cidade])  // eslint-disable-line react-hooks/exhaustive-deps

  const restaurarOculto = async (tipo, source_id, nome) => {
    if (!window.confirm(`Restaurar "${nome || 'este registro'}"? Ele volta à lista da dashboard.`)) return
    try {
      await axios.delete(`/api/ixc/registros-ocultos/${tipo}/${source_id}`)
      carregarAjustes(); carregarV(cidade); carregarC(cidade)
    } catch(err) {
      setErroGlobal(err.response?.data?.detail || err.message)
    }
  }

  const desfazerValidacao = async (tipo, source_id, nome) => {
    if (!window.confirm(`Desfazer a validação de "${nome || 'este registro'}"? Ele volta a seguir a regra automática.`)) return
    try {
      await axios.delete(`/api/ixc/registros-validados/${tipo}/${source_id}`)
      carregarAjustes(); carregarV(cidade)
    } catch(err) {
      setErroGlobal(err.response?.data?.detail || err.message)
    }
  }

  const excluirInserido = async (tipo, id, nome) => {
    if (!window.confirm(`Remover o registro manual "${nome || ''}"?`)) return
    try {
      await axios.delete(tipo === 'contrato'
        ? `/api/ixc/contratos-manuais/${id}`
        : `/api/ixc/cancelamentos-manuais/${id}`)
      carregarAjustes(); carregarV(cidade); carregarC(cidade)
    } catch(err) {
      setErroGlobal(err.response?.data?.detail || err.message)
    }
  }

  // Pede o motivo do ajuste manual; retorna null se o usuário cancelar
  const pedirMotivo = (texto) => {
    const motivo = window.prompt(texto)
    if (motivo === null) return null
    if (!motivo.trim()) {
      setErroGlobal('O motivo é obrigatório para ajustes manuais.')
      return null
    }
    return motivo.trim()
  }

  // Valida manualmente um contrato desconsiderado como nova instalação
  // (passa por cima da regra automática e sobe para a lista de novos contratos)
  const validarIXC = async (tipo, source_id, nome) => {
    const motivo = pedirMotivo(`Validar "${nome || 'este registro'}" como nova instalação.\n\nInforme o motivo:`)
    if (!motivo) return
    try {
      await axios.post(`/api/ixc/registros-ixc/${tipo}/${source_id}/validar`, null, { params: { nome, motivo } })
      carregarV(cidade)
    } catch(err) {
      setErroGlobal(err.response?.data?.detail || err.message)
    }
  }

  // Registros vindos do IXC não podem ser apagados (o sync os recriaria) —
  // são ocultados da lista e das estatísticas de forma permanente
  const ocultarIXC = async (tipo, source_id, nome, recarregar) => {
    const motivo = pedirMotivo(`Remover "${nome || 'este registro'}" da lista e das estatísticas (o sync não o traz de volta).\n\nInforme o motivo:`)
    if (!motivo) return
    try {
      await axios.delete(`/api/ixc/registros-ixc/${tipo}/${source_id}`, { params: { nome, motivo } })
      recarregar(cidade)
    } catch(err) {
      setErroGlobal(err.response?.data?.detail || err.message)
    }
  }

  const anosDisponiveis = useMemo(() => {
    const anos = new Set()
    ;(dadosV?.registros ?? []).forEach(r => { const d = toDate(r.data_ativacao); if (d) anos.add(d.getFullYear()) })
    ;(dadosC?.registros ?? []).forEach(r => { const d = toDate(r.data_abertura); if (d) anos.add(d.getFullYear()) })
    const lista = [...anos].sort((a, b) => b - a)
    return lista.length ? lista : [ANO_ATUAL]
  }, [dadosV, dadosC])

  const kpV = useKpis(dadosV?.registros ?? [], 'data_ativacao', mesFiltro, anoFiltro, anoGrafico)
  const kpC = useKpis(dadosC?.registros ?? [], 'data_abertura', mesFiltro, anoFiltro, anoGrafico)

  const crescPorMes = useMemo(() =>
    MESES_ABREV.map((nome, i) => ({
      nome,
      Vendas:        kpV.porMes[i].total,
      Cancelamentos: kpC.porMes[i].total,
      Crescimento:   kpV.porMes[i].total - kpC.porMes[i].total,
    })),
    [kpV.porMes, kpC.porMes]
  )

  const crescAno = kpV.totalAno - kpC.totalAno
  const crescMes = kpV.doMes.length - kpC.doMes.length
  const cresc7   = kpV.ultimos7.length - kpC.ultimos7.length

  const vendsMesFilt = useMemo(() => {
    const q = buscaVendas.trim().toLowerCase()
    if (!q) return kpV.doMes
    return kpV.doMes.filter(r =>
      (r.nome || '').toLowerCase().includes(q) ||
      (r.bairro || '').toLowerCase().includes(q) ||
      (r.fone || '').toLowerCase().includes(q)
    )
  }, [kpV.doMes, buscaVendas])

  // Contratos que não contam como nova instalação (titularidade / sem OS),
  // filtrados pelo mesmo mês/ano da tabela — visíveis para auditoria
  const [mostrarDesconsiderados, setMostrarDesconsiderados] = useState(false)
  const desconsideradosMes = useMemo(() => {
    return (dadosV?.desconsiderados ?? []).filter(r => {
      const d = toDate(r.data_ativacao)
      return d && d.getFullYear() === anoFiltro && d.getMonth() === mesFiltro
    })
  }, [dadosV, mesFiltro, anoFiltro])

  const cancMesFilt = useMemo(() => {
    const q = buscaCanc.trim().toLowerCase()
    if (!q) return kpC.doMes
    return kpC.doMes.filter(r =>
      (r.nome || '').toLowerCase().includes(q) ||
      (r.bairro || '').toLowerCase().includes(q) ||
      (r.fone || '').toLowerCase().includes(q)
    )
  }, [kpC.doMes, buscaCanc])

  const lastSyncLabel = (() => {
    const ts = dadosV?.last_sync || dadosC?.last_sync
    return ts ? new Date(ts).toLocaleString('pt-BR') : null
  })()

  const loading = loadV || loadC

  return (
    <div className="page">
      {/* ── Cabeçalho ── */}
      <div className="page-header">
        <h1>Contratos IXC — {CIDADES.find(c => c.id === cidade)?.label}</h1>
        <div className="page-actions">
          {lastSyncLabel && (
            <span style={{ fontSize: '.8rem', color: '#888', marginRight: '0.75rem' }}>
              Sync: {lastSyncLabel}
            </span>
          )}
          <button className="btn-sync" onClick={handleSync} disabled={syncing}>
            {syncing ? '⟳ Sincronizando...' : '⟳ Sincronizar IXC'}
          </button>
        </div>
      </div>

      {(erroGlobal || erroV || erroC) && (
        <div className="alert-error">{erroGlobal || erroV || erroC}</div>
      )}
      {syncInfo && (
        <div className="alert-success">
          Sincronizado: <strong>{syncInfo.contratos} contratos</strong> e{' '}
          <strong>{syncInfo.cancelamentos} cancelamentos</strong>.
        </div>
      )}

      {/* ── Tabs de cidade ── */}
      <div className="cidade-tabs">
        {CIDADES.map(c => (
          <button key={c.id}
            className={'cidade-tab' + (cidade === c.id ? ' active' : '')}
            onClick={() => handleCidadeChange(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* ── Seletor de período ── */}
      <div className="card mes-selector-card">
        <span className="mes-selector-label">Analisar mês:</span>
        <select className="select-periodo" value={mesFiltro} onChange={e => setMesFiltro(Number(e.target.value))}>
          {MESES.map((m, i) => <option key={i} value={i}>{m}</option>)}
        </select>
        <select className="select-periodo" value={anoFiltro} onChange={e => setAnoFiltro(Number(e.target.value))}>
          {anosDisponiveis.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <span className="mes-selector-label" style={{ marginLeft: '1rem' }}>Gráficos:</span>
        <select className="select-periodo" value={anoGrafico} onChange={e => setAnoGrafico(Number(e.target.value))}>
          {anosDisponiveis.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {loading && <div className="loading" style={{ padding: '1rem' }}>Carregando...</div>}

      {/* ══ 1+2 · VENDAS ══ */}
      <SecaoTitulo label="Novos Contratos" cor="#27ae60" bg="#e0f5eb" />

      {dadosV?.sem_sync ? (
        <div className="card" style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>
          Nenhum dado. Clique em <strong>Sincronizar IXC</strong>.
        </div>
      ) : (
        <>
          <div className="kpi-row">
            <KpiCard valor={kpV.totalAno}       label={`Ativados — ${anoFiltro}`} />
            <KpiCard valor={kpV.doMes.length}   label={`Ativados — ${MESES_ABREV[mesFiltro]}/${anoFiltro}`} cor={COR_VENDAS} />
            <KpiCard valor={kpV.ultimos7.length} label="Últimos 7 dias" cor="#3498db" />
            <KpiCard valor={dadosV?.contratos_ativos ?? 0} label="Contratos ativos" cor="#8e44ad" />
          </div>

          <div className="card chart-card">
            <h2>Novos contratos por mês — {anoGrafico}</h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={kpV.porMes} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="nome" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="total" name="Contratos" fill={COR_VENDAS} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* ══ 3+4 · CANCELAMENTOS ══ */}
      <SecaoTitulo label="Cancelamentos" cor="#e74c3c" bg="#fde8e8" />

      {dadosC?.sem_sync ? (
        <div className="card" style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>
          Nenhum dado de OS. Clique em <strong>Sincronizar IXC</strong>.
        </div>
      ) : (
        <>
          <div className="kpi-row">
            <KpiCard valor={kpC.totalAno}       label={`Cancelamentos — ${anoFiltro}`} cor={COR_CANC} />
            <KpiCard valor={kpC.doMes.length}   label={`Cancelamentos — ${MESES_ABREV[mesFiltro]}/${anoFiltro}`} cor="#c0392b" />
            <KpiCard valor={kpC.ultimos7.length} label="Últimos 7 dias" cor="#e67e22" />
            <KpiCard valor={dadosC?.total ?? 0} label="Total na base" cor="#888" />
          </div>

          <div className="card chart-card">
            <h2>Cancelamentos por mês — {anoGrafico}</h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={kpC.porMes} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="nome" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="total" name="Cancelamentos" fill={COR_CANC} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* ══ 5 · CRESCIMENTO REAL ══ */}
      <SecaoTitulo label="Crescimento Real (Vendas − Cancelamentos)" cor="#2980b9" bg="#e8f3fb" />

      <div className="kpi-row">
        <KpiCard valor={crescAno >= 0 ? `+${crescAno}` : crescAno} label={`Crescimento líquido — ${anoFiltro}`} cor={corCrescimento(crescAno)} />
        <KpiCard valor={crescMes >= 0 ? `+${crescMes}` : crescMes} label={`${MESES_ABREV[mesFiltro]}/${anoFiltro}`} cor={corCrescimento(crescMes)} />
        <KpiCard valor={cresc7  >= 0 ? `+${cresc7}`  : cresc7}  label="Últimos 7 dias" cor={corCrescimento(cresc7)} />
        <div className="kpi-card">
          <div className="kpi-value" style={{ fontSize: '1rem', color: '#555' }}>
            {kpV.doMes.length} <span style={{ color: COR_CANC, fontSize: '.9rem' }}>− {kpC.doMes.length}</span>
          </div>
          <div className="kpi-label">Vendas − Cancelamentos no mês</div>
        </div>
      </div>

      <div className="card chart-card">
        <h2>Vendas vs Cancelamentos — {anoGrafico}</h2>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={crescPorMes} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="nome" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
            <ReferenceLine y={0} stroke="#ccc" />
            <Bar dataKey="Vendas"        fill={COR_VENDAS} radius={[3, 3, 0, 0]} />
            <Bar dataKey="Cancelamentos" fill={COR_CANC}   radius={[3, 3, 0, 0]} />
            <Line dataKey="Crescimento" stroke={COR_CRESCIMENTO} strokeWidth={2}
              dot={{ r: 4, fill: COR_CRESCIMENTO, strokeWidth: 0 }}
              activeDot={{ r: 6 }} type="monotone" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ══ LISTAS ══ */}
      <SecaoTitulo label={`Listas — ${MESES[mesFiltro]}/${anoFiltro}`} cor="#444" bg="#f0f0f0" />

      {/* Listas empilhadas (uma embaixo da outra) para melhor leitura */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>

        {/* ── Tabela de contratos ── */}
        <div className="card">
          <div className="table-header">
            <h2 style={{ color: COR_VENDAS }}>
              Contratos
              <span style={{ fontWeight: 400, fontSize: '.88rem', color: '#666', marginLeft: '0.4rem' }}>
                ({vendsMesFilt.length}{buscaVendas ? ` de ${kpV.doMes.length}` : ''})
              </span>
            </h2>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <input className="filtro-input" type="text" placeholder="Buscar..."
                value={buscaVendas} onChange={e => setBuscaVendas(e.target.value)} style={{ minWidth: 110 }} />
              {cidade !== 'todas' && (
                <button
                  onClick={() => { setAddVendaOpen(v => !v); setFormErroV(null) }}
                  style={{
                    padding: '0.3rem 0.65rem', fontWeight: 700, fontSize: '.83rem',
                    border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                    background: addVendaOpen ? '#888' : COR_VENDAS, color: '#fff',
                  }}>
                  {addVendaOpen ? '✕ Fechar' : '+ Inserir'}
                </button>
              )}
            </div>
          </div>

          {addVendaOpen && (
            <form onSubmit={criarContrato} style={{
              display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'flex-end',
              padding: '0.75rem', background: '#f0fff4', borderRadius: 8, marginBottom: '0.75rem',
            }}>
              <div style={{ flex: '2 1 140px' }}>
                <label style={{ display: 'block', fontSize: '.75rem', color: '#555', marginBottom: 3 }}>Nome*</label>
                <input required style={{ ...inStyle, width: '100%' }} placeholder="Nome do cliente"
                  value={formVenda.nome} onChange={e => setFormVenda(f => ({ ...f, nome: e.target.value }))} />
              </div>
              <div style={{ flex: '1 1 120px' }}>
                <label style={{ display: 'block', fontSize: '.75rem', color: '#555', marginBottom: 3 }}>Data ativação*</label>
                <input required type="date" style={{ ...inStyle, width: '100%' }}
                  value={formVenda.data_ativacao} onChange={e => setFormVenda(f => ({ ...f, data_ativacao: e.target.value }))} />
              </div>
              <div style={{ flex: '1 1 100px' }}>
                <label style={{ display: 'block', fontSize: '.75rem', color: '#555', marginBottom: 3 }}>Bairro</label>
                <input style={{ ...inStyle, width: '100%' }} placeholder="Bairro"
                  value={formVenda.bairro} onChange={e => setFormVenda(f => ({ ...f, bairro: e.target.value }))} />
              </div>
              <div style={{ flex: '1 1 100px' }}>
                <label style={{ display: 'block', fontSize: '.75rem', color: '#555', marginBottom: 3 }}>Fone</label>
                <input style={{ ...inStyle, width: '100%' }} placeholder="Fone"
                  value={formVenda.fone} onChange={e => setFormVenda(f => ({ ...f, fone: e.target.value }))} />
              </div>
              <div style={{ flex: '2 1 180px' }}>
                <label style={{ display: 'block', fontSize: '.75rem', color: '#555', marginBottom: 3 }}>Motivo *</label>
                <input style={{ ...inStyle, width: '100%' }} placeholder="Por que está inserindo manualmente?" required
                  value={formVenda.obs} onChange={e => setFormVenda(f => ({ ...f, obs: e.target.value }))} />
              </div>
              <button type="submit" disabled={salvandoV}
                style={{ padding: '0.4rem 0.8rem', background: COR_VENDAS, color: '#fff',
                  border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700,
                  fontFamily: 'inherit', opacity: salvandoV ? .7 : 1 }}>
                {salvandoV ? 'Salvando...' : 'Salvar'}
              </button>
              {formErroV && <div style={{ width: '100%', color: COR_CANC, fontSize: '.82rem' }}>{formErroV}</div>}
            </form>
          )}

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Ativação</th><th>Nome</th><th>Bairro</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {vendsMesFilt.length === 0
                  ? <tr><td colSpan={5} className="sem-resultado">Nenhum contrato neste mês.</td></tr>
                  : vendsMesFilt.map((r, i) => (
                    <tr key={i} style={r.manual ? { background: '#f9fff9' } : undefined}>
                      <td style={{ whiteSpace: 'nowrap' }}>{r.data_ativacao}</td>
                      <td>
                        {r.nome || '—'}
                        {r.manual && <BadgeManual />}
                        {r.validado && <BadgeValidado />}
                        {r.ponto_adicional && !r.validado && <BadgePontoAdicional />}
                      </td>
                      <td>{r.bairro || '—'}</td>
                      <td><BadgeAtivo ativo={r.cliente_ativo} /></td>
                      <td style={{ textAlign: 'center', width: 32 }}>
                        <BtnLixeira onClick={() => r.manual
                          ? excluirContrato(r.source_id)
                          : ocultarIXC('contrato', r.source_id, r.nome, carregarV)} />
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>

          {/* Contratos que não contam como nova instalação (auditoria) */}
          {desconsideradosMes.length > 0 && (
            <div style={{ marginTop: '0.7rem' }}>
              <button
                onClick={() => setMostrarDesconsiderados(v => !v)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  fontSize: '.8rem', color: '#9c5700', fontFamily: 'inherit', fontWeight: 600,
                }}
              >
                {mostrarDesconsiderados ? '▾' : '▸'} {desconsideradosMes.length} contrato(s) do IXC
                não contam como nova instalação neste mês
              </button>
              {mostrarDesconsiderados && (
                <div className="table-wrapper" style={{ marginTop: '0.5rem', maxHeight: 220 }}>
                  <table>
                    <thead>
                      <tr><th>Ativação</th><th>Nome</th><th>Motivo</th><th></th></tr>
                    </thead>
                    <tbody>
                      {desconsideradosMes.map((r, i) => (
                        <tr key={i} style={{ background: '#fffdf5' }}>
                          <td style={{ whiteSpace: 'nowrap' }}>{r.data_ativacao}</td>
                          <td>{r.nome || '—'}</td>
                          <td style={{ fontSize: '.78rem', color: '#9c5700' }}>{r.motivo}</td>
                          <td style={{ textAlign: 'center', width: 64, whiteSpace: 'nowrap' }}>
                            <button
                              onClick={() => validarIXC('contrato', r.source_id, r.nome)}
                              title="Validar como nova instalação"
                              style={{ background: 'none', border: 'none', cursor: 'pointer',
                                color: '#27ae60', fontSize: '1rem', padding: '0 0.15rem', lineHeight: 1 }}>
                              ✔
                            </button>
                            <BtnLixeira onClick={() => ocultarIXC('contrato', r.source_id, r.nome, carregarV)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Tabela de cancelamentos ── */}
        <div className="card">
          <div className="table-header">
            <h2 style={{ color: COR_CANC }}>
              Cancelamentos
              <span style={{ fontWeight: 400, fontSize: '.88rem', color: '#666', marginLeft: '0.4rem' }}>
                ({cancMesFilt.length}{buscaCanc ? ` de ${kpC.doMes.length}` : ''})
              </span>
            </h2>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <input className="filtro-input" type="text" placeholder="Buscar..."
                value={buscaCanc} onChange={e => setBuscaCanc(e.target.value)} style={{ minWidth: 110 }} />
              {cidade !== 'todas' && (
                <button
                  onClick={() => { setAddCancOpen(v => !v); setFormErroC(null) }}
                  style={{
                    padding: '0.3rem 0.65rem', fontWeight: 700, fontSize: '.83rem',
                    border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                    background: addCancOpen ? '#888' : COR_CANC, color: '#fff',
                  }}>
                  {addCancOpen ? '✕ Fechar' : '+ Inserir'}
                </button>
              )}
            </div>
          </div>

          {addCancOpen && (
            <form onSubmit={criarCancelamento} style={{
              display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'flex-end',
              padding: '0.75rem', background: '#fff5f5', borderRadius: 8, marginBottom: '0.75rem',
            }}>
              <div style={{ flex: '2 1 140px' }}>
                <label style={{ display: 'block', fontSize: '.75rem', color: '#555', marginBottom: 3 }}>Nome*</label>
                <input required style={{ ...inStyle, width: '100%' }} placeholder="Nome do cliente"
                  value={formCanc.nome} onChange={e => setFormCanc(f => ({ ...f, nome: e.target.value }))} />
              </div>
              <div style={{ flex: '1 1 120px' }}>
                <label style={{ display: 'block', fontSize: '.75rem', color: '#555', marginBottom: 3 }}>Data*</label>
                <input required type="date" style={{ ...inStyle, width: '100%' }}
                  value={formCanc.data_abertura} onChange={e => setFormCanc(f => ({ ...f, data_abertura: e.target.value }))} />
              </div>
              <div style={{ flex: '1 1 100px' }}>
                <label style={{ display: 'block', fontSize: '.75rem', color: '#555', marginBottom: 3 }}>Bairro</label>
                <input style={{ ...inStyle, width: '100%' }} placeholder="Bairro"
                  value={formCanc.bairro} onChange={e => setFormCanc(f => ({ ...f, bairro: e.target.value }))} />
              </div>
              <div style={{ flex: '1 1 100px' }}>
                <label style={{ display: 'block', fontSize: '.75rem', color: '#555', marginBottom: 3 }}>Fone</label>
                <input style={{ ...inStyle, width: '100%' }} placeholder="Fone"
                  value={formCanc.fone} onChange={e => setFormCanc(f => ({ ...f, fone: e.target.value }))} />
              </div>
              <div style={{ flex: '2 1 180px' }}>
                <label style={{ display: 'block', fontSize: '.75rem', color: '#555', marginBottom: 3 }}>Motivo *</label>
                <input style={{ ...inStyle, width: '100%' }} placeholder="Por que está inserindo manualmente?" required
                  value={formCanc.obs} onChange={e => setFormCanc(f => ({ ...f, obs: e.target.value }))} />
              </div>
              <button type="submit" disabled={salvandoC}
                style={{ padding: '0.4rem 0.8rem', background: COR_CANC, color: '#fff',
                  border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700,
                  fontFamily: 'inherit', opacity: salvandoC ? .7 : 1 }}>
                {salvandoC ? 'Salvando...' : 'Salvar'}
              </button>
              {formErroC && <div style={{ width: '100%', color: COR_CANC, fontSize: '.82rem' }}>{formErroC}</div>}
            </form>
          )}

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Data</th><th>Nome</th><th>Bairro</th><th>Fone</th><th>Motivo</th><th></th>
                </tr>
              </thead>
              <tbody>
                {cancMesFilt.length === 0
                  ? <tr><td colSpan={6} className="sem-resultado">Nenhum cancelamento neste mês.</td></tr>
                  : cancMesFilt.map((r, i) => (
                    <tr key={i} style={r.manual ? { background: '#fff9f9' } : undefined}>
                      <td style={{ whiteSpace: 'nowrap' }}>{r.data_abertura}</td>
                      <td>
                        {r.nome || '—'}
                        {r.manual && <BadgeManual />}
                      </td>
                      <td>{r.bairro || '—'}</td>
                      <td>{r.fone || '—'}</td>
                      <td title={r.motivo || ''} style={{
                        fontSize: '.78rem', color: '#7d4b4b', maxWidth: 280,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {r.motivo || '—'}
                      </td>
                      <td style={{ textAlign: 'center', width: 32 }}>
                        <BtnLixeira onClick={() => r.manual
                          ? excluirCancelamento(r.source_id)
                          : ocultarIXC('os', r.source_id, r.nome, carregarC)} />
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* ── Trilha de ajustes manuais ── */}
      <div className="card" style={{ marginTop: '1rem' }}>
        <button
          onClick={toggleAjustes}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            fontSize: '.95rem', color: '#3D1278', fontFamily: 'inherit', fontWeight: 700,
          }}
        >
          {mostrarAjustes ? '▾' : '▸'} ⚙ Ajustes manuais
          <span style={{ fontWeight: 400, fontSize: '.8rem', color: '#888', marginLeft: 8 }}>
            inseridos, validados e removidos manualmente — {CIDADES.find(c => c.id === cidade)?.label}
          </span>
        </button>

        {mostrarAjustes && !ajustes && <div style={{ padding: '1rem', color: '#888' }}>Carregando…</div>}

        {mostrarAjustes && ajustes && (
          <div style={{ display: 'grid', gap: '1rem', marginTop: '1rem' }}>
            {[
              {
                titulo: `➕ Inseridos manualmente (${ajustes.inseridos.length})`,
                cor: '#27ae60',
                linhas: ajustes.inseridos,
                acao: (r) => excluirInserido(r.tipo, r.id, r.nome),
                acaoLabel: '🗑 Remover',
              },
              {
                titulo: `✔ Validados como nova instalação (${ajustes.validados.length})`,
                cor: '#1a7a44',
                linhas: ajustes.validados,
                acao: (r) => desfazerValidacao(r.tipo, r.source_id, r.nome),
                acaoLabel: '↩ Desfazer',
              },
              {
                titulo: `🗑 Removidos da lista (${ajustes.ocultados.length})`,
                cor: '#c0392b',
                linhas: ajustes.ocultados,
                acao: (r) => restaurarOculto(r.tipo, r.source_id, r.nome),
                acaoLabel: '↩ Restaurar',
              },
            ].map(sec => (
              <div key={sec.titulo}>
                <div style={{ fontSize: '.85rem', fontWeight: 700, color: sec.cor, marginBottom: '.4rem' }}>
                  {sec.titulo}
                </div>
                {sec.linhas.length === 0 ? (
                  <div style={{ fontSize: '.8rem', color: '#aaa', paddingLeft: '.2rem' }}>Nenhum registro.</div>
                ) : (
                  <div className="table-wrapper" style={{ maxHeight: 200 }}>
                    <table>
                      <thead>
                        <tr><th>Data</th><th>Nome</th><th>Tipo</th><th>Cidade</th><th>Motivo</th><th>Quando</th><th></th></tr>
                      </thead>
                      <tbody>
                        {sec.linhas.map((r, i) => (
                          <tr key={i}>
                            <td style={{ whiteSpace: 'nowrap' }}>{r.data || '—'}</td>
                            <td>{r.nome || '—'}</td>
                            <td style={{ fontSize: '.78rem' }}>{r.tipo === 'os' ? 'cancelamento' : r.tipo}</td>
                            <td style={{ fontSize: '.78rem' }}>{r.cidade}</td>
                            <td style={{ fontSize: '.78rem', color: '#4a3670' }}>{r.motivo || '—'}</td>
                            <td style={{ whiteSpace: 'nowrap', fontSize: '.78rem', color: '#888' }}>
                              {r.quando ? new Date(r.quando).toLocaleString('pt-BR') : '—'}
                            </td>
                            <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                              <button
                                onClick={() => sec.acao(r)}
                                style={{ background: 'none', border: '1px solid #d5cbe6', borderRadius: 6,
                                  cursor: 'pointer', fontSize: '.75rem', padding: '.15rem .5rem',
                                  color: '#4a3670', fontFamily: 'inherit' }}>
                                {sec.acaoLabel}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
