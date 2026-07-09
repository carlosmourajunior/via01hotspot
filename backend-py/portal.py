"""Portal captivo (porta 80) — substitui o backend Node (backend/server.js).

Superfície pública idêntica à do Node:
    POST /api/send-otp    { phone, mac, ap, redirectUrl, isClient }
    POST /api/verify-otp  { phone, otp }
    GET  /health
    demais rotas → SPA estática (build do frontend-portal)

Sem rotas admin e sem JWT — a área administrativa vive no app main.py (porta 8080).
Rodar sempre com 1 worker uvicorn (OTPs em memória).
"""
import random
import re
from datetime import datetime, timezone
from os import environ
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from dotenv import load_dotenv

load_dotenv()

import db
import evolution
import otp_store
import unifi

OTP_LENGTH = int(environ.get("OTP_LENGTH", 6))
SUCCESS_REDIRECT_URL = environ.get("SUCCESS_REDIRECT_URL", "https://www.via01.com.br")

app = FastAPI(title="Via01 Hotspot Portal")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    try:
        db.init_hotspot_tables()
    except Exception as e:  # o portal não pode morrer se o banco estiver fora
        print(f"[DB] Aviso: não foi possível inicializar tabelas: {e}")


def _clean_phone(phone: str) -> str:
    return re.sub(r"\D", "", phone or "")


def _generate_otp(length: int) -> str:
    return str(random.randrange(10**length)).zfill(length)


@app.post("/api/send-otp")
async def send_otp(request: Request):
    body = await request.json()
    phone, mac = body.get("phone"), body.get("mac")
    name = (body.get("name") or "").strip()

    if not phone or not mac:
        return JSONResponse({"error": "Telefone e MAC são obrigatórios."}, status_code=400)

    if len(name) < 3:
        return JSONResponse({"error": "Informe seu nome."}, status_code=400)

    clean_phone = _clean_phone(phone)
    if len(clean_phone) < 10:
        return JSONResponse({"error": "Número de telefone inválido."}, status_code=400)

    otp = _generate_otp(OTP_LENGTH)

    try:
        evolution.send_whatsapp_otp(clean_phone, otp)
    except Exception as e:
        print(f"[OTP] Erro ao enviar WhatsApp: {e}")
        return JSONResponse({"error": "Não foi possível enviar o WhatsApp. Tente novamente."}, status_code=502)

    otp_store.set_otp(clean_phone, {
        "otp": otp,
        "mac": mac,
        "ap": body.get("ap"),
        "redirectUrl": body.get("redirectUrl"),
        "name": name,
    })
    print(f"[OTP] Enviado para {clean_phone} | MAC: {mac}")
    return {"ok": True}


@app.post("/api/verify-otp")
async def verify_otp(request: Request):
    body = await request.json()
    clean_phone = _clean_phone(body.get("phone"))
    otp = body.get("otp")

    entry = otp_store.get_otp(clean_phone)

    if not entry:
        return JSONResponse({"error": "Código expirado ou telefone não encontrado."}, status_code=400)

    if entry["otp"] != otp:
        return JSONResponse({"error": "Código incorreto."}, status_code=400)

    # OTP válido — autoriza no UniFi
    try:
        unifi.authorize(entry["mac"])
    except Exception as e:
        print(f"[AUTH] Erro ao autorizar no UniFi: {e}")
        return JSONResponse({"error": "Erro ao liberar o acesso. Contate o suporte."}, status_code=502)

    otp_store.delete_otp(clean_phone)

    # O registro é secundário: se o banco falhar, o acesso já foi liberado
    try:
        conn = db.get_conn()
        try:
            # Classifica pelo telefone contra a base IXC sincronizada
            try:
                status = db.classificar_telefone(conn, clean_phone)
            except Exception as e:
                print(f"[DB] Erro ao classificar telefone: {e}")
                conn.rollback()  # destrava a transação para o INSERT abaixo
                status = None
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO hotspot_guests (phone, mac, ap, is_client, connected_at, name, client_status)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (phone, mac, connected_at) DO NOTHING
                    """,
                    (
                        clean_phone,
                        entry["mac"],
                        entry.get("ap"),
                        status == "cliente",
                        datetime.now(timezone.utc),
                        entry.get("name"),
                        status,
                    ),
                )
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        print(f"[DB] Erro ao gravar registro de acesso: {e}")

    print(f"[AUTH] MAC {entry['mac']} autorizado para telefone {clean_phone}")
    return {"ok": True, "redirectUrl": SUCCESS_REDIRECT_URL}


@app.get("/health")
def health():
    return {"status": "ok"}


# ─── Frontend estático (build do frontend-portal) + SPA fallback ────────────
_STATIC = Path(__file__).parent / "static_portal"


@app.get("/{full_path:path}")
def spa(full_path: str):
    arquivo = _STATIC / full_path
    if full_path and arquivo.is_file():
        headers = {"Cache-Control": "no-cache"} if full_path.endswith("index.html") else None
        return FileResponse(arquivo, headers=headers)
    # index.html nunca é cacheado (os assets têm hash no nome e podem ser cacheados)
    return FileResponse(_STATIC / "index.html", headers={"Cache-Control": "no-cache"})
