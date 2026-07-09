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
                SELECT id, phone, mac, ap, is_client, connected_at
                FROM hotspot_guests
                ORDER BY connected_at DESC
                """
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    return [{**r, "connected_at": r["connected_at"].isoformat()} for r in rows]
