"""Envio do OTP por WhatsApp via Evolution API — port fiel de backend/server.js."""
from os import environ

import requests

EVOLUTION_URL = environ.get("EVOLUTION_URL", "http://localhost:8081")
EVOLUTION_API_KEY = environ.get("EVOLUTION_API_KEY", "")
EVOLUTION_INSTANCE = environ.get("EVOLUTION_INSTANCE", "hotspot")
OTP_TTL_SECONDS = int(environ.get("OTP_TTL_SECONDS", 300))


def send_whatsapp_otp(phone: str, otp: str):
    clean = "".join(ch for ch in phone if ch.isdigit())
    # Garante código do país (Brasil = 55)
    jid = f"{clean}@s.whatsapp.net" if clean.startswith("55") else f"55{clean}@s.whatsapp.net"

    resp = requests.post(
        f"{EVOLUTION_URL}/message/sendText/{EVOLUTION_INSTANCE}",
        json={
            "number": jid,
            "text": f"🔐 Seu código de acesso ao Wi-Fi é: *{otp}*\n\nVálido por {round(OTP_TTL_SECONDS / 60)} minutos.",
        },
        headers={"apikey": EVOLUTION_API_KEY, "Content-Type": "application/json"},
        timeout=15,
    )
    if not resp.ok:
        # A Evolution detalha o motivo no corpo da resposta
        raise RuntimeError(f"Evolution {resp.status_code}: {resp.text}")
