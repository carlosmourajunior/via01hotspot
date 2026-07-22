/* Régua de cobrança — Modelos de mensagem (Fase 3).
 *
 * Diferente dos modelos do Funil (que são texto livre enviado pela Evolution),
 * estes são templates da API oficial: passam por aprovação da Meta, que
 * devolve status e categoria (UTILITY / MARKETING / AUTHENTICATION).
 */
export default function Modelos() {
  return (
    <div className="page">
      <div className="page-header">
        <h1>Cobrança — Modelos de MSG</h1>
      </div>
      <div className="card">
        <div className="em-breve">
          <span>📝</span>
          <p>Em breve: cadastro e submissão de templates à Meta.</p>
          <p style={{ fontSize: '.9rem' }}>
            Depende das credenciais da API oficial (aba Integração).
          </p>
        </div>
      </div>
    </div>
  )
}
