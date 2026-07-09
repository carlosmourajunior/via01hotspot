"""Rotas do admin para os acessos do hotspot (protegidas pelo middleware JWT do main.py)."""
import psycopg2.extras
from fastapi import APIRouter

import db

router = APIRouter()


@router.get("/api/guests")
def listar_guests():
    conn = db.get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, phone, name, mac, ap, is_client, client_status, connected_at
                FROM hotspot_guests
                ORDER BY connected_at DESC
                """
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    return [{**r, "connected_at": r["connected_at"].isoformat()} for r in rows]


@router.post("/api/guests/reclassificar")
def reclassificar_guests():
    """Reclassifica todos os acessos contra a base IXC atual.

    Útil após rodar os syncs de clientes/contratos, ou para classificar o
    histórico importado do sistema antigo.
    """
    conn = db.get_conn()
    atualizados = 0
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, phone FROM hotspot_guests")
            registros = cur.fetchall()
        for reg_id, phone in registros:
            status = db.classificar_telefone(conn, phone)
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE hotspot_guests SET client_status = %s, is_client = %s WHERE id = %s",
                    (status, status == "cliente", reg_id),
                )
            atualizados += 1
        conn.commit()
    finally:
        conn.close()
    return {"message": f"{atualizados} acessos reclassificados.", "total": atualizados}
