"""Régua de cobrança — área administrativa (protegida pelo middleware JWT).

Fase 2: só a tela de Integração. Mostra o estado das duas pontas —
o IXC, de onde vêm os títulos, e a API oficial do WhatsApp, por onde as
mensagens vão sair.
"""
import json
import re
from datetime import datetime, timedelta
from os import environ
from zoneinfo import ZoneInfo

import psycopg2
import psycopg2.errors
import psycopg2.extras
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import db
import whatsapp_oficial

router = APIRouter()

_TZ_LOCAL = ZoneInfo(environ.get("TZ", "America/Sao_Paulo"))


# ── Modelos de mensagem (templates da Meta) ─────────────────────────

DDL_COBRANCA_MODELOS = """
CREATE TABLE IF NOT EXISTS cobranca_modelos (
    id                   SERIAL PRIMARY KEY,
    nome                 TEXT UNIQUE NOT NULL,
    idioma               TEXT NOT NULL DEFAULT 'pt_BR',
    categoria_solicitada TEXT NOT NULL DEFAULT 'UTILITY',
    corpo                TEXT NOT NULL,
    rodape               TEXT,
    variaveis            JSONB NOT NULL DEFAULT '[]'::jsonb,
    meta_template_id     TEXT,
    status               TEXT NOT NULL DEFAULT 'RASCUNHO',
    categoria_meta       TEXT,
    motivo_rejeicao      TEXT,
    criado_em            TIMESTAMPTZ DEFAULT NOW(),
    atualizado_em        TIMESTAMPTZ DEFAULT NOW(),
    sincronizado_em      TIMESTAMPTZ
);
"""

# Campos que a régua sabe preencher em cada variável {{n}} do template.
# A Fase 5 usa este mapa para montar a mensagem a partir do título do IXC.
CAMPOS_VARIAVEIS = {
    "nome":           "Primeiro nome do cliente",
    "nome_completo":  "Nome completo do cliente",
    "valor":          "Valor do título (ex.: R$ 129,90)",
    "vencimento":     "Data de vencimento (ex.: 10/07/2026)",
    "dias_atraso":    "Dias em atraso (ex.: 5)",
    "empresa":        "Nome da empresa (Via01)",
}

CATEGORIAS_META = ("UTILITY", "MARKETING", "AUTHENTICATION")

# Status que impedem edição: já estão com a Meta ou aprovados por ela
STATUS_TRAVADOS = ("PENDING", "APPROVED", "PAUSED", "PENDING_DELETION")


def init_cobranca_tables():
    conn = db.get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(DDL_COBRANCA_MODELOS)
        conn.commit()
    finally:
        conn.close()


def _proxima_execucao(hora_agendada: str):
    """Mesmo cálculo do agendador do main.py, só que sem dormir."""
    if not hora_agendada:
        return None
    try:
        hora, minuto = (int(x) for x in hora_agendada.split(":"))
    except ValueError:
        return None
    agora = datetime.now(_TZ_LOCAL)
    proximo = agora.replace(hour=hora, minute=minuto, second=0, microsecond=0)
    if proximo <= agora:
        proximo += timedelta(days=1)
    return proximo


@router.get("/api/cobranca/integracao")
def status_integracao():
    """Estado do IXC (último sincronismo e volume de títulos) e do WhatsApp."""
    conn = db.get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT MAX(synced_at) FROM ixc_areceber
            """)
            ultimo_sync = cur.fetchone()[0]

            cur.execute("""
                SELECT COUNT(*),
                       COUNT(*) FILTER (WHERE status = 'A' AND valor_aberto > 0),
                       COUNT(*) FILTER (WHERE status = 'A' AND valor_aberto > 0
                                          AND data_vencimento < CURRENT_DATE),
                       COALESCE(SUM(valor_aberto) FILTER (WHERE status = 'A' AND valor_aberto > 0), 0)
                FROM ixc_areceber
            """)
            total, abertos, vencidos, valor_aberto = cur.fetchone()

            cur.execute("SELECT MAX(synced_at) FROM ixc_clientes")
            sync_clientes = cur.fetchone()[0]
    finally:
        conn.close()

    hora_agendada = environ.get("IXC_SYNC_HORA", "08:00")
    proxima = _proxima_execucao(hora_agendada)

    return {
        "ixc": {
            "ultimo_sync_titulos":  ultimo_sync.isoformat() if ultimo_sync else None,
            "ultimo_sync_clientes": sync_clientes.isoformat() if sync_clientes else None,
            "hora_agendada":        hora_agendada or None,
            "proxima_execucao":     proxima.isoformat() if proxima else None,
            "titulos_total":        total,
            "titulos_abertos":      abertos,
            "titulos_vencidos":     vencidos,
            "valor_aberto":         float(valor_aberto or 0),
        },
        "whatsapp": {
            "configurado":     whatsapp_oficial.configurado(),
            "phone_number_id": whatsapp_oficial.PHONE_NUMBER_ID or None,
            "waba_id":         whatsapp_oficial.WABA_ID or None,
            "api_version":     whatsapp_oficial.API_VERSION,
        },
    }


class ModeloBody(BaseModel):
    nome: str = None
    idioma: str = None
    categoria_solicitada: str = None
    corpo: str = None
    rodape: str = None
    variaveis: list = None


def _serializar_modelo(row: dict) -> dict:
    for campo in ("criado_em", "atualizado_em", "sincronizado_em"):
        if row.get(campo):
            row[campo] = row[campo].isoformat()
    return row


def _validar_modelo(nome: str, corpo: str, variaveis: list, categoria: str):
    """Barra na entrada os erros que a Meta rejeitaria depois — a revisão dela
    demora, então não vale a pena descobrir lá o que dá para ver aqui."""
    if not re.fullmatch(r"[a-z0-9_]{1,512}", nome or ""):
        raise HTTPException(
            status_code=400,
            detail="O nome do template só aceita letras minúsculas, números e _ (ex.: aviso_vencimento_3dias).",
        )
    if len((corpo or "").strip()) < 3:
        raise HTTPException(status_code=400, detail="O corpo da mensagem está vazio.")
    if len(corpo) > 1024:
        raise HTTPException(status_code=400, detail="O corpo passa de 1024 caracteres, limite da Meta.")
    if categoria not in CATEGORIAS_META:
        raise HTTPException(status_code=400, detail=f"Categoria inválida. Use: {', '.join(CATEGORIAS_META)}")

    # As variáveis precisam ser {{1}}, {{2}}… sem buracos e sem repetir fora de ordem
    encontradas = [int(n) for n in re.findall(r"\{\{(\d+)\}\}", corpo)]
    esperadas = list(range(1, len(set(encontradas)) + 1))
    if sorted(set(encontradas)) != esperadas:
        raise HTTPException(
            status_code=400,
            detail="As variáveis devem ser {{1}}, {{2}}, {{3}}… em sequência, sem pular números.",
        )
    if len(set(encontradas)) != len(variaveis or []):
        raise HTTPException(
            status_code=400,
            detail=f"O corpo tem {len(set(encontradas))} variável(is), mas {len(variaveis or [])} foram configuradas.",
        )
    for v in (variaveis or []):
        if v.get("campo") not in CAMPOS_VARIAVEIS:
            raise HTTPException(
                status_code=400,
                detail=f"Campo desconhecido em variável: {v.get('campo')}. Use: {', '.join(CAMPOS_VARIAVEIS)}",
            )

    # Regra da Meta que pega muita gente de surpresa
    corpo_limpo = corpo.strip()
    if corpo_limpo.startswith("{{") or corpo_limpo.endswith("}}"):
        raise HTTPException(
            status_code=400,
            detail="A Meta rejeita mensagens que começam ou terminam com variável. Coloque texto antes/depois.",
        )


@router.get("/api/cobranca/modelos/campos")
def listar_campos_variaveis():
    """Campos que a régua sabe preencher — alimenta o seletor da tela."""
    return [{"campo": k, "descricao": v} for k, v in CAMPOS_VARIAVEIS.items()]


@router.get("/api/cobranca/modelos")
def listar_modelos():
    conn = db.get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT id, nome, idioma, categoria_solicitada, corpo, rodape, variaveis,
                       meta_template_id, status, categoria_meta, motivo_rejeicao,
                       criado_em, atualizado_em, sincronizado_em
                FROM cobranca_modelos
                ORDER BY criado_em DESC
            """)
            rows = cur.fetchall()
    finally:
        conn.close()
    return [_serializar_modelo(r) for r in rows]


@router.post("/api/cobranca/modelos")
def criar_modelo(body: ModeloBody):
    nome = (body.nome or "").strip().lower()
    corpo = (body.corpo or "").strip()
    categoria = (body.categoria_solicitada or "UTILITY").upper()
    variaveis = body.variaveis or []
    _validar_modelo(nome, corpo, variaveis, categoria)

    conn = db.get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO cobranca_modelos
                    (nome, idioma, categoria_solicitada, corpo, rodape, variaveis)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id, nome, idioma, categoria_solicitada, corpo, rodape, variaveis,
                          meta_template_id, status, categoria_meta, motivo_rejeicao,
                          criado_em, atualizado_em, sincronizado_em
            """, (nome, (body.idioma or "pt_BR"), categoria, corpo,
                  (body.rodape or "").strip() or None, json.dumps(variaveis)))
            row = cur.fetchone()
        conn.commit()
    except psycopg2.errors.UniqueViolation:
        raise HTTPException(status_code=400, detail="Já existe um modelo com esse nome.")
    finally:
        conn.close()
    return _serializar_modelo(row)


@router.patch("/api/cobranca/modelos/{modelo_id}")
def atualizar_modelo(modelo_id: int, body: ModeloBody):
    conn = db.get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM cobranca_modelos WHERE id = %s", (modelo_id,))
            atual = cur.fetchone()
            if not atual:
                raise HTTPException(status_code=404, detail="Modelo não encontrado.")
            if atual["status"] in STATUS_TRAVADOS:
                raise HTTPException(
                    status_code=400,
                    detail=f"Modelo em {atual['status']} não pode ser editado. Crie outro com nome diferente.",
                )

            nome = (body.nome if body.nome is not None else atual["nome"]).strip().lower()
            corpo = (body.corpo if body.corpo is not None else atual["corpo"]).strip()
            categoria = (body.categoria_solicitada or atual["categoria_solicitada"]).upper()
            variaveis = body.variaveis if body.variaveis is not None else atual["variaveis"]
            rodape = body.rodape if body.rodape is not None else atual["rodape"]
            _validar_modelo(nome, corpo, variaveis, categoria)

            cur.execute("""
                UPDATE cobranca_modelos
                SET nome = %s, idioma = %s, categoria_solicitada = %s, corpo = %s,
                    rodape = %s, variaveis = %s, status = 'RASCUNHO',
                    motivo_rejeicao = NULL, atualizado_em = NOW()
                WHERE id = %s
                RETURNING id, nome, idioma, categoria_solicitada, corpo, rodape, variaveis,
                          meta_template_id, status, categoria_meta, motivo_rejeicao,
                          criado_em, atualizado_em, sincronizado_em
            """, (nome, (body.idioma or atual["idioma"]), categoria, corpo,
                  (rodape or "").strip() or None, json.dumps(variaveis), modelo_id))
            row = cur.fetchone()
        conn.commit()
    except psycopg2.errors.UniqueViolation:
        raise HTTPException(status_code=400, detail="Já existe um modelo com esse nome.")
    finally:
        conn.close()
    return _serializar_modelo(row)


@router.delete("/api/cobranca/modelos/{modelo_id}")
def remover_modelo(modelo_id: int):
    conn = db.get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT nome, meta_template_id FROM cobranca_modelos WHERE id = %s", (modelo_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Modelo não encontrado.")
            nome, meta_id = row

            # Se já foi para a Meta, apaga lá também — senão o nome fica preso
            aviso = ""
            if meta_id:
                try:
                    whatsapp_oficial.excluir_template(nome)
                except Exception as e:
                    aviso = f" Atenção: não foi possível remover na Meta ({e})."

            cur.execute("DELETE FROM cobranca_modelos WHERE id = %s", (modelo_id,))
        conn.commit()
    finally:
        conn.close()
    return {"message": f"Modelo removido.{aviso}"}


@router.post("/api/cobranca/modelos/{modelo_id}/submeter")
def submeter_modelo(modelo_id: int):
    """Envia o modelo para a revisão da Meta."""
    conn = db.get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM cobranca_modelos WHERE id = %s", (modelo_id,))
            modelo = cur.fetchone()
        if not modelo:
            raise HTTPException(status_code=404, detail="Modelo não encontrado.")
        if modelo["status"] in STATUS_TRAVADOS:
            raise HTTPException(status_code=400, detail=f"Modelo já está em {modelo['status']}.")

        exemplos = [v.get("exemplo") or CAMPOS_VARIAVEIS.get(v.get("campo"), "exemplo")
                    for v in (modelo["variaveis"] or [])]
        try:
            resp = whatsapp_oficial.criar_template(
                nome=modelo["nome"],
                idioma=modelo["idioma"],
                categoria=modelo["categoria_solicitada"],
                corpo=modelo["corpo"],
                exemplos=exemplos,
                rodape=modelo["rodape"],
            )
        except RuntimeError as e:
            raise HTTPException(status_code=400, detail=str(e))

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                UPDATE cobranca_modelos
                SET meta_template_id = %s, status = %s, categoria_meta = %s,
                    motivo_rejeicao = NULL, sincronizado_em = NOW(), atualizado_em = NOW()
                WHERE id = %s
                RETURNING id, nome, idioma, categoria_solicitada, corpo, rodape, variaveis,
                          meta_template_id, status, categoria_meta, motivo_rejeicao,
                          criado_em, atualizado_em, sincronizado_em
            """, (str(resp.get("id")), resp.get("status", "PENDING"), resp.get("category"), modelo_id))
            row = cur.fetchone()
        conn.commit()
    finally:
        conn.close()

    msg = "Modelo enviado para revisão da Meta."
    if row["categoria_meta"] and row["categoria_meta"] != row["categoria_solicitada"]:
        msg += (f" Atenção: a Meta enquadrou como {row['categoria_meta']}, "
                f"não {row['categoria_solicitada']} — isso muda o custo por mensagem.")
    return {"message": msg, "modelo": _serializar_modelo(row)}


@router.post("/api/cobranca/modelos/sincronizar")
def sincronizar_modelos():
    """Puxa da Meta o status atual da revisão de cada template."""
    try:
        remotos = whatsapp_oficial.listar_templates()
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Falha ao falar com a Meta: {e}")

    por_nome = {t.get("name"): t for t in remotos}
    conn = db.get_conn()
    atualizados, aprovados, rejeitados = 0, 0, 0
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, nome FROM cobranca_modelos")
            locais = cur.fetchall()

        for modelo_id, nome in locais:
            remoto = por_nome.get(nome)
            if not remoto:
                continue
            status = remoto.get("status")
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE cobranca_modelos
                    SET status = %s, categoria_meta = %s, motivo_rejeicao = %s,
                        meta_template_id = COALESCE(meta_template_id, %s),
                        sincronizado_em = NOW()
                    WHERE id = %s
                """, (status, remoto.get("category"),
                      remoto.get("rejected_reason") if status == "REJECTED" else None,
                      str(remoto.get("id") or "") or None, modelo_id))
            atualizados += 1
            if status == "APPROVED":
                aprovados += 1
            elif status == "REJECTED":
                rejeitados += 1
        conn.commit()
    finally:
        conn.close()

    partes = [f"{atualizados} modelo(s) sincronizado(s)"]
    if aprovados:
        partes.append(f"{aprovados} aprovado(s)")
    if rejeitados:
        partes.append(f"{rejeitados} rejeitado(s)")
    return {"message": ", ".join(partes) + ".", "total_na_meta": len(remotos)}


@router.post("/api/cobranca/whatsapp/testar")
def testar_whatsapp():
    """Consulta o número na Meta: valida token, ID e permissões de uma vez."""
    try:
        info = whatsapp_oficial.info_numero()
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Falha ao falar com a Meta: {e}")

    return {
        "message": "Conexão com a API oficial funcionando.",
        "numero":         info.get("display_phone_number"),
        "nome_exibicao":  info.get("verified_name"),
        "qualidade":      info.get("quality_rating"),
    }
