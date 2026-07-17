import { useState, useEffect } from 'react'
import axios from 'axios'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'

const CIDADES = [
  { id: 'todas',         label: '🏢 Via01 — Total' },
  { id: 'borda_mata',    label: 'Borda da Mata' },
  { id: 'ouro_fino',     label: 'Ouro Fino' },
  { id: 'inconfidentes', label: 'Inconfidentes' },
]

const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const MESES_FULL  = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

const brl = (v) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function formatPhone(phone) {
  const d = (phone || '').replace(/\D/g, '')
  const local = d.startsWith('55') ? d.slice(2) : d
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`
  return phone || '—'
}

function mesLabel(yyyymm) {
  const [, m] = (yyyymm || '').split('-')
  return m ? MESES_ABREV[Number(m) - 1] : yyyymm
}

function mesLabelFull(yyyymm) {
  const [a, m] = (yyyymm || '').split('-')
  return m ? `${MESES_FULL[Number(m) - 1]}/${a}` : yyyymm
}

const AGING_CORES = { '1-30': '#f39c12', '31-60': '#e67e22', '61-90': '#d35400', '90+': '#c0392b' }

export default function Financeiro() {
  const [cidade,  setCidade]  = useState('todas')
  const [dados,   setDados]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [erro,    setErro]    = useState(null)
  const [aviso,   setAviso]   = useState(null)

  const carregar = (orig = cidade) => {
    setLoading(true); setErro(null)
    axios.get('/api/ixc/financeiro', { params: { origem: orig } })
      .then(r => setDados(r.data))
      .catch(e => setErro(e.response?.data?.detail || e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { carregar(cidade) }, [cidade])  // eslint-disable-line react-hooks/exhaustive-deps

  const sincronizar = async () => {
    setSyncing(true); setErro(null); setAviso(null)
    try {
      // Primeira sync (base vazia) baixa ~180 mil títulos — pode demorar minutos
      const r = await axios.post('/api/ixc/sync-financeiro', null, { timeout: 900000 })
      setAviso(r.data.message)
      carregar(cidade)
    } catch (e) {
      setErro(e.response?.data?.detail || e.message)
    }
    setSyncing(false)
  }

  const mensal = (dados?.mensal ?? []).map(m => ({
    nome: mesLabel(m.mes),
    Faturado: m.faturado,
    Recebido: m.recebido,
    'Em aberto': m.aberto,
  }))

  const caixa = (dados?.caixa_mensal ?? []).map(m => ({
    nome: mesLabel(m.mes),
    Recebido: m.recebido,
    qtd: m.qtd,
  }))

  return (
    <div className="page">
      <div className="page-header">
        <h1>Financeiro — {CIDADES.find(c => c.id === cidade)?.label}</h1>
        <div className="page-actions">
          {dados?.last_sync && (
            <span style={{ fontSize: '.8rem', color: '#888', marginRight: '0.75rem' }}>
              Sync: {new Date(dados.last_sync).toLocaleString('pt-BR')}
            </span>
          )}
          <button className="btn-sync" onClick={sincronizar} disabled={syncing}>
            {syncing ? '⟳ Sincronizando…' : '⟳ Sincronizar financeiro'}
          </button>
        </div>
      </div>

      {erro  && <div className="alert-error">{erro}</div>}
      {aviso && <div className="alert-success">{aviso}</div>}

      <div className="cidade-tabs">
        {CIDADES.map(c => (
          <button key={c.id}
            className={'cidade-tab' + (cidade === c.id ? ' active' : '')}
            onClick={() => setCidade(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {loading && <div className="loading" style={{ padding: '1rem', height: 'auto' }}>Carregando…</div>}

      {!loading && dados?.sem_sync && (
        <div className="card" style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>
          Nenhum título sincronizado ainda. Clique em <strong>Sincronizar financeiro</strong> —
          a primeira execução baixa a base completa (~180 mil títulos) e pode levar alguns minutos.
        </div>
      )}

      {!loading && dados && !dados.sem_sync && (
        <>
          {/* ── KPIs do mês corrente ── */}
          <div className="kpi-row">
            <div className="kpi-card">
              <div className="kpi-value" style={{ color: '#c0392b' }}>{brl(dados.vencido_total)}</div>
              <div className="kpi-label">Vencido em aberto ({dados.vencido_qtd} títulos)</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-value">{brl(dados.faturado_mes)}</div>
              <div className="kpi-label">
                Faturado no mês · anterior: {brl(dados.faturado_mes_anterior)}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-value" style={{ color: '#27ae60' }}>{brl(dados.recebido_mes)}</div>
              <div className="kpi-label">Recebido no mês ({dados.recebido_mes_qtd} títulos, por data de pagamento)</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-value" style={{ color: '#2980b9' }}>
                {brl((dados.previsao ?? [])[0]?.valor)}
              </div>
              <div className="kpi-label">A receber no mês ({(dados.previsao ?? [])[0]?.qtd ?? 0} títulos em aberto)</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-value" style={{ color: '#8e44ad' }}>{brl(dados.arpu)}</div>
              <div className="kpi-label">
                Ticket médio (ARPU) · {dados.logins_ativos || dados.contratos_ativos} logins ativos
              </div>
            </div>
          </div>

          {/* ── Inadimplência: aging ── */}
          <div className="card">
            <h2 style={{ fontSize: '.95rem', fontWeight: 600, color: '#4a3670', marginBottom: '1rem' }}>
              Inadimplência por tempo de atraso
            </h2>
            <div className="kpi-row" style={{ marginBottom: 0 }}>
              {(dados.aging ?? []).map(a => (
                <div key={a.faixa} className="kpi-card" style={{ borderTop: `3px solid ${AGING_CORES[a.faixa]}` }}>
                  <div className="kpi-value" style={{ fontSize: '1.4rem', color: AGING_CORES[a.faixa] }}>{brl(a.valor)}</div>
                  <div className="kpi-label">{a.faixa} dias · {a.qtd} títulos</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Receita mensal ── */}
          <div className="card chart-card">
            <h2>Receita — últimos 12 meses (por mês de vencimento)</h2>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={mensal} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="nome" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => brl(v)} />
                <Legend />
                <Bar dataKey="Faturado"  fill="#3D1278" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Recebido"  fill="#27ae60" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Em aberto" fill="#e74c3c" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* ── Caixa: recebido por mês de pagamento ── */}
          <div className="card chart-card">
            <h2>Caixa — recebido por mês de pagamento</h2>
            <div style={{ fontSize: '.75rem', color: '#888', marginBottom: '0.5rem' }}>
              Quanto entrou de fato em cada mês, independente do vencimento do título.
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={caixa} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="nome" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v, nome, item) => [
                  `${brl(v)} (${item?.payload?.qtd ?? 0} títulos)`, 'Recebido',
                ]} />
                <Bar dataKey="Recebido" fill="#27ae60" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* ── A receber por mês ── */}
          <div className="card">
            <h2 style={{ fontSize: '.95rem', fontWeight: 600, color: '#4a3670', marginBottom: '1rem' }}>
              A receber por mês (títulos em aberto, por vencimento)
            </h2>
            <div className="kpi-row" style={{ marginBottom: 0 }}>
              {(dados.previsao ?? []).map(p => (
                <div key={p.mes} className="kpi-card">
                  <div className="kpi-value" style={{ fontSize: '1.4rem', color: '#2980b9' }}>{brl(p.valor)}</div>
                  <div className="kpi-label">{mesLabelFull(p.mes)} · {p.qtd} títulos</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Top devedores ── */}
          <div className="card">
            <div className="table-header">
              <h2 style={{ color: '#c0392b' }}>
                Maiores devedores
                <span style={{ fontWeight: 400, fontSize: '.88rem', color: '#666', marginLeft: '0.4rem' }}>
                  (top {dados.devedores?.length ?? 0})
                </span>
              </h2>
            </div>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Nome</th><th>Fone</th><th>Cidade</th><th>Bairro</th>
                    <th>Títulos</th><th>Valor vencido</th><th>Maior atraso</th>
                  </tr>
                </thead>
                <tbody>
                  {(dados.devedores ?? []).map((d, i) => (
                    <tr key={i}>
                      <td>{d.nome || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatPhone(d.fone)}</td>
                      <td style={{ fontSize: '.8rem' }}>{d.cidade}</td>
                      <td style={{ fontSize: '.8rem' }}>{d.bairro || '—'}</td>
                      <td>{d.titulos}</td>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 600, color: '#c0392b' }}>{brl(d.valor)}</td>
                      <td>{d.dias_atraso} dias</td>
                    </tr>
                  ))}
                  {(dados.devedores ?? []).length === 0 && (
                    <tr><td colSpan={7} className="sem-resultado">Nenhum título vencido. 🎉</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
