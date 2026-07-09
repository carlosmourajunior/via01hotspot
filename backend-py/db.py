"""Conexão Postgres compartilhada + tabelas do hotspot.

Usado tanto pelo app admin (main.py) quanto pelo app do portal (portal.py).
"""
from os import environ

import psycopg2

DATABASE_URL = environ.get("DATABASE_URL", "postgresql://controle:controle@db:5432/controle")


def get_conn():
    return psycopg2.connect(DATABASE_URL)


DDL_HOTSPOT_GUESTS = """
CREATE TABLE IF NOT EXISTS hotspot_guests (
    id           SERIAL PRIMARY KEY,
    phone        TEXT NOT NULL,
    mac          TEXT NOT NULL,
    ap           TEXT,
    is_client    BOOLEAN NOT NULL DEFAULT FALSE,
    connected_at TIMESTAMPTZ NOT NULL,
    UNIQUE (phone, mac, connected_at)
);
"""


def init_hotspot_tables():
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(DDL_HOTSPOT_GUESTS)
        conn.commit()
    finally:
        conn.close()
