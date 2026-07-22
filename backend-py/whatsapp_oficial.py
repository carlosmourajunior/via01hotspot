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
