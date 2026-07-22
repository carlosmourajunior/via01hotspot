/* Régua de cobrança — Integração (Fase 2).
 *
 * Duas pontas: o IXC (de onde vêm os títulos, já sincronizado todo dia pelo
 * agendador do main.py) e a API oficial do WhatsApp (para onde vão as
 * mensagens). Esta tela mostra o estado das duas.
 */
export default function Integracao() {
  return (
    <div className="page">
      <div className="page-header">
        <h1>Cobrança — Integração</h1>
      </div>
      <div className="card">
        <div className="em-breve">
          <span>🔌</span>
          <p>Em breve: status do sincronismo IXC e credenciais do WhatsApp oficial.</p>
        </div>
      </div>
    </div>
  )
}
