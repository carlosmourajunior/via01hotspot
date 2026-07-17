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

function formatPhone(phone) {
  const d = (phone || '').replace(/\D/g, '')
  const local = d.startsWith('55') ? d.slice(2) : d
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`
  return phone || '—'
}

function fmtData(iso) {
  if (!iso) return '—'
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
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
            Meta: {k.sentido === 'menor' ? '≤ ' : '≥ '}{fmtValor(k.meta, k.unidade)}
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

// Tabela de clientes fora da meta de um KPI de OS (flag "mostrar_lista")
function ListaProblemas({ kpi, mes, ano }) {
  const [dados, setDados] = useState(null)
  const [erro,  setErro]  = useState(null)

  useEffect(() => {
    setDados(null); setErro(null)
    axios.get(`/api/dashboard/kpis/${kpi.id}/lista`, { params: { mes, ano } })
      .then(r => setDados(r.data))
      .catch(e => setErro(e.response?.data?.detail || e.message))
  }, [kpi.id, kpi.meta, mes, ano])

  if (erro) return <div className="card" style={{ color: '#c0392b' }}>Lista "{kpi.titulo}": {erro}</div>
  if (!dados) return null

  const financeiro   = dados.tipo === 'fin_pagadores_atrasados'
  const reincidencia = dados.tipo === 'os_reincidencia'
  const colAnterior  = dados.tipo === 'os_primeiro_suporte' ? 'Instalação' : 'Suporte anterior'

  const descricao = financeiro
    ? 'Clientes que pagaram 50% ou mais dos títulos com atraso nos últimos 6 meses (mínimo de 3 títulos pagos).'
    : reincidencia
      ? `Clientes com ${fmtValor(dados.meta)} ou mais suportes nos 60 dias até o fim do mês selecionado.`
      : `Suportes do mês abertos antes de ${fmtValor(dados.meta)} dias ${dados.tipo === 'os_primeiro_suporte' ? 'após a instalação' : 'do suporte anterior'}.`

  return (
    <div className="card">
      <h2 style={{ fontSize: '.95rem', fontWeight: 600, color: '#c0392b', marginBottom: '0.35rem' }}>
        ⚠ Fora da meta — {dados.kpi} ({dados.total})
      </h2>
      <div style={{ fontSize: '.75rem', color: '#888', marginBottom: '0.8rem' }}>{descricao}</div>
      {dados.total === 0 ? (
        <div style={{ color: '#27ae60', fontSize: '.85rem' }}>Nenhum cliente fora da meta no período. 🎉</div>
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Cliente</th><th>Fone</th><th>Cidade</th><th>Bairro</th>
                {financeiro
                  ? <><th>Títulos pagos</th><th>Com atraso</th><th>% atraso</th><th>Atraso médio</th></>
                  : reincidencia
                    ? <><th>Suportes</th><th>Último suporte</th></>
                    : <><th>{colAnterior}</th><th>Suporte</th><th>Assunto</th><th>Dias</th></>}
              </tr>
            </thead>
            <tbody>
              {dados.registros.map((r, i) => (
                <tr key={i}>
                  <td>{r.nome || `Cliente ${r.id_cliente}`}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatPhone(r.fone)}</td>
                  <td style={{ fontSize: '.8rem' }}>{r.cidade}</td>
                  <td style={{ fontSize: '.8rem' }}>{r.bairro || '—'}</td>
                  {financeiro ? (
                    <>
                      <td>{r.pagos}</td>
                      <td>{r.atrasados}</td>
                      <td style={{ fontWeight: 700, color: '#c0392b' }}>{Number(r.pct_atraso).toLocaleString('pt-BR')}%</td>
                      <td>{r.atraso_medio != null ? `${Number(r.atraso_medio).toLocaleString('pt-BR')} dias` : '—'}</td>
                    </>
                  ) : reincidencia ? (
                    <>
                      <td style={{ fontWeight: 700, color: '#c0392b' }}>{r.qtd}</td>
                      <td>{fmtData(r.data_suporte)}</td>
                    </>
                  ) : (
                    <>
                      <td>{fmtData(r.data_anterior)}</td>
                      <td>{fmtData(r.data_suporte)}</td>
                      <td style={{ fontSize: '.8rem' }}>{r.assunto || '—'}</td>
                      <td style={{ fontWeight: 700, color: '#c0392b', whiteSpace: 'nowrap' }}>
                        {Number(r.dias).toLocaleString('pt-BR')}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Formulário de criação/edição — kpi=null cria um novo
function KpiForm({ kpi, tipos, origens, categorias, onSalvo, onCancelar }) {
  const [form, setForm] = useState({
    titulo:       kpi?.titulo       ?? '',
    tipo:         kpi?.tipo         ?? 'vendas',
    origem:       kpi?.origem       ?? 'todas',
    meta:         kpi?.meta         ?? '',
    valor_manual: kpi?.valor_manual ?? '',
    unidade:      kpi?.unidade      ?? '',
    categoria:    kpi?.categoria    ?? 'outros',
    ativo:        kpi?.ativo        ?? true,
    mostrar_lista: kpi?.mostrar_lista ?? false,
  })
  const [salvando, setSalvando] = useState(false)
  const set = (c, v) => setForm(f => ({ ...f, [c]: v }))

  const salvar = async () => {
    if (!form.titulo.trim()) { alert('Informe o título do KPI'); return }
    setSalvando(true)
    try {
      const body = { ...form, meta: form.meta === '' ? null : form.meta,
                     valor_manual: form.valor_manual === '' ? null : form.valor_manual }
      // Categoria só é escolhida à mão nos KPIs manuais; nos demais é derivada do tipo
      if (form.tipo !== 'manual') delete body.categoria
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
          <label style={{ fontSize: '.75rem', color: '#666' }}>
            Categoria<br />
            <select style={inStyle} value={form.categoria} onChange={e => set('categoria', e.target.value)}>
              {Object.entries(categorias || {}).map(([c, label]) => <option key={c} value={c}>{label}</option>)}
            </select>
          </label>
        </>
      )}
      {(form.tipo.startsWith('os_') || form.tipo.startsWith('fin_')) && (
        <label style={{ fontSize: '.8rem', color: '#666', display: 'flex', alignItems: 'center', gap: 4, paddingBottom: 6 }}>
          <input type="checkbox" checked={form.mostrar_lista} onChange={e => set('mostrar_lista', e.target.checked)} />
          Listar clientes fora da meta
        </label>
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

      {/* ── Cards agrupados por categoria ── */}
      {dados && Object.entries(dados.categorias || {}).map(([cat, label]) => {
        const doGrupo = visiveis.filter(k => k.categoria === cat)
        if (doGrupo.length === 0) return null
        return (
          <div key={cat}>
            <h2 style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--roxo)',
                         textTransform: 'uppercase', letterSpacing: '0.06em',
                         margin: '0.4rem 0 0.7rem' }}>
              {label}
            </h2>
            <div className="kpi-row">
              {doGrupo.map(k => <KpiCard key={k.id} k={k} />)}
            </div>
          </div>
        )
      })}

      {/* ── Listas de clientes fora da meta (KPIs com a flag ligada) ── */}
      {dados && visiveis
        .filter(k => k.mostrar_lista &&
          (k.tipo.startsWith('fin_') || (k.tipo.startsWith('os_') && k.meta !== null)))
        .map(k => <ListaProblemas key={`lista-${k.id}`} kpi={k} mes={mes} ano={ano} />)}

      {/* ── Gerenciamento (admin) ── */}
      {config && dados && (
        <div className="card">
          <h2 style={{ color: 'var(--roxo)', marginBottom: '1rem' }}>Gerenciar KPIs</h2>

          <KpiForm tipos={dados.tipos} origens={dados.origens} categorias={dados.categorias}
                   onSalvo={() => carregar()} />

          <table style={{ width: '100%', marginTop: '1.2rem', borderCollapse: 'collapse', fontSize: '.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#666', borderBottom: '2px solid #eee' }}>
                <th style={{ padding: '0.5rem' }}>KPI</th>
                <th>Métrica</th>
                <th>Cidade</th>
                <th>Meta</th>
                <th>Valor atual</th>
                <th>Lista</th>
                <th>Visível</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {dados.kpis.map(k => editando === k.id ? (
                <tr key={k.id}>
                  <td colSpan={8} style={{ padding: '0.5rem 0' }}>
                    <KpiForm kpi={k} tipos={dados.tipos} origens={dados.origens} categorias={dados.categorias}
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
                  <td>{k.mostrar_lista ? '✔' : '—'}</td>
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
