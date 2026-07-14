"""Rotas do admin para os acessos do hotspot (protegidas pelo middleware JWT do main.py)."""
import time

import psycopg2.extras
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import db
import evolution

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
        msgs = db.ultimas_mensagens(conn)
    finally:
        conn.close()

    resultado = []
    for r in rows:
        msg = msgs.get(db.normalizar_fone(r["phone"]))
        resultado.append({
            **r,
            "connected_at": r["connected_at"].isoformat(),
            "ultima_mensagem": msg[0] if msg else None,
            "ultimo_envio": msg[1].isoformat() if msg else None,
        })
    return resultado


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
            status, nome_ixc = db.classificar_telefone(conn, phone)
            with conn.cursor() as cur:
                # O nome do cadastro IXC prevalece (mais confiável); o digitado
                # pelo visitante fica para quem não está na base
                cur.execute(
                    """
                    UPDATE hotspot_guests
                    SET client_status = %s,
                        is_client     = %s,
                        name          = COALESCE(NULLIF(%s, ''), name)
                    WHERE id = %s
                    """,
                    (status, status == "cliente", nome_ixc, reg_id),
                )
            atualizados += 1

        # Mantém o funil em dia: atualiza classificação/nome dos leads e
        # move para 'convertido' quem virou cliente
        with conn.cursor() as cur:
            cur.execute("SELECT id, phone FROM hotspot_leads")
            leads = cur.fetchall()
        for lead_id, phone in leads:
            status, nome_ixc = db.classificar_telefone(conn, phone)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE hotspot_leads
                    SET client_status = %s,
                        name          = COALESCE(NULLIF(%s, ''), name),
                        etapa         = CASE WHEN %s = 'cliente' THEN 'convertido' ELSE etapa END,
                        atualizado_em = NOW()
                    WHERE id = %s
                    """,
                    (status, nome_ixc, status, lead_id),
                )
        conn.commit()
    finally:
        conn.close()
    return {"message": f"{atualizados} acessos reclassificados.", "total": atualizados}


class EnvioWhatsAppBody(BaseModel):
    ids: list[int]
    message: str


@router.post("/api/guests/enviar-whatsapp")
def enviar_whatsapp_guests(body: EnvioWhatsAppBody):
    """Envia uma mensagem via Evolution API para os contatos selecionados.

    Números repetidos entre os selecionados recebem uma única mensagem.
    O placeholder {nome} na mensagem é trocado pelo primeiro nome do contato.
    """
    message = (body.message or "").strip()
    if len(message) < 3:
        raise HTTPException(status_code=400, detail="Digite a mensagem a enviar.")
    if not body.ids:
        raise HTTPException(status_code=400, detail="Nenhum contato selecionado.")

    conn = db.get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT phone, name FROM hotspot_guests WHERE id = ANY(%s) ORDER BY id",
                (body.ids,),
            )
            registros = cur.fetchall()
    finally:
        conn.close()

    # Dedupe por telefone normalizado (mantém o primeiro nome encontrado)
    contatos = {}
    for phone, name in registros:
        chave = db.normalizar_fone(phone)
        if chave and chave not in contatos:
            contatos[chave] = (phone, name)

    enviados, falhas = 0, []
    for i, (phone, name) in enumerate(contatos.values()):
        primeiro_nome = (name or "").strip().split(" ")[0].title() if name else ""
        texto = message.replace("{nome}", primeiro_nome).replace("  ", " ").strip()
        try:
            evolution.send_text(phone, texto)
            enviados += 1
            # Reflete o contato no funil de vendas e guarda a mensagem no histórico
            conn2 = db.get_conn()
            try:
                with conn2.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE hotspot_leads
                        SET etapa = CASE WHEN etapa = 'novo' THEN 'contatado' ELSE etapa END,
                            ultimo_contato = NOW(), atualizado_em = NOW()
                        WHERE phone = %s
                        """,
                        (db.normalizar_fone(phone),),
                    )
                db.registrar_mensagem(conn2, phone, texto)
                conn2.commit()
            finally:
                conn2.close()
        except Exception as e:
            print(f"[WHATSAPP] Falha ao enviar para {phone}: {e}")
            falhas.append(phone)
        if i < len(contatos) - 1:
            time.sleep(1)  # pausa entre envios para não disparar bloqueio anti-spam

    msg = f"{enviados} mensagem(ns) enviada(s)."
    if falhas:
        msg += f" {len(falhas)} falha(s)."
    return {"message": msg, "enviados": enviados, "falhas": falhas}
