"""Funil de vendas dos leads do hotspot (protegido pelo middleware JWT do main.py).

Etapas: novo → contatado → respondeu → quente / frio → convertido.
'contatado' é automático ao enviar WhatsApp; 'convertido' é automático quando
o telefone vira cliente no IXC; as demais são movidas manualmente no kanban.
"""
import io
import time
import unicodedata

import pandas as pd
import psycopg2
import psycopg2.errors
import psycopg2.extras
from fastapi import APIRouter, File, HTTPException, UploadFile
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
                SELECT id, phone, name, client_status, etapa, fonte, obs,
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
                RETURNING id, phone, name, client_status, etapa, fonte, obs,
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


def _sem_acento(texto: str) -> str:
    norm = unicodedata.normalize("NFKD", str(texto or ""))
    return "".join(c for c in norm if not unicodedata.combining(c)).strip().lower()


def _achar_coluna(df: pd.DataFrame, *termos: str):
    """Primeira coluna cujo nome (sem acento/caixa) contém todos os termos."""
    for col in df.columns:
        nome = _sem_acento(col)
        if all(t in nome for t in termos):
            return col
    return None


@router.post("/api/leads/importar-planilha")
async def importar_planilha_leads(file: UploadFile = File(...)):
    """Importa leads de uma planilha no formato Novos_Contatos_Filtrados.xlsx.

    Colunas esperadas: 'Nome / Razão Social' e 'Telefone (Apenas Números)'
    (ou 'Telefone (Formatado)'). Só entram no funil os telefones que não são
    clientes ativos no IXC; os importados ficam com fonte = 'planilha'.
    """
    if not (file.filename or "").lower().endswith((".xlsx", ".xls", ".xlsm")):
        raise HTTPException(status_code=400, detail="Apenas arquivos .xlsx, .xls ou .xlsm são aceitos.")

    conteudo = await file.read()
    try:
        df = pd.read_excel(io.BytesIO(conteudo))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Não foi possível ler a planilha: {e}")

    df.columns = [str(c).strip() for c in df.columns]
    col_fone = _achar_coluna(df, "telefone", "numero") or _achar_coluna(df, "telefone") or _achar_coluna(df, "fone")
    if col_fone is None:
        raise HTTPException(
            status_code=400,
            detail="Planilha sem coluna de telefone. Use o modelo Novos_Contatos_Filtrados.xlsx.",
        )
    col_nome = _achar_coluna(df, "nome") or _achar_coluna(df, "razao")

    conn = db.get_conn()
    importados, atualizados, clientes, invalidos = 0, 0, 0, 0
    vistos = set()
    try:
        for _, linha in df.iterrows():
            bruto = linha[col_fone]
            if pd.isna(bruto):
                invalidos += 1
                continue
            # Números vindos como float (35999190445.0) perdem o .0 aqui
            if isinstance(bruto, float):
                bruto = f"{bruto:.0f}"
            fone = db.normalizar_fone(str(bruto))
            if len(fone) < 10:
                invalidos += 1
                continue
            if fone in vistos:
                continue
            vistos.add(fone)

            nome = None
            if col_nome is not None and not pd.isna(linha[col_nome]):
                nome = str(linha[col_nome]).strip() or None

            status, nome_ixc = db.classificar_telefone(conn, fone)
            if status == "cliente":
                clientes += 1
                continue

            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM hotspot_leads WHERE phone = %s", (fone,))
                existia = cur.fetchone() is not None

            db.upsert_lead(conn, fone, nome_ixc or nome, status, fonte="planilha")
            if existia:
                atualizados += 1
            else:
                importados += 1
        conn.commit()
    finally:
        conn.close()

    partes = [f"{importados} lead(s) importado(s) da planilha"]
    if atualizados:
        partes.append(f"{atualizados} já estavam no funil")
    if clientes:
        partes.append(f"{clientes} ignorado(s) por já serem clientes")
    if invalidos:
        partes.append(f"{invalidos} telefone(s) inválido(s)")
    return {
        "message": ", ".join(partes) + ".",
        "importados": importados,
        "atualizados": atualizados,
        "clientes_ignorados": clientes,
        "invalidos": invalidos,
    }


# ── Modelos de mensagem ────────────────────────────────────────────
# Rotas sob /api/leads de propósito: herdam o RBAC de "vendas" do main.py.

class ModeloBody(BaseModel):
    titulo: str = None
    texto: str = None


def _modelo_serializado(row: dict) -> dict:
    for campo in ("criado_em", "atualizado_em"):
        if row.get(campo):
            row[campo] = row[campo].isoformat()
    return row


@router.get("/api/leads/modelos")
def listar_modelos():
    conn = db.get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT id, titulo, texto, criado_em, atualizado_em FROM hotspot_msg_modelos ORDER BY titulo"
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    return [_modelo_serializado(r) for r in rows]


@router.post("/api/leads/modelos")
def criar_modelo(body: ModeloBody):
    titulo = (body.titulo or "").strip()
    texto = (body.texto or "").strip()
    if not titulo:
        raise HTTPException(status_code=400, detail="Dê um nome ao modelo.")
    if len(texto) < 3:
        raise HTTPException(status_code=400, detail="A mensagem do modelo está vazia.")

    conn = db.get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # Mesmo título sobrescreve: salvar duas vezes atualiza em vez de duplicar
            cur.execute(
                """
                INSERT INTO hotspot_msg_modelos (titulo, texto)
                VALUES (%s, %s)
                ON CONFLICT (titulo) DO UPDATE SET texto = EXCLUDED.texto, atualizado_em = NOW()
                RETURNING id, titulo, texto, criado_em, atualizado_em
                """,
                (titulo, texto),
            )
            row = cur.fetchone()
        conn.commit()
    finally:
        conn.close()
    return _modelo_serializado(row)


@router.patch("/api/leads/modelos/{modelo_id}")
def atualizar_modelo(modelo_id: int, body: ModeloBody):
    campos, valores = [], []
    if body.titulo is not None:
        titulo = body.titulo.strip()
        if not titulo:
            raise HTTPException(status_code=400, detail="O nome do modelo não pode ficar vazio.")
        campos.append("titulo = %s")
        valores.append(titulo)
    if body.texto is not None:
        texto = body.texto.strip()
        if len(texto) < 3:
            raise HTTPException(status_code=400, detail="A mensagem do modelo está vazia.")
        campos.append("texto = %s")
        valores.append(texto)
    if not campos:
        raise HTTPException(status_code=400, detail="Nada para atualizar.")

    conn = db.get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"""
                UPDATE hotspot_msg_modelos
                SET {', '.join(campos)}, atualizado_em = NOW()
                WHERE id = %s
                RETURNING id, titulo, texto, criado_em, atualizado_em
                """,
                (*valores, modelo_id),
            )
            row = cur.fetchone()
        conn.commit()
    except psycopg2.errors.UniqueViolation:
        raise HTTPException(status_code=400, detail="Já existe um modelo com esse nome.")
    finally:
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Modelo não encontrado.")
    return _modelo_serializado(row)


@router.delete("/api/leads/modelos/{modelo_id}")
def remover_modelo(modelo_id: int):
    conn = db.get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM hotspot_msg_modelos WHERE id = %s", (modelo_id,))
            removidos = cur.rowcount
        conn.commit()
    finally:
        conn.close()
    if not removidos:
        raise HTTPException(status_code=404, detail="Modelo não encontrado.")
    return {"message": "Modelo removido."}


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
