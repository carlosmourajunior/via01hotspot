"""OTPs em memória com TTL — equivalente ao node-cache do backend Node.

Atenção: por ser em memória, o serviço do portal deve rodar com 1 worker
uvicorn (default). Restart perde os OTPs pendentes (o usuário pede outro código).
"""
import time
from os import environ

OTP_TTL_SECONDS = int(environ.get("OTP_TTL_SECONDS", 300))

_store = {}  # phone → (dados: dict, expira_em: float)


def set_otp(phone: str, dados: dict):
    _store[phone] = (dados, time.time() + OTP_TTL_SECONDS)


def get_otp(phone: str):
    entry = _store.get(phone)
    if not entry:
        return None
    dados, expira_em = entry
    if time.time() > expira_em:
        _store.pop(phone, None)
        return None
    return dados


def delete_otp(phone: str):
    _store.pop(phone, None)
