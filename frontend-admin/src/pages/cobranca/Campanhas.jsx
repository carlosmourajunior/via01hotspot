/* Régua de cobrança — Campanhas (Fase 4).
 *
 * Cada campanha define uma janela (data início/fim), a origem dos títulos
 * (hoje só IXC), quando disparar em relação ao vencimento (antes / no dia /
 * depois) e qual modelo aprovado usar.
 */
export default function Campanhas() {
  return (
    <div className="page">
      <div className="page-header">
        <h1>Cobrança — Campanhas</h1>
      </div>
      <div className="card">
        <div className="em-breve">
          <span>🗓️</span>
          <p>Em breve: cadastro das réguas de cobrança.</p>
          <p style={{ fontSize: '.9rem' }}>
            Depende dos modelos aprovados pela Meta (aba Modelos de MSG).
          </p>
        </div>
      </div>
    </div>
  )
}
