"""Funil de vendas dos leads do hotspot (protegido pelo middleware JWT do main.py).

Etapas: novo → contatado → respondeu → quente / frio → convertido.
'contatado' é automático ao enviar WhatsApp; 'convertido' é automático quando
o telefone vira cliente no IXC; as demais são movidas manualmente no kanban.
"""
import time

import psycopg2.extras
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import db
import evolution

router = APIRouter()


def _serializar(row: dict) -> dict:
    for campo in ("primeiro_acesso", "ultimo_acesso", "ultimo_contato", "atualizado_em"):
        if row.get(campo):
            row[campo] = row[campo].isoformat()
    return row


@router.get("/api/leads")
def listar_leads():
    conn = db.get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, phone, name, client_status, etapa, obs,
                       primeiro_acesso, ultimo_acesso, ultimo_contato, atualizado_em
                FROM hotspot_leads
                ORDER BY atualizado_em DESC
                """
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    return [_serializar(r) for r in rows]


class LeadPatch(BaseModel):
    etapa: str = None
    obs: str = None


@router.patch("/api/leads/{lead_id}")
def atualizar_lead(lead_id: int, body: LeadPatch):
    if body.etapa is not None and body.etapa not in db.ETAPAS_FUNIL:
        raise HTTPException(status_code=400, detail=f"Etapa inválida. Use: {', '.join(db.ETAPAS_FUNIL)}")

    campos, valores = [], []
    if body.etapa is not None:
        campos.append("etapa = %s")
        valores.append(body.etapa)
    if body.obs is not None:
        campos.append("obs = %s")
        valores.append(body.obs.strip())
    if not campos:
        raise HTTPException(status_code=400, detail="Nada para atualizar.")

    conn = db.get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"""
                UPDATE hotspot_leads
                SET {', '.join(campos)}, atualizado_em = NOW()
                WHERE id = %s
                RETURNING id, phone, name, client_status, etapa, obs,
                          primeiro_acesso, ultimo_acesso, ultimo_contato, atualizado_em
                """,
                (*valores, lead_id),
            )
            row = cur.fetchone()
        conn.commit()
    finally:
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Lead não encontrado.")
    return _serializar(row)


@router.post("/api/leads/backfill")
def backfill_leads():
    """Popula o funil a partir dos acessos já registrados no hotspot.

    Idempotente: telefones que já estão no funil apenas têm os dados de
    acesso atualizados, sem mexer na etapa.
    """
    conn = db.get_conn()
    criados = 0
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT phone,
                       MAX(name)         FILTER (WHERE name IS NOT NULL AND name <> '') AS name,
                       MIN(connected_at) AS primeiro,
                       MAX(connected_at) AS ultimo
                FROM hotspot_guests
                GROUP BY phone
                """
            )
            grupos = cur.fetchall()

        for phone, name, primeiro, ultimo in grupos:
            status, nome_ixc = db.classificar_telefone(conn, phone)
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM hotspot_leads WHERE phone = %s", (db.normalizar_fone(phone),))
                existia = cur.fetchone() is not None
            db.upsert_lead(conn, phone, nome_ixc or name, status, ultimo)
            if not existia and status != "cliente":
                criados += 1
            # Preserva o primeiro acesso histórico
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE hotspot_leads
                    SET primeiro_acesso = LEAST(COALESCE(primeiro_acesso, %s), %s)
                    WHERE phone = %s
                    """,
                    (primeiro, primeiro, db.normalizar_fone(phone)),
                )
        conn.commit()
    finally:
        conn.close()
    return {"message": f"Funil populado: {criados} lead(s) novo(s) a partir do histórico."}


class EnvioLeadsBody(BaseModel):
    ids: list[int]
    message: str


@router.post("/api/leads/enviar-whatsapp")
def enviar_whatsapp_leads(body: EnvioLeadsBody):
    """Envia mensagem aos leads e move 'novo' → 'contatado' automaticamente."""
    message = (body.message or "").strip()
    if len(message) < 3:
        raise HTTPException(status_code=400, detail="Digite a mensagem a enviar.")
    if not body.ids:
        raise HTTPException(status_code=400, detail="Nenhum lead selecionado.")

    conn = db.get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, phone, name FROM hotspot_leads WHERE id = ANY(%s) ORDER BY id",
                (body.ids,),
            )
            leads = cur.fetchall()

        enviados, falhas = 0, []
        for i, (lead_id, phone, name) in enumerate(leads):
            primeiro_nome = (name or "").strip().split(" ")[0].title() if name else ""
            texto = message.replace("{nome}", primeiro_nome).replace("  ", " ").strip()
            try:
                evolution.send_text(phone, texto)
                enviados += 1
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE hotspot_leads
                        SET etapa = CASE WHEN etapa = 'novo' THEN 'contatado' ELSE etapa END,
                            ultimo_contato = NOW(), atualizado_em = NOW()
                        WHERE id = %s
                        """,
                        (lead_id,),
                    )
                db.registrar_mensagem(conn, phone, texto)
                conn.commit()
            except Exception as e:
                print(f"[WHATSAPP] Falha ao enviar para {phone}: {e}")
                falhas.append(phone)
            if i < len(leads) - 1:
                time.sleep(1)  # pausa entre envios para não disparar bloqueio anti-spam
    finally:
        conn.close()

    msg = f"{enviados} mensagem(ns) enviada(s)."
    if falhas:
        msg += f" {len(falhas)} falha(s)."
    return {"message": msg, "enviados": enviados, "falhas": falhas}
