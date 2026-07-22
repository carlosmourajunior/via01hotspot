"""Cliente da API oficial do WhatsApp (Meta Cloud API).

Convive com evolution.py, que continua atendendo o portal (OTP) e o funil.
A diferença que importa: aqui só é possível iniciar conversa por *template*
previamente aprovado pela Meta — é o que a régua de cobrança usa.

Credenciais ficam no .env, no mesmo padrão de IXC_TOKEN e EVOLUTION_API_KEY.
"""
from os import environ

import requests

API_VERSION = environ.get("WHATSAPP_API_VERSION", "v21.0")
TOKEN = environ.get("WHATSAPP_TOKEN", "")
PHONE_NUMBER_ID = environ.get("WHATSAPP_PHONE_NUMBER_ID", "")
WABA_ID = environ.get("WHATSAPP_WABA_ID", "")

BASE_URL = f"https://graph.facebook.com/{API_VERSION}"


def configurado() -> bool:
    return bool(TOKEN and PHONE_NUMBER_ID)


def _headers() -> dict:
    return {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}


def _erro_da_meta(resp) -> str:
    """A Meta devolve o motivo em error.message; o texto cru é o fallback."""
    try:
        erro = resp.json().get("error", {})
    except ValueError:
        return f"HTTP {resp.status_code}: {resp.text[:200]}"
    partes = [erro.get("message") or f"HTTP {resp.status_code}"]
    if erro.get("error_user_msg"):
        partes.append(erro["error_user_msg"])
    return " — ".join(partes)


def criar_template(nome: str, idioma: str, categoria: str, corpo: str,
                   exemplos: list, rodape: str = None) -> dict:
    """Submete um template à Meta. Devolve {id, status, category}.

    `exemplos` são os valores de amostra das variáveis {{1}}, {{2}}… — a Meta
    recusa o template sem eles quando o corpo tem variáveis.
    """
    if not TOKEN or not WABA_ID:
        raise RuntimeError("WHATSAPP_TOKEN e WHATSAPP_WABA_ID não configurados no .env.")

    componentes = [{"type": "BODY", "text": corpo}]
    if exemplos:
        componentes[0]["example"] = {"body_text": [list(exemplos)]}
    if rodape:
        componentes.append({"type": "FOOTER", "text": rodape})

    resp = requests.post(
        f"{BASE_URL}/{WABA_ID}/message_templates",
        json={
            "name": nome,
            "language": idioma,
            "category": categoria,
            "components": componentes,
        },
        headers=_headers(),
        timeout=30,
    )
    if not resp.ok:
        raise RuntimeError(_erro_da_meta(resp))
    return resp.json()


def listar_templates() -> list:
    """Todos os templates da WABA, com o status atual da revisão da Meta."""
    if not TOKEN or not WABA_ID:
        raise RuntimeError("WHATSAPP_TOKEN e WHATSAPP_WABA_ID não configurados no .env.")

    resp = requests.get(
        f"{BASE_URL}/{WABA_ID}/message_templates",
        params={
            "fields": "id,name,status,category,language,rejected_reason,components",
            "limit": 200,
        },
        headers=_headers(),
        timeout=30,
    )
    if not resp.ok:
        raise RuntimeError(_erro_da_meta(resp))
    return resp.json().get("data", [])


def excluir_template(nome: str) -> None:
    """Remove o template na Meta (ela apaga por nome, não por id)."""
    if not TOKEN or not WABA_ID:
        raise RuntimeError("WHATSAPP_TOKEN e WHATSAPP_WABA_ID não configurados no .env.")

    resp = requests.delete(
        f"{BASE_URL}/{WABA_ID}/message_templates",
        params={"name": nome},
        headers=_headers(),
        timeout=30,
    )
    if not resp.ok:
        raise RuntimeError(_erro_da_meta(resp))


def info_numero() -> dict:
    """Dados do número remetente. Serve de teste de conexão: valida token,
    Phone number ID e permissões de uma vez só."""
    if not configurado():
        raise RuntimeError("WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID não configurados no .env.")

    resp = requests.get(
        f"{BASE_URL}/{PHONE_NUMBER_ID}",
        params={"fields": "display_phone_number,verified_name,quality_rating,platform_type"},
        headers=_headers(),
        timeout=15,
    )
    if not resp.ok:
        raise RuntimeError(_erro_da_meta(resp))
    return resp.json()
