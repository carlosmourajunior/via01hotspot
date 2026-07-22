/* Régua de cobrança — Modelos de mensagem (Fase 3).
 *
 * Diferente dos modelos do Funil (texto livre pela Evolution), estes são
 * templates da API oficial: passam pela revisão da Meta, que devolve status
 * e categoria. Quem decide o enquadramento é ela, não nós — por isso a tela
 * mostra lado a lado a categoria pedida e a que voltou.
 */
import { useState, useEffect, useMemo } from 'react'
import axios from 'axios'

const STATUS_CFG = {
  RASCUNHO: { label: 'Rascunho',  bg: '#eef1f4', cor: '#5d6d7e' },
  PENDING:  { label: 'Em análise', bg: '#fef7e0', cor: '#8a6d1a' },
  APPROVED: { label: 'Aprovado',  bg: '#e8f8e8', cor: '#1a5e20' },
  REJECTED: { label: 'Rejeitado', bg: '#fdecea', cor: '#a32b20' },
  PAUSED:   { label: 'Pausado',   bg: '#fdecea', cor: '#a32b20' },
}

function BadgeStatus({ status }) {
  const cfg = STATUS_CFG[status] || { label: status, bg: '#eef1f4', cor: '#5d6d7e' }
  return (
    <span style={{
      padding: '2px 9px', borderRadius: 10, fontSize: '.75rem', fontWeight: 700,
      background: cfg.bg, color: cfg.cor, whiteSpace: 'nowrap',
    }}>
      {cfg.label}
    </span>
  )
}

const VAZIO = {
  nome: '', idioma: 'pt_BR', categoria_solicitada: 'UTILITY',
  corpo: '', rodape: '', variaveis: [],
}

function Formulario({ inicial, campos, onSalvar, onCancelar, salvando }) {
  const [f, setF] = useState(inicial)

  // O número de variáveis vem do próprio texto: {{1}}, {{2}}…
  const qtdVars = useMemo(() => {
    const achadas = (f.corpo || '').match(/\{\{(\d+)\}\}/g) || []
    return new Set(achadas).size
  }, [f.corpo])

  // Mantém a lista de configuração do mesmo tamanho que o texto pede
  useEffect(() => {
    setF(prev => {
      const vars = [...(prev.variaveis || [])]
      while (vars.length < qtdVars) vars.push({ campo: 'nome', exemplo: '' })
      return { ...prev, variaveis: vars.slice(0, qtdVars) }
    })
  }, [qtdVars])

  const setVar = (i, chave, valor) => setF(prev => {
    const vars = [...prev.variaveis]
    vars[i] = { ...vars[i], [chave]: valor }
    return { ...prev, variaveis: vars }
  })

  const inserirVar = () => setF(prev => ({
    ...prev, corpo: `${prev.corpo}{{${qtdVars + 1}}}`,
  }))

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#3D1278' }}>
        {inicial.id ? 'Editar modelo' : 'Novo modelo'}
      </h2>

      <div style={{ display: 'grid', gap: '.8rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <div>
          <label style={{ fontSize: '.78rem', color: '#6b5f80' }}>Nome do template</label>
          <input
            className="filtro-input"
            placeholder="aviso_vencimento_3dias"
            value={f.nome}
            onChange={e => setF({ ...f, nome: e.target.value.toLowerCase() })}
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
          <div style={{ fontSize: '.72rem', color: '#8b7fa8' }}>só minúsculas, números e _</div>
        </div>
        <div>
          <label style={{ fontSize: '.78rem', color: '#6b5f80' }}>Categoria</label>
          <select className="filtro-input" value={f.categoria_solicitada}
            onChange={e => setF({ ...f, categoria_solicitada: e.target.value })}
            style={{ width: '100%', boxSizing: 'border-box' }}>
            <option value="UTILITY">UTILITY (cobrança/transacional)</option>
            <option value="MARKETING">MARKETING (promocional)</option>
          </select>
          <div style={{ fontSize: '.72rem', color: '#8b7fa8' }}>a Meta pode recategorizar</div>
        </div>
        <div>
          <label style={{ fontSize: '.78rem', color: '#6b5f80' }}>Idioma</label>
          <select className="filtro-input" value={f.idioma}
            onChange={e => setF({ ...f, idioma: e.target.value })}
            style={{ width: '100%', boxSizing: 'border-box' }}>
            <option value="pt_BR">Português (BR)</option>
            <option value="en_US">Inglês (US)</option>
          </select>
        </div>
      </div>

      <div style={{ marginTop: '.9rem' }}>
        <label style={{ fontSize: '.78rem', color: '#6b5f80' }}>
          Corpo da mensagem — use {'{{1}}'}, {'{{2}}'}… nas partes que mudam
        </label>
        <textarea
          rows={4}
          value={f.corpo}
          onChange={e => setF({ ...f, corpo: e.target.value })}
          placeholder="Olá {{1}}, sua fatura de {{2}} vence em {{3}}. Qualquer dúvida, fale com a gente."
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'vertical',
            padding: '.7rem .8rem', borderRadius: 8, border: '1px solid #d5cbe6',
            fontFamily: 'inherit', fontSize: '.9rem',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.75rem', color: '#8b7fa8' }}>
          <button className="btn-secondary" onClick={inserirVar} style={{ padding: '.1rem .5rem', fontSize: '.75rem' }}>
            + variável
          </button>
          <span>{f.corpo.length}/1024 · não pode começar nem terminar com variável</span>
        </div>
      </div>

      {f.variaveis.length > 0 && (
        <div style={{ marginTop: '.9rem' }}>
          <div style={{ fontSize: '.78rem', color: '#6b5f80', marginBottom: '.4rem' }}>
            O que entra em cada variável (a régua preenche na hora do envio)
          </div>
          {f.variaveis.map((v, i) => (
            <div key={i} style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginBottom: '.4rem' }}>
              <code style={{ background: '#f0edff', padding: '2px 6px', borderRadius: 4, fontSize: '.8rem' }}>
                {`{{${i + 1}}}`}
              </code>
              <select className="filtro-input" value={v.campo}
                onChange={e => setVar(i, 'campo', e.target.value)} style={{ flex: '1 1 160px' }}>
                {campos.map(c => <option key={c.campo} value={c.campo}>{c.descricao}</option>)}
              </select>
              <input className="filtro-input" placeholder="exemplo p/ a Meta"
                value={v.exemplo || ''} onChange={e => setVar(i, 'exemplo', e.target.value)}
                style={{ flex: '1 1 140px' }} />
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: '.9rem' }}>
        <label style={{ fontSize: '.78rem', color: '#6b5f80' }}>Rodapé (opcional)</label>
        <input className="filtro-input" placeholder="Via01 Telecom"
          value={f.rodape || ''} onChange={e => setF({ ...f, rodape: e.target.value })}
          style={{ width: '100%', boxSizing: 'border-box' }} />
      </div>

      <div style={{ display: 'flex', gap: '.6rem', marginTop: '1rem' }}>
        <button className="btn-primary" onClick={() => onSalvar(f)} disabled={salvando}>
          {salvando ? 'Salvando…' : 'Salvar rascunho'}
        </button>
        <button className="btn-secondary" onClick={onCancelar} disabled={salvando}>Cancelar</button>
      </div>
    </div>
  )
}

export default function Modelos() {
  const [modelos, setModelos] = useState(null)
  const [campos,  setCampos]  = useState([])
  const [editando, setEditando] = useState(null)
  const [loading, setLoading] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro,  setErro]  = useState(null)
  const [aviso, setAviso] = useState(null)

  const carregar = () => {
    setLoading(true); setErro(null)
    axios.get('/api/cobranca/modelos')
      .then(r => setModelos(r.data))
      .catch(e => setErro(e.response?.data?.detail || e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    carregar()
    axios.get('/api/cobranca/modelos/campos').then(r => setCampos(r.data)).catch(() => {})
  }, [])

  const salvar = (f) => {
    setSalvando(true); setErro(null); setAviso(null)
    const req = f.id
      ? axios.patch(`/api/cobranca/modelos/${f.id}`, f)
      : axios.post('/api/cobranca/modelos', f)
    req
      .then(() => { setEditando(null); carregar() })
      .catch(e => setErro(e.response?.data?.detail || e.message))
      .finally(() => setSalvando(false))
  }

  const submeter = (m) => {
    if (!window.confirm(`Enviar "${m.nome}" para revisão da Meta? Depois disso não dá mais para editar.`)) return
    setErro(null); setAviso(null)
    axios.post(`/api/cobranca/modelos/${m.id}/submeter`, {}, { timeout: 60000 })
      .then(r => { setAviso(r.data.message); carregar() })
      .catch(e => setErro(e.response?.data?.detail || e.message))
  }

  const sincronizar = () => {
    setErro(null); setAviso(null); setLoading(true)
    axios.post('/api/cobranca/modelos/sincronizar', {}, { timeout: 60000 })
      .then(r => { setAviso(r.data.message); carregar() })
      .catch(e => { setErro(e.response?.data?.detail || e.message); setLoading(false) })
  }

  const remover = (m) => {
    if (!window.confirm(`Excluir o modelo "${m.nome}"?`)) return
    axios.delete(`/api/cobranca/modelos/${m.id}`)
      .then(r => { setAviso(r.data.message); carregar() })
      .catch(e => setErro(e.response?.data?.detail || e.message))
  }

  const lista = modelos ?? []

  return (
    <div className="page">
      <div className="page-header">
        <h1>Cobrança — Modelos de MSG</h1>
        <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={sincronizar} disabled={loading}
            title="Puxa da Meta o status da revisão de cada template">
            ⟳ Sincronizar com a Meta
          </button>
          <button className="btn-primary" onClick={() => setEditando({ ...VAZIO })}>+ Novo modelo</button>
        </div>
      </div>

      {erro  && <div className="alert-error">{erro}</div>}
      {aviso && <div className="alert-success">{aviso}</div>}

      {editando && (
        <Formulario
          inicial={editando}
          campos={campos}
          salvando={salvando}
          onSalvar={salvar}
          onCancelar={() => setEditando(null)}
        />
      )}

      {lista.map(m => (
        <div key={m.id} className="card" style={{ marginBottom: '.8rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.8rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <strong style={{ color: '#3D1278' }}>{m.nome}</strong>
              <BadgeStatus status={m.status} />
              <span style={{ fontSize: '.75rem', color: '#8b7fa8' }}>{m.idioma}</span>
            </div>
            <div style={{ display: 'flex', gap: '.4rem' }}>
              {['RASCUNHO', 'REJECTED'].includes(m.status) && (
                <>
                  <button className="btn-secondary" style={{ padding: '.15rem .6rem' }}
                    onClick={() => setEditando(m)}>✎ Editar</button>
                  <button className="btn-primary" style={{ padding: '.15rem .6rem' }}
                    onClick={() => submeter(m)}>▲ Submeter</button>
                </>
              )}
              <button className="btn-secondary" style={{ padding: '.15rem .6rem' }}
                onClick={() => remover(m)}>🗑</button>
            </div>
          </div>

          <div style={{ fontSize: '.87rem', color: '#4a3670', whiteSpace: 'pre-wrap', margin: '.6rem 0' }}>
            {m.corpo}
          </div>
          {m.rodape && <div style={{ fontSize: '.78rem', color: '#8b7fa8' }}>{m.rodape}</div>}

          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '.78rem', color: '#6b5f80', marginTop: '.5rem' }}>
            <span>Pedida: <strong>{m.categoria_solicitada}</strong></span>
            {m.categoria_meta && (
              <span style={{ color: m.categoria_meta !== m.categoria_solicitada ? '#a32b20' : '#1a5e20' }}>
                Meta devolveu: <strong>{m.categoria_meta}</strong>
                {m.categoria_meta !== m.categoria_solicitada && ' (muda o custo!)'}
              </span>
            )}
            {(m.variaveis || []).length > 0 && (
              <span>Variáveis: {m.variaveis.map((v, i) => `{{${i + 1}}}=${v.campo}`).join(', ')}</span>
            )}
          </div>

          {m.motivo_rejeicao && (
            <div className="alert-error" style={{ marginTop: '.6rem', marginBottom: 0 }}>
              Rejeitado pela Meta: {m.motivo_rejeicao}
            </div>
          )}
        </div>
      ))}

      {!loading && lista.length === 0 && !editando && (
        <div className="card">
          <div className="em-breve">
            <span>📝</span>
            <p>Nenhum modelo cadastrado ainda.</p>
            <p style={{ fontSize: '.9rem' }}>
              Crie um rascunho, submeta à Meta e acompanhe a aprovação por aqui.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
