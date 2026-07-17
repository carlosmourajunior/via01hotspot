import { useState, useEffect } from 'react'
import axios from 'axios'

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

const ORIGEM_LABELS = {
  todas:         '🏢 Via01 — Total',
  borda_mata:    'Borda da Mata',
  ouro_fino:     'Ouro Fino',
  inconfidentes: 'Inconfidentes',
}

const inStyle = {
  padding: '0.4rem 0.6rem', borderRadius: 6,
  border: '1.5px solid #d1d5db', fontSize: '.85rem',
  fontFamily: 'inherit', outline: 'none',
}

const btnStyle = {
  padding: '0.45rem 0.9rem', borderRadius: 6, border: 'none',
  background: 'var(--roxo)', color: '#fff', cursor: 'pointer',
  fontSize: '.85rem', fontFamily: 'inherit',
}

function fmtValor(v, unidade) {
  if (v === null || v === undefined) return '—'
  const n = Number(v)
  const s = Number.isInteger(n)
    ? n.toLocaleString('pt-BR')
    : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  return unidade ? `${s}${unidade}` : s
}

function KpiCard({ k }) {
  const semDados = k.valor === null || k.valor === undefined
  const cor = k.atingido === null || semDados ? '#95a5a6'
    : k.atingido ? '#27ae60'
    : k.sentido === 'menor' ? '#e74c3c' : '#f39c12'
  const barra = k.pct === null ? 0 : Math.min(Math.max(k.pct, 0), 100)

  return (
    <div className="kpi-card" style={{ borderTop: `4px solid ${cor}` }}>
      <div className="kpi-label" style={{ marginTop: 0, marginBottom: '0.5rem', fontWeight: 600 }}>
        {k.titulo}
      </div>
      <div className="kpi-value" style={{ color: cor }}>{fmtValor(k.valor, k.unidade)}</div>
      {k.meta !== null && (
        <>
          <div className="kpi-label">
            Meta: {k.sentido === 'menor' ? '≤ ' : ''}{fmtValor(k.meta, k.unidade)}
            {k.pct !== null && ` · ${k.pct.toLocaleString('pt-BR')}%`}
          </div>
          <div style={{ height: 6, borderRadius: 3, background: '#eee', marginTop: '0.6rem', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${barra}%`, background: cor, transition: 'width .3s' }} />
          </div>
          {k.atingido !== null && (
            <div style={{ fontSize: '.72rem', fontWeight: 700, marginTop: '0.4rem', color: cor }}>
              {k.atingido ? '✔ Meta atingida' : k.sentido === 'menor' ? '⚠ Acima da meta' : '✖ Abaixo da meta'}
            </div>
          )}
        </>
      )}
      {semDados && (
        <div className="kpi-label" style={{ fontStyle: 'italic' }}>Sem dados (sincronize o IXC)</div>
      )}
    </div>
  )
}

// Formulário de criação/edição — kpi=null cria um novo
function KpiForm({ kpi, tipos, origens, onSalvo, onCancelar }) {
  const [form, setForm] = useState({
    titulo:       kpi?.titulo       ?? '',
    tipo:         kpi?.tipo         ?? 'vendas',
    origem:       kpi?.origem       ?? 'todas',
    meta:         kpi?.meta         ?? '',
    valor_manual: kpi?.valor_manual ?? '',
    unidade:      kpi?.unidade      ?? '',
    ativo:        kpi?.ativo        ?? true,
  })
  const [salvando, setSalvando] = useState(false)
  const set = (c, v) => setForm(f => ({ ...f, [c]: v }))

  const salvar = async () => {
    if (!form.titulo.trim()) { alert('Informe o título do KPI'); return }
    setSalvando(true)
    try {
      const body = { ...form, meta: form.meta === '' ? null : form.meta,
                     valor_manual: form.valor_manual === '' ? null : form.valor_manual }
      if (kpi) await axios.patch(`/api/dashboard/kpis/${kpi.id}`, body)
      else     await axios.post('/api/dashboard/kpis', body)
      onSalvo()
    } catch (e) {
      alert(e.response?.data?.detail || e.message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'flex-end',
                  padding: '0.9rem', background: '#f8f7fc', borderRadius: 8 }}>
      <label style={{ fontSize: '.75rem', color: '#666' }}>
        Título<br />
        <input style={{ ...inStyle, width: 180 }} value={form.titulo}
               onChange={e => set('titulo', e.target.value)} placeholder="ex: Vendas Ouro Fino" />
      </label>
      <label style={{ fontSize: '.75rem', color: '#666' }}>
        Métrica<br />
        <select style={inStyle} value={form.tipo} onChange={e => set('tipo', e.target.value)}>
          {Object.entries(tipos).map(([t, label]) => <option key={t} value={t}>{label}</option>)}
        </select>
      </label>
      {form.tipo !== 'manual' && (
        <label style={{ fontSize: '.75rem', color: '#666' }}>
          Cidade<br />
          <select style={inStyle} value={form.origem} onChange={e => set('origem', e.target.value)}>
            {origens.map(o => <option key={o} value={o}>{ORIGEM_LABELS[o] || o}</option>)}
          </select>
        </label>
      )}
      <label style={{ fontSize: '.75rem', color: '#666' }}>
        Meta<br />
        <input style={{ ...inStyle, width: 90 }} type="number" step="any" value={form.meta}
               onChange={e => set('meta', e.target.value)} placeholder="ex: 60" />
      </label>
      {form.tipo === 'manual' && (
        <>
          <label style={{ fontSize: '.75rem', color: '#666' }}>
            Valor atual<br />
            <input style={{ ...inStyle, width: 90 }} type="number" step="any" value={form.valor_manual}
                   onChange={e => set('valor_manual', e.target.value)} />
          </label>
          <label style={{ fontSize: '.75rem', color: '#666' }}>
            Unidade<br />
            <input style={{ ...inStyle, width: 60 }} value={form.unidade}
                   onChange={e => set('unidade', e.target.value)} placeholder="%" />
          </label>
        </>
      )}
      {kpi && (
        <label style={{ fontSize: '.8rem', color: '#666', display: 'flex', alignItems: 'center', gap: 4, paddingBottom: 6 }}>
          <input type="checkbox" checked={form.ativo} onChange={e => set('ativo', e.target.checked)} />
          Visível
        </label>
      )}
      <button style={btnStyle} onClick={salvar} disabled={salvando}>
        {salvando ? 'Salvando…' : kpi ? 'Salvar' : '+ Adicionar'}
      </button>
      {onCancelar && (
        <button style={{ ...btnStyle, background: '#95a5a6' }} onClick={onCancelar}>Cancelar</button>
      )}
      {form.tipo === 'churn' && (
        <div style={{ flexBasis: '100%', fontSize: '.75rem', color: '#8e6c0a', background: '#fef9e7',
                      padding: '0.4rem 0.6rem', borderRadius: 6 }}>
          💡 Referência para provedores regionais: churn mensal até <strong>2%</strong> é uma boa meta
          (excelente abaixo de 1,5%; acima de 3% é sinal de alerta).
        </div>
      )}
    </div>
  )
}

export default function Dashboard({ user }) {
  const hoje = new Date()
  const [mes,  setMes]  = useState(hoje.getMonth() + 1)
  const [ano,  setAno]  = useState(hoje.getFullYear())
  const [dados, setDados]   = useState(null)
  const [erro,  setErro]    = useState(null)
  const [config, setConfig]  = useState(false)  // painel de gerenciamento aberto
  const [editando, setEditando] = useState(null) // id do KPI em edição

  const carregar = () => {
    axios.get('/api/dashboard/kpis', { params: { mes, ano, todos: config ? 1 : 0 } })
      .then(r => { setDados(r.data); setErro(null) })
      .catch(e => setErro(e.response?.data?.detail || e.message))
  }
  useEffect(carregar, [mes, ano, config])  // eslint-disable-line react-hooks/exhaustive-deps

  const excluir = async (k) => {
    if (!window.confirm(`Excluir o KPI "${k.titulo}"?`)) return
    await axios.delete(`/api/dashboard/kpis/${k.id}`)
    carregar()
  }

  const anos = []
  for (let a = hoje.getFullYear(); a >= hoje.getFullYear() - 3; a--) anos.push(a)

  const visiveis = (dados?.kpis || []).filter(k => k.ativo)

  return (
    <div className="page">
      <div className="page-header">
        <h1>Dashboard</h1>
        <div className="page-actions" style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <select style={inStyle} value={mes} onChange={e => setMes(Number(e.target.value))}>
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select style={inStyle} value={ano} onChange={e => setAno(Number(e.target.value))}>
            {anos.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          {user?.admin && (
            <button style={{ ...btnStyle, background: config ? '#95a5a6' : 'var(--roxo)' }}
                    onClick={() => { setConfig(c => !c); setEditando(null) }}>
              {config ? 'Fechar configuração' : '⚙ Configurar KPIs'}
            </button>
          )}
        </div>
      </div>

      {erro && <div className="card" style={{ color: '#c0392b' }}>Erro: {erro}</div>}

      {!dados && !erro && <div className="card" style={{ color: '#888' }}>Carregando…</div>}

      {dados && visiveis.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: '#888' }}>
          📊 Nenhum KPI configurado ainda.
          {user?.admin ? ' Clique em "⚙ Configurar KPIs" para adicionar.' : ' Peça a um administrador para configurar.'}
        </div>
      )}

      {dados && visiveis.length > 0 && (
        <div className="kpi-row">
          {visiveis.map(k => <KpiCard key={k.id} k={k} />)}
        </div>
      )}

      {/* ── Gerenciamento (admin) ── */}
      {config && dados && (
        <div className="card">
          <h2 style={{ color: 'var(--roxo)', marginBottom: '1rem' }}>Gerenciar KPIs</h2>

          <KpiForm tipos={dados.tipos} origens={dados.origens}
                   onSalvo={() => carregar()} />

          <table style={{ width: '100%', marginTop: '1.2rem', borderCollapse: 'collapse', fontSize: '.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#666', borderBottom: '2px solid #eee' }}>
                <th style={{ padding: '0.5rem' }}>KPI</th>
                <th>Métrica</th>
                <th>Cidade</th>
                <th>Meta</th>
                <th>Valor atual</th>
                <th>Visível</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {dados.kpis.map(k => editando === k.id ? (
                <tr key={k.id}>
                  <td colSpan={7} style={{ padding: '0.5rem 0' }}>
                    <KpiForm kpi={k} tipos={dados.tipos} origens={dados.origens}
                             onSalvo={() => { setEditando(null); carregar() }}
                             onCancelar={() => setEditando(null)} />
                  </td>
                </tr>
              ) : (
                <tr key={k.id} style={{ borderBottom: '1px solid #f0f0f0', opacity: k.ativo ? 1 : 0.45 }}>
                  <td style={{ padding: '0.5rem', fontWeight: 600 }}>{k.titulo}</td>
                  <td>{dados.tipos[k.tipo] || k.tipo}</td>
                  <td>{k.tipo === 'manual' ? '—' : (ORIGEM_LABELS[k.origem] || k.origem)}</td>
                  <td>{fmtValor(k.meta, k.unidade)}</td>
                  <td>{fmtValor(k.valor, k.unidade)}</td>
                  <td>{k.ativo ? '✔' : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button style={{ ...btnStyle, padding: '0.25rem 0.6rem', fontSize: '.78rem' }}
                            onClick={() => setEditando(k.id)}>Editar</button>{' '}
                    <button style={{ ...btnStyle, padding: '0.25rem 0.6rem', fontSize: '.78rem', background: '#e74c3c' }}
                            onClick={() => excluir(k)}>Excluir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ fontSize: '.75rem', color: '#888', marginTop: '0.8rem' }}>
            As métricas calculadas usam os mesmos dados das telas Vendas (contratos e cancelamentos IXC,
            incluindo lançamentos manuais). Churn = cancelamentos do mês ÷ contratos ativos.
          </div>
        </div>
      )}
    </div>
  )
}
