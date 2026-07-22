"""Régua de cobrança — área administrativa (protegida pelo middleware JWT).

Fase 2: só a tela de Integração. Mostra o estado das duas pontas —
o IXC, de onde vêm os títulos, e a API oficial do WhatsApp, por onde as
mensagens vão sair.
"""
from datetime import datetime, timedelta
from os import environ
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException

import db
import whatsapp_oficial

router = APIRouter()

_TZ_LOCAL = ZoneInfo(environ.get("TZ", "America/Sao_Paulo"))


def _proxima_execucao(hora_agendada: str):
    """Mesmo cálculo do agendador do main.py, só que sem dormir."""
    if not hora_agendada:
        return None
    try:
        hora, minuto = (int(x) for x in hora_agendada.split(":"))
    except ValueError:
        return None
    agora = datetime.now(_TZ_LOCAL)
    proximo = agora.replace(hour=hora, minute=minuto, second=0, microsecond=0)
    if proximo <= agora:
        proximo += timedelta(days=1)
    return proximo


@router.get("/api/cobranca/integracao")
def status_integracao():
    """Estado do IXC (último sincronismo e volume de títulos) e do WhatsApp."""
    conn = db.get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT MAX(synced_at) FROM ixc_areceber
            """)
            ultimo_sync = cur.fetchone()[0]

            cur.execute("""
                SELECT COUNT(*),
                       COUNT(*) FILTER (WHERE status = 'A' AND valor_aberto > 0),
                       COUNT(*) FILTER (WHERE status = 'A' AND valor_aberto > 0
                                          AND data_vencimento < CURRENT_DATE),
                       COALESCE(SUM(valor_aberto) FILTER (WHERE status = 'A' AND valor_aberto > 0), 0)
                FROM ixc_areceber
            """)
            total, abertos, vencidos, valor_aberto = cur.fetchone()

            cur.execute("SELECT MAX(synced_at) FROM ixc_clientes")
            sync_clientes = cur.fetchone()[0]
    finally:
        conn.close()

    hora_agendada = environ.get("IXC_SYNC_HORA", "08:00")
    proxima = _proxima_execucao(hora_agendada)

    return {
        "ixc": {
            "ultimo_sync_titulos":  ultimo_sync.isoformat() if ultimo_sync else None,
            "ultimo_sync_clientes": sync_clientes.isoformat() if sync_clientes else None,
            "hora_agendada":        hora_agendada or None,
            "proxima_execucao":     proxima.isoformat() if proxima else None,
            "titulos_total":        total,
            "titulos_abertos":      abertos,
            "titulos_vencidos":     vencidos,
            "valor_aberto":         float(valor_aberto or 0),
        },
        "whatsapp": {
            "configurado":     whatsapp_oficial.configurado(),
            "phone_number_id": whatsapp_oficial.PHONE_NUMBER_ID or None,
            "waba_id":         whatsapp_oficial.WABA_ID or None,
            "api_version":     whatsapp_oficial.API_VERSION,
        },
    }


@router.post("/api/cobranca/whatsapp/testar")
def testar_whatsapp():
    """Consulta o número na Meta: valida token, ID e permissões de uma vez."""
    try:
        info = whatsapp_oficial.info_numero()
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Falha ao falar com a Meta: {e}")

    return {
        "message": "Conexão com a API oficial funcionando.",
        "numero":         info.get("display_phone_number"),
        "nome_exibicao":  info.get("verified_name"),
        "qualidade":      info.get("quality_rating"),
    }
