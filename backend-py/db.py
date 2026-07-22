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


# Funil de vendas dos leads do hotspot (um registro por telefone)
DDL_HOTSPOT_LEADS = """
CREATE TABLE IF NOT EXISTS hotspot_leads (
    id              SERIAL PRIMARY KEY,
    phone           TEXT UNIQUE NOT NULL,
    name            TEXT,
    client_status   TEXT,
    etapa           TEXT NOT NULL DEFAULT 'novo',
    fonte           TEXT NOT NULL DEFAULT 'hotspot',
    obs             TEXT,
    primeiro_acesso TIMESTAMPTZ,
    ultimo_acesso   TIMESTAMPTZ,
    ultimo_contato  TIMESTAMPTZ,
    atualizado_em   TIMESTAMPTZ DEFAULT NOW()
);
"""

ETAPAS_FUNIL = ("novo", "contatado", "respondeu", "quente", "frio", "convertido")

# De onde o lead veio: acesso ao hotspot ou importação de planilha
FONTES_LEAD = ("hotspot", "planilha")

# Histórico de mensagens WhatsApp enviadas (phone normalizado, sem o 55)
DDL_HOTSPOT_MENSAGENS = """
CREATE TABLE IF NOT EXISTS hotspot_mensagens (
    id         SERIAL PRIMARY KEY,
    phone      TEXT NOT NULL,
    message    TEXT NOT NULL,
    enviado_em TIMESTAMPTZ DEFAULT NOW()
);
"""


# Modelos de mensagem reutilizáveis no envio para leads
DDL_HOTSPOT_MSG_MODELOS = """
CREATE TABLE IF NOT EXISTS hotspot_msg_modelos (
    id            SERIAL PRIMARY KEY,
    titulo        TEXT UNIQUE NOT NULL,
    texto         TEXT NOT NULL,
    criado_em     TIMESTAMPTZ DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ DEFAULT NOW()
);
"""


def registrar_mensagem(conn, phone: str, message: str):
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO hotspot_mensagens (phone, message) VALUES (%s, %s)",
            (normalizar_fone(phone), message),
        )


def ultimas_mensagens(conn) -> dict:
    """Última mensagem enviada por telefone: {phone_normalizado: (message, enviado_em)}."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT ON (phone) phone, message, enviado_em
            FROM hotspot_mensagens
            ORDER BY phone, enviado_em DESC
            """
        )
        return {r[0]: (r[1], r[2]) for r in cur.fetchall()}


def init_hotspot_tables():
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(DDL_HOTSPOT_GUESTS)
            cur.execute("ALTER TABLE hotspot_guests ADD COLUMN IF NOT EXISTS name TEXT")
            cur.execute("ALTER TABLE hotspot_guests ADD COLUMN IF NOT EXISTS client_status TEXT")
            cur.execute(DDL_HOTSPOT_LEADS)
            cur.execute("ALTER TABLE hotspot_leads ADD COLUMN IF NOT EXISTS fonte TEXT NOT NULL DEFAULT 'hotspot'")
            cur.execute(DDL_HOTSPOT_MENSAGENS)
            cur.execute(DDL_HOTSPOT_MSG_MODELOS)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_hotspot_msgs_phone ON hotspot_mensagens (phone, enviado_em DESC)")
        conn.commit()
    finally:
        conn.close()


def upsert_lead(conn, phone: str, name: str, client_status: str, acesso_em=None, fonte: str = "hotspot"):
    """Mantém o funil de vendas em dia a cada acesso ao hotspot.

    Clientes ativos não entram no funil; um lead existente que virou cliente
    é movido automaticamente para 'convertido'. `fonte` só vale na criação: um
    lead já existente mantém a origem com que entrou no funil.
    """
    fone = normalizar_fone(phone)
    if not fone:
        return
    with conn.cursor() as cur:
        if client_status == "cliente":
            cur.execute(
                """
                UPDATE hotspot_leads
                SET etapa = 'convertido', client_status = 'cliente',
                    name = COALESCE(%s, name), atualizado_em = NOW()
                WHERE phone = %s AND etapa <> 'convertido'
                """,
                (name, fone),
            )
            return
        cur.execute(
            """
            INSERT INTO hotspot_leads (phone, name, client_status, primeiro_acesso, ultimo_acesso, fonte)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (phone) DO UPDATE SET
                name          = COALESCE(EXCLUDED.name, hotspot_leads.name),
                client_status = EXCLUDED.client_status,
                ultimo_acesso = COALESCE(EXCLUDED.ultimo_acesso, hotspot_leads.ultimo_acesso),
                atualizado_em = NOW()
            """,
            (fone, name, client_status, acesso_em, acesso_em, fonte if fonte in FONTES_LEAD else "hotspot"),
        )


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
