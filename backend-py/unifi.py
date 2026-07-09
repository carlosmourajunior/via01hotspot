"""Cliente da UniFi Network Integration API (autenticação por API Key).

Port fiel de backend/server.js: resolve o site, encontra o cliente pelo MAC
(paginação) e autoriza o acesso de convidado.
"""
from os import environ

import requests
import urllib3

# O controller usa certificado self-signed (mesmo comportamento do Node:
# rejectUnauthorized: false)
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

UNIFI_URL = environ.get("UNIFI_URL", "")
UNIFI_API_KEY = environ.get("UNIFI_API_KEY", "")
UNIFI_SITE = environ.get("UNIFI_SITE", "default")

_BASE = f"{UNIFI_URL}/proxy/network/integrations/v1"

_session = requests.Session()
_session.verify = False
_session.headers["X-API-KEY"] = UNIFI_API_KEY

# Id do site resolvido a partir do nome (UNIFI_SITE), cacheado em memória
_site_id = None


def get_site_id():
    global _site_id
    if _site_id:
        return _site_id

    resp = _session.get(f"{_BASE}/sites", timeout=15)
    resp.raise_for_status()
    sites = resp.json()["data"]
    site = next((s for s in sites if s.get("internalReference") == UNIFI_SITE), None) or (sites[0] if sites else None)
    if not site:
        raise RuntimeError("Nenhum site encontrado no UniFi.")

    _site_id = site["id"]
    return _site_id


def find_client_id_by_mac(site_id: str, mac: str):
    normalized = mac.lower()
    limit, offset = 200, 0

    while True:
        resp = _session.get(
            f"{_BASE}/sites/{site_id}/clients",
            params={"limit": limit, "offset": offset},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        match = next((c for c in data["data"] if (c.get("macAddress") or "").lower() == normalized), None)
        if match:
            return match["id"]

        offset += limit
        if offset >= data.get("totalCount", 0):
            return None


def authorize(mac: str, minutes: int = 480):
    site_id = get_site_id()
    client_id = find_client_id_by_mac(site_id, mac)

    if not client_id:
        raise RuntimeError(
            f"Cliente com MAC {mac} não encontrado no UniFi (precisa estar conectado à rede de convidados)."
        )

    resp = _session.post(
        f"{_BASE}/sites/{site_id}/clients/{client_id}/actions",
        json={"action": "AUTHORIZE_GUEST_ACCESS", "timeLimitMinutes": minutes},
        timeout=15,
    )
    resp.raise_for_status()
