/* Régua de cobrança — Integração (Fase 2).
 *
 * Duas pontas: o IXC (de onde vêm os títulos, já sincronizado todo dia pelo
 * agendador do main.py) e a API oficial do WhatsApp (para onde vão as
 * mensagens). Esta tela mostra o estado das duas.
 *
 * As credenciais da Meta ficam no .env do servidor, no mesmo padrão do
 * IXC_TOKEN — por isso aqui elas são só exibidas, nunca editadas.
 */
import { useState, useEffect } from 'react'
import axios from 'axios'

function formatDataHora(iso) {
  return iso ? new Date(iso).toLocaleString('pt-BR') : '—'
}

function formatReal(v) {
  return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** "há 3 horas" — o que importa aqui é se o sync está atrasado, não o horário exato. */
function haQuantoTempo(iso) {
  if (!iso) return null
  const minutos = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutos < 60) return `há ${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `há ${horas}h`
  return `há ${Math.floor(horas / 24)} dia(s)`
}

function Campo({ label, children }) {
  return (
    <div style={{ marginBottom: '.6rem' }}>
      <div style={{ fontSize: '.72rem', color: '#8b7fa8', textTransform: 'uppercase', letterSpacing: '.03em' }}>
        {label}
      </div>
      <div style={{ fontSize: '.92rem', color: '#3D1278', fontWeight: 600 }}>{children}</div>
    </div>
  )
}

function Pastilha({ ok, children }) {
  return (
    <span style={{
      padding: '2px 9px', borderRadius: 10, fontSize: '.75rem', fontWeight: 700,
      background: ok ? '#e8f8e8' : '#fdecea', color: ok ? '#1a5e20' : '#a32b20',
    }}>
      {children}
    </span>
  )
}

export default function Integracao() {
  const [dados,   setDados]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [erro,    setErro]    = useState(null)
  const [testando, setTestando] = useState(false)
  const [testeOk, setTesteOk] = useState(null)
  const [testeErro, setTesteErro] = useState(null)

  const carregar = () => {
    setLoading(true); setErro(null)
    axios.get('/api/cobranca/integracao')
      .then(r => setDados(r.data))
      .catch(e => setErro(e.response?.data?.detail || e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { carregar() }, [])

  const testar = () => {
    setTestando(true); setTesteOk(null); setTesteErro(null)
    axios.post('/api/cobranca/whatsapp/testar', {}, { timeout: 30000 })
      .then(r => setTesteOk(r.data))
      .catch(e => setTesteErro(e.response?.data?.detail || e.message))
      .finally(() => setTestando(false))
  }

  const ixc = dados?.ixc
  const wa  = dados?.whatsapp

  // Sync do dia anterior significa que o agendador falhou ou o container caiu
  const syncAtrasado = ixc?.ultimo_sync_titulos &&
    (Date.now() - new Date(ixc.ultimo_sync_titulos).getTime()) > 36 * 3600 * 1000

  return (
    <div className="page">
      <div className="page-header">
        <h1>Cobrança — Integração</h1>
        <button className="btn-secondary" onClick={carregar} disabled={loading}>
          {loading ? 'Atualizando…' : '↻ Atualizar'}
        </button>
      </div>

      {erro && <div className="alert-error">{erro}</div>}

      {dados && (
        <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>

          {/* ── IXC ── */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0, fontSize: '1rem', color: '#3D1278' }}>🗄️ IXC — origem dos títulos</h2>
              <Pastilha ok={!syncAtrasado}>{syncAtrasado ? 'Sync atrasado' : 'Em dia'}</Pastilha>
            </div>

            <Campo label="Último sincronismo dos títulos">
              {formatDataHora(ixc.ultimo_sync_titulos)}{' '}
              <span style={{ fontWeight: 400, color: '#8b7fa8', fontSize: '.82rem' }}>
                {haQuantoTempo(ixc.ultimo_sync_titulos) || ''}
              </span>
            </Campo>
            <Campo label="Último sincronismo dos clientes">
              {formatDataHora(ixc.ultimo_sync_clientes)}
            </Campo>
            <Campo label="Sincronismo automático">
              {ixc.hora_agendada
                ? <>todo dia às {ixc.hora_agendada} · próxima {formatDataHora(ixc.proxima_execucao)}</>
                : <span style={{ color: '#a32b20' }}>desativado (IXC_SYNC_HORA vazio)</span>}
            </Campo>

            <div style={{
              display: 'flex', gap: '1.2rem', flexWrap: 'wrap',
              borderTop: '1px solid #eee7f7', paddingTop: '.8rem', marginTop: '.4rem',
            }}>
              <div>
                <div style={{ fontSize: '.72rem', color: '#8b7fa8' }}>EM ABERTO</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#3D1278' }}>{ixc.titulos_abertos}</div>
              </div>
              <div>
                <div style={{ fontSize: '.72rem', color: '#8b7fa8' }}>VENCIDOS</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#c0392b' }}>{ixc.titulos_vencidos}</div>
              </div>
              <div>
                <div style={{ fontSize: '.72rem', color: '#8b7fa8' }}>VALOR EM ABERTO</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#3D1278' }}>{formatReal(ixc.valor_aberto)}</div>
              </div>
            </div>
          </div>

          {/* ── WhatsApp oficial ── */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0, fontSize: '1rem', color: '#3D1278' }}>💬 WhatsApp oficial (Meta)</h2>
              <Pastilha ok={wa.configurado}>{wa.configurado ? 'Configurado' : 'Não configurado'}</Pastilha>
            </div>

            {wa.configurado ? (
              <>
                <Campo label="Phone number ID">{wa.phone_number_id}</Campo>
                <Campo label="WABA ID">{wa.waba_id || '—'}</Campo>
                <Campo label="Versão da API">{wa.api_version}</Campo>
              </>
            ) : (
              <p style={{ fontSize: '.87rem', color: '#6b5f80', lineHeight: 1.5 }}>
                Defina <code>WHATSAPP_TOKEN</code>, <code>WHATSAPP_PHONE_NUMBER_ID</code> e{' '}
                <code>WHATSAPP_WABA_ID</code> no <code>.env</code> do servidor e reinicie o
                container <code>admin</code>. Os valores estão em developers.facebook.com →
                seu app → WhatsApp → Configuração da API.
              </p>
            )}

            <button className="btn-primary" onClick={testar} disabled={testando || !wa.configurado}
              style={{ marginTop: '.6rem' }}>
              {testando ? 'Testando…' : '🔌 Testar conexão'}
            </button>

            {testeOk && (
              <div className="alert-success" style={{ marginTop: '.8rem' }}>
                {testeOk.message}<br />
                <span style={{ fontSize: '.85rem' }}>
                  Número: <strong>{testeOk.numero || '—'}</strong> ·
                  Nome: <strong>{testeOk.nome_exibicao || '—'}</strong> ·
                  Qualidade: <strong>{testeOk.qualidade || '—'}</strong>
                </span>
              </div>
            )}
            {testeErro && <div className="alert-error" style={{ marginTop: '.8rem' }}>{testeErro}</div>}
          </div>
        </div>
      )}
    </div>
  )
}
