/* Envio de WhatsApp para leads + biblioteca de modelos de mensagem.
 *
 * Os modelos ficam em hotspot_msg_modelos e são compartilhados entre o envio
 * em massa (visão em lista) e o envio individual (modal do lead).
 */
import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'

/** Carrega e mantém a lista de modelos. */
export function useModelos() {
  const [modelos, setModelos] = useState([])

  const recarregar = useCallback(() => (
    axios.get('/api/leads/modelos')
      .then(r => { setModelos(r.data); return r.data })
      .catch(() => [])
  ), [])

  useEffect(() => { recarregar() }, [recarregar])

  return { modelos, recarregar }
}

const boxModal = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1100,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
}

const estiloTextarea = {
  width: '100%', boxSizing: 'border-box', resize: 'vertical',
  padding: '.7rem .8rem', borderRadius: 8, border: '1px solid #d5cbe6',
  fontFamily: 'inherit', fontSize: '.9rem',
}

/** Barra de modelos: escolher um, salvar o texto atual, abrir o gerenciador. */
export function BarraModelos({ modelos, texto, onEscolher, onSalvo, onGerenciar }) {
  const [salvando, setSalvando] = useState(false)

  const salvarComoModelo = () => {
    const titulo = window.prompt('Nome do modelo (usar o mesmo nome sobrescreve):')
    if (titulo === null) return
    setSalvando(true)
    axios.post('/api/leads/modelos', { titulo, texto })
      .then(() => onSalvo?.())
      .catch(e => window.alert(e.response?.data?.detail || e.message))
      .finally(() => setSalvando(false))
  }

  return (
    <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap', margin: '0 0 .5rem' }}>
      <select
        className="filtro-input"
        value=""
        onChange={e => {
          const m = modelos.find(x => String(x.id) === e.target.value)
          if (m) onEscolher(m.texto)
        }}
        style={{ flex: '1 1 180px', minWidth: 160 }}
      >
        <option value="">📋 Usar um modelo…</option>
        {modelos.map(m => <option key={m.id} value={m.id}>{m.titulo}</option>)}
      </select>
      <button
        className="btn-secondary"
        onClick={salvarComoModelo}
        disabled={salvando || (texto || '').trim().length < 3}
        title="Salva o texto atual como modelo reutilizável"
      >
        {salvando ? 'Salvando…' : '💾 Salvar como modelo'}
      </button>
      <button className="btn-secondary" onClick={onGerenciar} title="Editar ou excluir modelos">⚙️</button>
    </div>
  )
}

/** Gerenciador de modelos: criar, editar e excluir. */
export function ModalModelos({ modelos, onFechar, onMudou }) {
  const [editando, setEditando] = useState(null)   // {id, titulo, texto} — id null = novo
  const [erro, setErro] = useState(null)
  const [salvando, setSalvando] = useState(false)

  const salvar = () => {
    const { id, titulo, texto } = editando
    setSalvando(true); setErro(null)
    const req = id
      ? axios.patch(`/api/leads/modelos/${id}`, { titulo, texto })
      : axios.post('/api/leads/modelos', { titulo, texto })
    req
      .then(() => { setEditando(null); onMudou() })
      .catch(e => setErro(e.response?.data?.detail || e.message))
      .finally(() => setSalvando(false))
  }

  const remover = (m) => {
    if (!window.confirm(`Excluir o modelo "${m.titulo}"?`)) return
    axios.delete(`/api/leads/modelos/${m.id}`)
      .then(() => onMudou())
      .catch(e => setErro(e.response?.data?.detail || e.message))
  }

  return (
    <div style={boxModal}>
      <div style={{
        background: '#fff', borderRadius: 12, padding: '1.5rem', width: '100%',
        maxWidth: 560, maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '1.05rem', color: '#3D1278' }}>📋 Modelos de mensagem</h2>
          <button className="btn-secondary" onClick={onFechar} style={{ padding: '.2rem .6rem' }}>✕</button>
        </div>

        {erro && <div className="alert-error" style={{ marginTop: '.8rem' }}>{erro}</div>}

        {editando ? (
          <div style={{ marginTop: '1rem' }}>
            <input
              className="filtro-input"
              placeholder="Nome do modelo"
              value={editando.titulo}
              onChange={e => setEditando({ ...editando, titulo: e.target.value })}
              style={{ width: '100%', boxSizing: 'border-box', marginBottom: '.5rem' }}
            />
            <textarea
              rows={5}
              placeholder={'Olá {nome}! …'}
              value={editando.texto}
              onChange={e => setEditando({ ...editando, texto: e.target.value })}
              style={estiloTextarea}
            />
            <div style={{ display: 'flex', gap: '.6rem', marginTop: '.6rem' }}>
              <button className="btn-primary" onClick={salvar} disabled={salvando}>
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
              <button className="btn-secondary" onClick={() => setEditando(null)} disabled={salvando}>
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              className="btn-primary"
              onClick={() => setEditando({ id: null, titulo: '', texto: '' })}
              style={{ margin: '1rem 0 .8rem' }}
            >
              + Novo modelo
            </button>
            {modelos.length === 0 && (
              <p style={{ fontSize: '.85rem', color: '#6b5f80' }}>
                Nenhum modelo salvo ainda. Crie um aqui ou use “Salvar como modelo” ao escrever uma mensagem.
              </p>
            )}
            {modelos.map(m => (
              <div key={m.id} style={{
                border: '1px solid #e5dff0', borderRadius: 8, padding: '.6rem .7rem', marginBottom: '.5rem',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem' }}>
                  <strong style={{ fontSize: '.88rem', color: '#3D1278' }}>{m.titulo}</strong>
                  <div style={{ display: 'flex', gap: '.35rem', flexShrink: 0 }}>
                    <button className="btn-secondary" style={{ padding: '.15rem .5rem' }}
                      onClick={() => setEditando({ id: m.id, titulo: m.titulo, texto: m.texto })}>
                      ✎
                    </button>
                    <button className="btn-secondary" style={{ padding: '.15rem .5rem' }}
                      onClick={() => remover(m)}>
                      🗑
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: '.8rem', color: '#6b5f80', whiteSpace: 'pre-wrap', marginTop: '.3rem' }}>
                  {m.texto}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

/** Modal de envio em massa (visão em lista do funil). */
export function ModalEnvioLeads({ total, enviando, modelos, onRecarregarModelos, onEnviar, onFechar }) {
  const [msg, setMsg] = useState('')
  const [gerenciando, setGerenciando] = useState(false)

  return (
    <div style={boxModal}>
      <div style={{
        background: '#fff', borderRadius: 12, padding: '1.5rem', width: '100%',
        maxWidth: 520, boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        <h2 style={{ margin: '0 0 .25rem', fontSize: '1.1rem', color: '#3D1278' }}>
          📨 Enviar WhatsApp para {total} lead{total > 1 ? 's' : ''}
        </h2>
        <p style={{ margin: '0 0 1rem', fontSize: '.82rem', color: '#6b5f80' }}>
          Use <code style={{ background: '#f0f0f0', padding: '0 4px', borderRadius: 4 }}>{'{nome}'}</code>{' '}
          para incluir o primeiro nome do lead. Quem está em “Novo Lead” passa para “Contatado”.
        </p>

        <BarraModelos
          modelos={modelos}
          texto={msg}
          onEscolher={setMsg}
          onSalvo={onRecarregarModelos}
          onGerenciar={() => setGerenciando(true)}
        />

        <textarea
          value={msg}
          onChange={e => setMsg(e.target.value)}
          placeholder={'Olá {nome}! A Via01 tem uma oferta especial de internet fibra para você…'}
          rows={6}
          autoFocus
          style={estiloTextarea}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
          <span style={{ fontSize: '.78rem', color: '#95a5a6' }}>{msg.trim().length} caracteres</span>
          <div style={{ display: 'flex', gap: '.6rem' }}>
            <button className="btn-secondary" onClick={onFechar} disabled={enviando}>Cancelar</button>
            <button className="btn-primary" onClick={() => onEnviar(msg)}
              disabled={enviando || msg.trim().length < 3}>
              {enviando ? `Enviando… (~${total}s)` : 'Enviar mensagens'}
            </button>
          </div>
        </div>

        {gerenciando && (
          <ModalModelos
            modelos={modelos}
            onFechar={() => setGerenciando(false)}
            onMudou={onRecarregarModelos}
          />
        )}
      </div>
    </div>
  )
}
