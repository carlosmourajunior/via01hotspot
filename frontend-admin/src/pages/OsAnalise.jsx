import { useState, useEffect, useMemo } from 'react'
import axios from 'axios'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'

const ANO_ATUAL = new Date().getFullYear()
const ANOS    = [ANO_ATUAL, ANO_ATUAL - 1, ANO_ATUAL - 2]
const CIDADES = [
  { id: '',            label: 'Todas as cidades' },
  { id: 'borda_mata',  label: 'Borda da Mata' },
  { id: 'ouro_fino',   label: 'Ouro Fino' },
  { id: 'inconfidentes', label: 'Inconfidentes' },
]

const CORES_GRUPO = {
  'Instalação / Novo Cliente': '#27ae60',
  'Cancelamento':              '#e74c3c',
  'Reversão / Recuperação':   '#2980b9',
  'Suporte Técnico':           '#e67e22',
  'Administrativo':            '#8e44ad',
  'Outros':                    '#95a5a6',
}
function corGrupo(nome) { return CORES_GRUPO[nome] || '#95a5a6' }

const STATUS_FECHADO = new Set(['F', 'FECHADO', 'CONCLUIDO', 'FINALIZADO'])
function isFechado(s) { return STATUS_FECHADO.has((s || '').toUpperCase()) }

function BadgeGrupo({ grupo }) {
  return (
    <span style={{
      background: corGrupo(grupo) + '22', color: corGrupo(grupo),
      padding: '1px 7px', borderRadius: 4, fontSize: '.75rem', fontWeight: 700, whiteSpace: 'nowrap',
    }}>
      {grupo}
    </span>
  )
}

function BadgeStatus({ status }) {
  const ok = isFechado(status)
  return (
    <span style={{
      padding: '1px 7px', borderRadius: 10, fontSize: '.75rem', fontWeight: 600,
      background: ok ? '#e8f8e8' : '#fef9e7',
      color:      ok ? '#1a5e20' : '#7d6608',
    }}>
      {ok ? 'Fechado' : status || 'Aberto'}
    </span>
  )
}

export default function OsAnalise() {
  const [ano,     setAno]     = useState(ANO_ATUAL)
  const [cidade,  setCidade]  = useState('')
  const [dados,   setDados]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [erro,    setErro]    = useState(null)

  const [filtroGrupo,   setFiltroGrupo]   = useState('todos')
  const [filtroAssunto, setFiltroAssunto] = useState('todos')
  const [filtroStatus,  setFiltroStatus]  = useState('todos')
  const [filtroBusca,   setFiltroBusca]   = useState('')

  const carregar = (a = ano, c = cidade) => {
    setLoading(true); setErro(null)
    const q = c ? `&cidade=${c}` : ''
    axios.get(`/api/ixc/analise-os?ano=${a}${q}`)
      .then(r => { setDados(r.data); setFiltroGrupo('todos'); setFiltroAssunto('todos') })
      .catch(e => setErro(e.response?.data?.detail || e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { carregar() }, [])

  const grupos   = dados?.grupos   ?? []
  const assuntos = dados?.assuntos ?? []
  const porMes   = dados?.por_mes  ?? []

  const gruposGrafico = useMemo(() => grupos.map(g => g.grupo), [grupos])

  // Assuntos do grupo selecionado para o sub-filtro
  const assuntosFiltrados = useMemo(() => {
    if (filtroGrupo === 'todos') return assuntos
    return assuntos.filter(a => a.grupo === filtroGrupo)
  }, [assuntos, filtroGrupo])

  const registrosFiltrados = useMemo(() => {
    if (!dados) return []
    return dados.registros.filter(r => {
      if (filtroGrupo !== 'todos'   && r.grupo        !== filtroGrupo)   return false
      if (filtroAssunto !== 'todos' && r.assunto_nome !== filtroAssunto) return false
      if (filtroStatus === 'aberto'  &&  isFechado(r.status)) return false
      if (filtroStatus === 'fechado' && !isFechado(r.status)) return false
      if (filtroBusca) {
        const q = filtroBusca.toLowerCase()
        return (r.nome_cliente || '').toLowerCase().includes(q) ||
               (r.assunto_nome || '').toLowerCase().includes(q) ||
               (r.mensagem     || '').toLowerCase().includes(q) ||
               (r.protocolo    || '').toLowerCase().includes(q)
      }
      return true
    })
  }, [dados, filtroGrupo, filtroAssunto, filtroStatus, filtroBusca])

  return (
    <div className="page">
      <div className="page-header">
        <h1>Analise de OS — IXC</h1>
        <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="select-periodo" value={cidade}
            onChange={e => { setCidade(e.target.value); carregar(ano, e.target.value) }}>
            {CIDADES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <select className="select-periodo" value={ano}
            onChange={e => { setAno(Number(e.target.value)); carregar(Number(e.target.value), cidade) }}>
            {ANOS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <button className="btn-secondary" onClick={() => carregar(ano, cidade)} disabled={loading}>
            {loading ? 'Carregando...' : 'Atualizar'}
          </button>
        </div>
      </div>

      {erro && <div className="alert-error">{erro}</div>}

      {dados?.sem_sync && !loading && (
        <div className="alert-error" style={{ borderColor: '#f39c12', background: '#fef9e7', color: '#7d6608' }}>
          Nenhuma OS no banco. Va em Comparacao e clique em "Sync OS {ano}" primeiro.
        </div>
      )}

      {/* KPI por grupo */}
      {grupos.length > 0 && (
        <div className="kpi-row" style={{ flexWrap: 'wrap' }}>
          <div className="kpi-card" style={{ borderLeft: '4px solid #444' }}>
            <div className="kpi-value">{loading ? '...' : dados?.total ?? 0}</div>
            <div className="kpi-label">Total OS — {ano}</div>
          </div>
          {grupos.map(g => (
            <div
              key={g.grupo} className="kpi-card"
              style={{ borderLeft: `4px solid ${corGrupo(g.grupo)}`, cursor: 'pointer',
                       background: filtroGrupo === g.grupo ? '#fff8f0' : undefined }}
              onClick={() => { setFiltroGrupo(filtroGrupo === g.grupo ? 'todos' : g.grupo); setFiltroAssunto('todos') }}
              title="Clique para filtrar"
            >
              <div className="kpi-value" style={{ color: corGrupo(g.grupo) }}>{g.total}</div>
              <div className="kpi-label">{g.grupo}</div>
              <div style={{ fontSize: '.7rem', color: '#999', marginTop: 2 }}>
                {g.abertas} aberta{g.abertas !== 1 ? 's' : ''} · {g.fechadas} fechada{g.fechadas !== 1 ? 's' : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Gráfico por mês (stacked por grupo) */}
      {porMes.length > 0 && (
        <div className="card chart-card">
          <div className="chart-card-header">
            <h2>OS por mes — {ano}{cidade ? ` · ${CIDADES.find(c=>c.id===cidade)?.label}` : ''}</h2>
            {loading && <span className="comp-loading-tag">Carregando...</span>}
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={porMes} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {gruposGrafico.map((g, i) => (
                <Bar key={g} dataKey={g} stackId="a" fill={corGrupo(g)}
                  radius={i === gruposGrafico.length - 1 ? [3,3,0,0] : [0,0,0,0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Tabela de assuntos com meses */}
      {assuntos.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="table-header"><h2>Detalhamento por assunto</h2></div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Grupo</th><th>Assunto</th><th>Total</th><th>Abertas</th><th>Fechadas</th>
                  <th>Jan</th><th>Fev</th><th>Mar</th><th>Abr</th><th>Mai</th><th>Jun</th>
                  <th>Jul</th><th>Ago</th><th>Set</th><th>Out</th><th>Nov</th><th>Dez</th>
                </tr>
              </thead>
              <tbody>
                {assuntos.map(a => (
                  <tr
                    key={a.assunto}
                    style={{ cursor: 'pointer', background: filtroAssunto === a.assunto ? '#fff8f0' : undefined }}
                    onClick={() => {
                      setFiltroGrupo(filtroAssunto === a.assunto ? 'todos' : a.grupo)
                      setFiltroAssunto(filtroAssunto === a.assunto ? 'todos' : a.assunto)
                    }}
                  >
                    <td><BadgeGrupo grupo={a.grupo} /></td>
                    <td style={{ fontWeight: 500 }}>{a.assunto}</td>
                    <td style={{ fontWeight: 700 }}>{a.total}</td>
                    <td style={{ color: '#e67e22' }}>{a.abertas}</td>
                    <td style={{ color: '#27ae60' }}>{a.fechadas}</td>
                    {a.por_mes.map((v, mi) => (
                      <td key={mi} style={{ color: v > 0 ? '#1a1a2e' : '#ccc', fontWeight: v > 0 ? 600 : 400 }}>
                        {v || '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: '.78rem', color: '#999', padding: '.4rem 1rem' }}>
            Clique em um assunto para filtrar a lista abaixo
          </div>
        </div>
      )}

      {/* Filtros */}
      {dados && !dados.sem_sync && (
        <>
          <div style={{ display: 'flex', gap: '.75rem', marginBottom: '.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <h2 style={{ flex: '0 0 auto' }}>
              OS{filtroGrupo !== 'todos' ? ` — ${filtroGrupo}` : ''}
              {filtroAssunto !== 'todos' ? ` / ${filtroAssunto}` : ''}
              <span style={{ fontWeight: 400, color: '#888', fontSize: '.85rem', marginLeft: '.5rem' }}>
                ({registrosFiltrados.length})
              </span>
            </h2>

            <select className="select-periodo" value={filtroGrupo}
              onChange={e => { setFiltroGrupo(e.target.value); setFiltroAssunto('todos') }}>
              <option value="todos">Todos os grupos</option>
              {grupos.map(g => <option key={g.grupo} value={g.grupo}>{g.grupo} ({g.total})</option>)}
            </select>

            <select className="select-periodo" value={filtroAssunto}
              onChange={e => setFiltroAssunto(e.target.value)}>
              <option value="todos">Todos os assuntos</option>
              {assuntosFiltrados.map(a => <option key={a.assunto} value={a.assunto}>{a.assunto} ({a.total})</option>)}
            </select>

            <select className="select-periodo" value={filtroStatus}
              onChange={e => setFiltroStatus(e.target.value)}>
              <option value="todos">Todos os status</option>
              <option value="aberto">Abertas</option>
              <option value="fechado">Fechadas</option>
            </select>

            <input
              type="text"
              placeholder="Buscar cliente, mensagem, protocolo..."
              value={filtroBusca}
              onChange={e => setFiltroBusca(e.target.value)}
              style={{ flex: 1, minWidth: 200, padding: '.38rem .75rem', borderRadius: 8, border: '1px solid #ccc', fontSize: '.88rem', fontFamily: 'inherit' }}
            />

            {(filtroGrupo !== 'todos' || filtroAssunto !== 'todos' || filtroStatus !== 'todos' || filtroBusca) && (
              <button className="btn-secondary"
                onClick={() => { setFiltroGrupo('todos'); setFiltroAssunto('todos'); setFiltroStatus('todos'); setFiltroBusca('') }}>
                Limpar
              </button>
            )}
          </div>

          <div className="card">
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Data</th><th>Assunto</th><th>Grupo</th>
                    <th>Cliente</th><th>Bairro</th>
                    <th>Mensagem</th><th>Status</th><th>Fechamento</th><th>Protocolo</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={9} className="sem-resultado">Carregando...</td></tr>
                  ) : registrosFiltrados.length === 0 ? (
                    <tr><td colSpan={9} className="sem-resultado">Nenhuma OS encontrada.</td></tr>
                  ) : registrosFiltrados.map((r, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? undefined : '#fafafa' }}>
                      <td style={{ whiteSpace: 'nowrap' }}>{r.data_abertura}</td>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>{r.assunto_nome}</td>
                      <td><BadgeGrupo grupo={r.grupo} /></td>
                      <td>
                        {r.nome_cliente || <span style={{ color: '#bbb' }}>ID {r.id_cliente}</span>}
                        {r.cliente_ativo === 'N' && <span style={{ fontSize: '.7rem', color: '#e74c3c', marginLeft: 4 }}>inativo</span>}
                      </td>
                      <td style={{ color: '#666', fontSize: '.83rem' }}>{r.bairro}</td>
                      <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#555', fontSize: '.82rem' }}
                        title={r.mensagem}>{r.mensagem}</td>
                      <td><BadgeStatus status={r.status} /></td>
                      <td style={{ color: '#888', fontSize: '.83rem', whiteSpace: 'nowrap' }}>{r.data_fechamento || '—'}</td>
                      <td style={{ color: '#aaa', fontSize: '.76rem' }}>{r.protocolo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
