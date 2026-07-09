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
            cur.execute("ALTER TABLE hotspot_guests ADD COLUMN IF NOT EXISTS name TEXT")
            cur.execute("ALTER TABLE hotspot_guests ADD COLUMN IF NOT EXISTS client_status TEXT")
        conn.commit()
    finally:
        conn.close()


def normalizar_fone(raw: str) -> str:
    """Só dígitos, sem o código do país (55)."""
    digits = "".join(ch for ch in (raw or "") if ch.isdigit())
    if digits.startswith("55") and len(digits) >= 12:
        digits = digits[2:]
    return digits


def classificar_telefone(conn, phone: str) -> tuple:
    """Classifica um telefone contra a base IXC sincronizada.

    Retorna (status, nome_ixc): status é 'cliente' (contrato ativo),
    'ex_cliente' (já teve cadastro/contrato) ou 'nunca_foi'; nome_ixc é o nome
    do cadastro correspondente no IXC (None se não houver match). O match usa
    os últimos 8 dígitos (cobre números antigos sem o nono dígito).
    """
    digits = normalizar_fone(phone)
    last8 = digits[-8:]
    if len(last8) < 8:
        return "nunca_foi", None

    with conn.cursor() as cur:
        cur.execute(
            r"""
            SELECT ixc_id, COALESCE(ativo, ''), COALESCE(nome, '')
            FROM ixc_clientes
            WHERE COALESCE(fones, regexp_replace(COALESCE(fone, ''), '\D', '', 'g')) LIKE %s
            """,
            (f"%{last8}%",),
        )
        clientes = cur.fetchall()
        if not clientes:
            return "nunca_foi", None

        ids = [c[0] for c in clientes]
        cur.execute(
            "SELECT id_cliente, COALESCE(status, '') FROM ixc_contratos WHERE id_cliente = ANY(%s)",
            (ids,),
        )
        contratos = cur.fetchall()

    ativos = {c_id for c_id, status in contratos if status.upper() == "A"}
    # Nome do cadastro: prioriza o cliente com contrato ativo
    nome = next((c[2] for c in clientes if c[0] in ativos), clientes[0][2]) or None

    if ativos:
        return "cliente", nome
    if contratos:
        return "ex_cliente", nome
    # Cadastro existe mas nenhum contrato sincronizado: usa a flag do cadastro
    if any(c[1].upper() == "S" for c in clientes):
        return "cliente", nome
    return "ex_cliente", nome
