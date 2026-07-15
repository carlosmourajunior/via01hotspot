"""Gestão da OLT Nokia/Alcatel ISAM (rotas /api/olt/* — função suporte via middleware).

Substitui o sistema Django ISP: coletas em thread de background com trava única
(a OLT não aceita sessões paralelas) e status na tabela olt_jobs — sem Redis/RQ.
Requer 1 worker uvicorn (a trava vive em memória).
"""
import base64
import json
import threading
from os import environ

import psycopg2.extras
import requests
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from jose import jwt, JWTError

import db
import olt_client

router = APIRouter()

# Ações que alteram a OLT (reboot/remover) só ficam ativas com a flag ligada —
# rollback instantâneo sem redeploy
OLT_ACOES_ATIVAS = environ.get("OLT_ACOES_ATIVAS", "0") == "1"

# ── Tabelas ──────────────────────────────────────────────────────────────────

_DDL = """
CREATE TABLE IF NOT EXISTS olt_onus (
    id            SERIAL PRIMARY KEY,
    pon           TEXT NOT NULL,
    position      INTEGER NOT NULL,
    serial        TEXT,
    mac           TEXT,
    admin_state   TEXT,
    oper_state    TEXT,
    olt_rx_sig    DOUBLE PRECISION,
    ont_olt       TEXT,
    desc1         TEXT,
    desc2         TEXT,
    cliente_fibra BOOLEAN NOT NULL DEFAULT FALSE,
    atualizado_em TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (pon, position)
);
CREATE TABLE IF NOT EXISTS olt_portas (
    id              SERIAL PRIMARY KEY,
    slot            INTEGER NOT NULL,
    port            INTEGER NOT NULL,
    users_connected INTEGER,
    atualizado_em   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (slot, port)
);
CREATE TABLE IF NOT EXISTS olt_clientes_fibra (
    id            SERIAL PRIMARY KEY,
    mac           TEXT UNIQUE NOT NULL,
    nome          TEXT,
    latitude      TEXT,
    longitude     TEXT,
    endereco      TEXT,
    id_caixa_ftth TEXT,
    ativo         BOOLEAN NOT NULL DEFAULT TRUE,
    atualizado_em TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS olt_system_info (
    id             INTEGER PRIMARY KEY DEFAULT 1,
    isam_release   TEXT,
    uptime_days    INTEGER, uptime_hours INTEGER,
    uptime_minutes INTEGER, uptime_seconds INTEGER,
    uptime_raw     TEXT,
    atualizado_em  TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS olt_slots (
    id            SERIAL PRIMARY KEY,
    slot_name     TEXT UNIQUE NOT NULL,
    actual_type   TEXT,
    enabled       BOOLEAN,
    error_status  TEXT,
    availability  TEXT,
    restart_count INTEGER,
    ativo         BOOLEAN NOT NULL DEFAULT TRUE,
    atualizado_em TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS olt_temperaturas (
    id            SERIAL PRIMARY KEY,
    slot_name     TEXT NOT NULL,
    sensor_id     INTEGER NOT NULL,
    actual_temp   INTEGER,
    tca_low       INTEGER, tca_high INTEGER,
    shutdown_low  INTEGER, shutdown_high INTEGER,
    ativo         BOOLEAN NOT NULL DEFAULT TRUE,
    atualizado_em TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (slot_name, sensor_id)
);
CREATE TABLE IF NOT EXISTS olt_jobs (
    id           SERIAL PRIMARY KEY,
    tipo         TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'running',
    detalhe      TEXT,
    usuario      TEXT,
    iniciado_em  TIMESTAMPTZ DEFAULT NOW(),
    terminado_em TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS olt_acoes (
    id            SERIAL PRIMARY KEY,
    usuario       TEXT NOT NULL,
    acao          TEXT NOT NULL,
    onu_interface TEXT NOT NULL,
    onu_serial    TEXT,
    motivo        TEXT NOT NULL,
    resultado     TEXT,
    criado_em     TIMESTAMPTZ DEFAULT NOW()
);
"""


def init_olt_tables():
    conn = db.get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(_DDL)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_olt_onus_serial ON olt_onus (serial)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_olt_onus_sinal  ON olt_onus (olt_rx_sig)")
        conn.commit()
    finally:
        conn.close()


def limpar_jobs_orfaos():
    """Jobs 'running' de antes de um restart do serviço nunca vão terminar."""
    conn = db.get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE olt_jobs SET status='failed', detalhe='interrompido por reinício do serviço', "
                "terminado_em=NOW() WHERE status='running'"
            )
        conn.commit()
    finally:
        conn.close()


# ── Runner de jobs (thread + trava única da OLT) ─────────────────────────────

_OLT_LOCK = threading.Lock()

_SECRET_KEY = environ.get("SECRET_KEY", "via01-dev-secret-change-in-production")


def _usuario_do_token(request: Request) -> str:
    try:
        payload = jwt.decode(request.headers.get("Authorization", "")[7:], _SECRET_KEY, algorithms=["HS256"])
        return payload.get("sub") or "?"
    except JWTError:
        return "?"


def _job_criar(tipo: str, usuario: str) -> int:
    conn = db.get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO olt_jobs (tipo, usuario) VALUES (%s, %s) RETURNING id",
                (tipo, usuario),
            )
            job_id = cur.fetchone()[0]
        conn.commit()
        return job_id
    finally:
        conn.close()


def _job_concluir(job_id: int, status: str, detalhe: str):
    conn = db.get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE olt_jobs SET status=%s, detalhe=%s, terminado_em=NOW() WHERE id=%s",
                (status, detalhe[:2000], job_id),
            )
        conn.commit()
    finally:
        conn.close()


# ── Coletas (leitura da OLT / IXC → Postgres) ────────────────────────────────

def coletar_sistema() -> str:
    with olt_client.OltConnection() as olt:
        version_out = olt.send_command(olt_client.CMD_VERSION)
        uptime_out  = olt.send_command(olt_client.CMD_UPTIME)
        slots_out   = olt.send_command(olt_client.CMD_SLOTS)
        temp_out    = olt.send_command(olt_client.CMD_TEMPERATURE)

    release = olt_client.parse_isam_release(version_out)
    uptime  = olt_client.parse_uptime(uptime_out)
    slots   = olt_client.parse_slots(slots_out)
    temps   = olt_client.parse_temperature(temp_out)

    conn = db.get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO olt_system_info (id, isam_release, uptime_days, uptime_hours,
                                             uptime_minutes, uptime_seconds, uptime_raw, atualizado_em)
                VALUES (1, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (id) DO UPDATE SET
                    isam_release = EXCLUDED.isam_release,
                    uptime_days = EXCLUDED.uptime_days, uptime_hours = EXCLUDED.uptime_hours,
                    uptime_minutes = EXCLUDED.uptime_minutes, uptime_seconds = EXCLUDED.uptime_seconds,
                    uptime_raw = EXCLUDED.uptime_raw, atualizado_em = NOW()
            """, (release, uptime["days"], uptime["hours"], uptime["minutes"], uptime["seconds"], uptime["raw"]))

            cur.execute("UPDATE olt_slots SET ativo = FALSE")
            for s in slots:
                cur.execute("""
                    INSERT INTO olt_slots (slot_name, actual_type, enabled, error_status,
                                           availability, restart_count, ativo, atualizado_em)
                    VALUES (%s, %s, %s, %s, %s, %s, TRUE, NOW())
                    ON CONFLICT (slot_name) DO UPDATE SET
                        actual_type = EXCLUDED.actual_type, enabled = EXCLUDED.enabled,
                        error_status = EXCLUDED.error_status, availability = EXCLUDED.availability,
                        restart_count = EXCLUDED.restart_count, ativo = TRUE, atualizado_em = NOW()
                """, (s["slot_name"], s["actual_type"], s["enabled"], s["error_status"],
                      s["availability"], s["restart_count"]))

            cur.execute("UPDATE olt_temperaturas SET ativo = FALSE")
            for t in temps:
                cur.execute("""
                    INSERT INTO olt_temperaturas (slot_name, sensor_id, actual_temp, tca_low, tca_high,
                                                  shutdown_low, shutdown_high, ativo, atualizado_em)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE, NOW())
                    ON CONFLICT (slot_name, sensor_id) DO UPDATE SET
                        actual_temp = EXCLUDED.actual_temp, tca_low = EXCLUDED.tca_low,
                        tca_high = EXCLUDED.tca_high, shutdown_low = EXCLUDED.shutdown_low,
                        shutdown_high = EXCLUDED.shutdown_high, ativo = TRUE, atualizado_em = NOW()
                """, (t["slot_name"], t["sensor_id"], t["actual_temp"], t["tca_low"], t["tca_high"],
                      t["shutdown_low"], t["shutdown_high"]))
        conn.commit()
    finally:
        conn.close()
    return f"release {release}, {len(slots)} slots, {len(temps)} sensores"


def coletar_ocupacao() -> str:
    linhas = []
    with olt_client.OltConnection() as olt:
        for slot in olt_client.SLOTS:
            for pon in olt_client.PONS:
                out = olt.send_command(olt_client.CMD_ONT_STATUS.format(slot=slot, pon=pon))
                count = olt_client.parse_ocupacao(out)
                if count is not None:
                    linhas.append((slot, pon, count))

    conn = db.get_conn()
    try:
        with conn.cursor() as cur:
            # DELETE + INSERT na mesma transação: sem janela de tabela vazia
            cur.execute("DELETE FROM olt_portas")
            for slot, pon, count in linhas:
                cur.execute(
                    "INSERT INTO olt_portas (slot, port, users_connected) VALUES (%s, %s, %s)",
                    (slot, pon, count),
                )
        conn.commit()
    finally:
        conn.close()
    return f"{len(linhas)} portas com ONUs"


def coletar_onus() -> str:
    onus = []
    with olt_client.OltConnection() as olt:  # uma conexão para a varredura toda
        for slot in olt_client.SLOTS:
            for pon in olt_client.PONS:
                out = olt.send_command(olt_client.CMD_ONT_STATUS.format(slot=slot, pon=pon))
                onus.extend(olt_client.parse_ont_status(out))

    conn = db.get_conn()
    try:
        with conn.cursor() as cur:
            # Preserva MACs já coletados (a varredura de status não traz MAC)
            cur.execute("SELECT pon, position, mac FROM olt_onus WHERE mac IS NOT NULL AND mac <> ''")
            macs = {(r[0], r[1]): r[2] for r in cur.fetchall()}

            cur.execute("DELETE FROM olt_onus")
            for o in onus:
                cur.execute("""
                    INSERT INTO olt_onus (pon, position, serial, mac, admin_state, oper_state,
                                          olt_rx_sig, ont_olt, desc1, desc2)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (pon, position) DO NOTHING
                """, (o["pon"], o["position"], o["serial"], macs.get((o["pon"], o["position"])),
                      o["admin_state"], o["oper_state"], o["olt_rx_sig"], o["ont_olt"],
                      o["desc1"], o["desc2"]))
            _atualizar_flag_cliente_fibra(cur)
        conn.commit()
    finally:
        conn.close()
    return f"{len(onus)} ONUs"


def coletar_macs() -> str:
    with olt_client.OltConnection() as olt:
        olt.send_command(olt_client.CMD_INHIBIT)
        out = olt.send_command(olt_client.CMD_FDB, read_timeout=olt_client.FDB_READ_TIMEOUT)

    registros = olt_client.parse_fdb(out)
    conn = db.get_conn()
    try:
        with conn.cursor() as cur:
            for r in registros:
                cur.execute(
                    "UPDATE olt_onus SET mac = %s, atualizado_em = NOW() WHERE pon = %s AND position = %s",
                    (r["mac"], r["pon"], r["position"]),
                )
        conn.commit()
    finally:
        conn.close()
    return f"{len(registros)} MACs aplicados"


def _atualizar_flag_cliente_fibra(cur):
    """Cruza ONUs × clientes fibra do IXC (serial↔mac e desc1↔nome)."""
    cur.execute("""
        UPDATE olt_onus SET cliente_fibra = EXISTS (
            SELECT 1 FROM olt_clientes_fibra c
            WHERE c.mac = olt_onus.serial AND c.nome = olt_onus.desc1 AND c.ativo
        )
    """)


def sincronizar_clientes_fibra() -> str:
    host  = environ.get("IXC_HOST", "")
    token = environ.get("IXC_TOKEN", "").encode()
    if not host or not token:
        raise RuntimeError("IXC_HOST/IXC_TOKEN não configurados")

    headers = {
        "ixcsoft": "listar",
        "Authorization": "Basic " + base64.b64encode(token).decode(),
        "Content-Type": "application/json",
    }

    def pagina(page):
        payload = {
            "qtype": "radpop_radio_cliente_fibra.id", "query": "", "oper": ">",
            "page": page, "rp": "100",
            "sortname": "radpop_radio_cliente_fibra.id", "sortorder": "asc",
        }
        resp = requests.post(
            f"https://{host}/webservice/v1/radpop_radio_cliente_fibra",
            data=json.dumps(payload), headers=headers, timeout=60,
        )
        resp.raise_for_status()
        return resp.json()

    data = pagina(1)
    total = int(data.get("total", 0))
    paginas = (total + 99) // 100

    conn = db.get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE olt_clientes_fibra SET ativo = FALSE")
            for p in range(1, paginas + 1):
                regs = (data if p == 1 else pagina(p)).get("registros", [])
                for r in regs:
                    if not r.get("mac"):
                        continue
                    endereco = f"{r.get('endereco', '')}, {r.get('numero', '')}, {r.get('bairro', '')}, {r.get('cidade', '')}"
                    cur.execute("""
                        INSERT INTO olt_clientes_fibra (mac, nome, latitude, longitude, endereco, id_caixa_ftth, ativo, atualizado_em)
                        VALUES (%s, %s, %s, %s, %s, %s, TRUE, NOW())
                        ON CONFLICT (mac) DO UPDATE SET
                            nome = EXCLUDED.nome, latitude = EXCLUDED.latitude,
                            longitude = EXCLUDED.longitude, endereco = EXCLUDED.endereco,
                            id_caixa_ftth = EXCLUDED.id_caixa_ftth, ativo = TRUE, atualizado_em = NOW()
                    """, (r["mac"], r.get("nome", ""), r.get("latitude", ""), r.get("longitude", ""),
                          endereco, r.get("id_caixa_ftth", "")))
            _atualizar_flag_cliente_fibra(cur)
        conn.commit()
    finally:
        conn.close()
    return f"{total} clientes fibra do IXC"


def coleta_completa() -> str:
    partes = []
    partes.append("sistema: " + coletar_sistema())
    partes.append("ocupação: " + coletar_ocupacao())
    partes.append("onus: " + coletar_onus())
    partes.append("macs: " + coletar_macs())
    partes.append("clientes fibra: " + sincronizar_clientes_fibra())
    return " | ".join(partes)


_COLETAS = {
    "sistema":        coletar_sistema,
    "ocupacao":       coletar_ocupacao,
    "onus":           coletar_onus,
    "macs":           coletar_macs,
    "clientes_fibra": sincronizar_clientes_fibra,
    "completo":       coleta_completa,
}

# clientes_fibra só fala com o IXC — não precisa da trava da OLT
_SEM_TRAVA = {"clientes_fibra"}


def _rodar_job(tipo: str, job_id: int, com_trava: bool):
    try:
        detalhe = _COLETAS[tipo]()
        _job_concluir(job_id, "done", detalhe)
    except Exception as e:
        _job_concluir(job_id, "failed", str(e))
    finally:
        if com_trava:
            _OLT_LOCK.release()


def rodar_coleta_completa_agendada():
    """Chamada pelo agendador (main.py). Pula o ciclo se a OLT estiver ocupada."""
    if not _OLT_LOCK.acquire(blocking=False):
        print("[OLT] Coleta agendada pulada: OLT ocupada com outro job")
        return
    job_id = _job_criar("completo", "agendador")
    _rodar_job("completo", job_id, com_trava=True)


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/api/olt/sync/{tipo}")
def disparar_sync(tipo: str, request: Request):
    if tipo not in _COLETAS:
        raise HTTPException(status_code=400, detail=f"Tipo inválido. Use: {', '.join(_COLETAS)}")

    com_trava = tipo not in _SEM_TRAVA
    if com_trava and not _OLT_LOCK.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="A OLT está ocupada com outra coleta. Aguarde terminar.")

    try:
        job_id = _job_criar(tipo, _usuario_do_token(request))
    except Exception:
        if com_trava:
            _OLT_LOCK.release()
        raise

    threading.Thread(target=_rodar_job, args=(tipo, job_id, com_trava), daemon=True).start()
    return {"job_id": job_id, "message": f"Coleta '{tipo}' iniciada."}


@router.get("/api/olt/jobs")
def listar_jobs(limit: int = 20):
    conn = db.get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT id, tipo, status, detalhe, usuario, iniciado_em, terminado_em "
                "FROM olt_jobs ORDER BY id DESC LIMIT %s", (limit,)
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    for r in rows:
        r["iniciado_em"] = r["iniciado_em"].isoformat() if r["iniciado_em"] else None
        r["terminado_em"] = r["terminado_em"].isoformat() if r["terminado_em"] else None
    return rows


@router.get("/api/olt/overview")
def olt_overview():
    conn = db.get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT COUNT(*) AS total,
                       COUNT(*) FILTER (WHERE oper_state <> 'up')                    AS offline,
                       COUNT(*) FILTER (WHERE mac IS NULL OR mac = '')               AS sem_mac,
                       COUNT(*) FILTER (WHERE NOT cliente_fibra)                     AS sem_cliente,
                       COUNT(*) FILTER (WHERE olt_rx_sig < -27 AND olt_rx_sig >= -29) AS sinal_alerta,
                       COUNT(*) FILTER (WHERE olt_rx_sig < -29)                      AS sinal_critico
                FROM olt_onus
            """)
            kpis = dict(cur.fetchone())

            cur.execute("""
                SELECT slot, port, users_connected FROM olt_portas
                ORDER BY users_connected DESC NULLS LAST LIMIT 5
            """)
            top_portas = [dict(r) for r in cur.fetchall()]

            cur.execute("SELECT * FROM olt_system_info WHERE id = 1")
            sistema = cur.fetchone()
            if sistema:
                sistema = dict(sistema)
                sistema["atualizado_em"] = sistema["atualizado_em"].isoformat() if sistema["atualizado_em"] else None

            cur.execute("SELECT slot_name, actual_type, enabled, error_status, availability, restart_count FROM olt_slots WHERE ativo ORDER BY slot_name")
            slots = [dict(r) for r in cur.fetchall()]

            cur.execute("SELECT slot_name, sensor_id, actual_temp, tca_high, shutdown_high FROM olt_temperaturas WHERE ativo ORDER BY slot_name")
            temps = [dict(r) for r in cur.fetchall()]
            for t in temps:
                t["status"] = (
                    "critico" if t["actual_temp"] is not None and t["tca_high"] is not None and t["actual_temp"] >= t["tca_high"]
                    else "alerta" if t["actual_temp"] is not None and t["tca_high"] is not None and t["actual_temp"] >= t["tca_high"] - 10
                    else "ok"
                )

            cur.execute("SELECT MAX(terminado_em) AS ts FROM olt_jobs WHERE status = 'done'")
            ultima = cur.fetchone()["ts"]
    finally:
        conn.close()

    return {
        **kpis,
        "top_portas": top_portas,
        "sistema": sistema,
        "slots": slots,
        "temperaturas": temps,
        "ultima_coleta": ultima.isoformat() if ultima else None,
        "sem_dados": kpis["total"] == 0,
    }


@router.get("/api/olt/onus")
def listar_onus(busca: str = "", estado: str = "", sinal_max: float = None,
                sem_mac: bool = False, sem_cliente: bool = False):
    where, params = ["TRUE"], []
    if busca:
        where.append("(serial ILIKE %s OR desc1 ILIKE %s OR desc2 ILIKE %s OR mac ILIKE %s OR pon ILIKE %s)")
        params += [f"%{busca}%"] * 5
    if estado:
        where.append("oper_state = %s")
        params.append(estado)
    if sinal_max is not None:
        where.append("olt_rx_sig < %s")
        params.append(sinal_max)
    if sem_mac:
        where.append("(mac IS NULL OR mac = '')")
    if sem_cliente:
        where.append("NOT cliente_fibra")

    conn = db.get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(f"""
                SELECT id, pon, position, serial, mac, admin_state, oper_state,
                       olt_rx_sig, ont_olt, desc1, desc2, cliente_fibra, atualizado_em
                FROM olt_onus WHERE {' AND '.join(where)}
                ORDER BY pon, position
            """, params)
            rows = [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()
    for r in rows:
        r["atualizado_em"] = r["atualizado_em"].isoformat() if r["atualizado_em"] else None
    return rows


@router.get("/api/olt/portas")
def listar_portas():
    conn = db.get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT slot, port, users_connected, atualizado_em FROM olt_portas ORDER BY slot, port")
            rows = [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()
    for r in rows:
        r["atualizado_em"] = r["atualizado_em"].isoformat() if r["atualizado_em"] else None
    return rows


class AcaoBody(BaseModel):
    motivo: str


def _acao_onu(onu_id: int, acao: str, body: AcaoBody, request: Request):
    if not OLT_ACOES_ATIVAS:
        raise HTTPException(status_code=403, detail="Ações na OLT estão desativadas (OLT_ACOES_ATIVAS=0).")
    motivo = (body.motivo or "").strip()
    if len(motivo) < 5:
        raise HTTPException(status_code=400, detail="Informe o motivo (mínimo 5 caracteres).")

    conn = db.get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT pon, position, serial FROM olt_onus WHERE id = %s", (onu_id,))
            onu = cur.fetchone()
    finally:
        conn.close()
    if not onu:
        raise HTTPException(status_code=404, detail="ONU não encontrada")

    interface = f"{onu['pon']}/{onu['position']}"
    usuario = _usuario_do_token(request)

    if not _OLT_LOCK.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="A OLT está ocupada com uma coleta. Aguarde terminar.")
    resultado = "ok"
    try:
        if acao == "reboot":
            olt_client.reboot_onu(interface)
        else:  # remover
            olt_client.remover_onu(interface)
    except Exception as e:
        resultado = f"erro: {e}"
    finally:
        _OLT_LOCK.release()

    conn = db.get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO olt_acoes (usuario, acao, onu_interface, onu_serial, motivo, resultado) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (usuario, acao, interface, onu["serial"], motivo, resultado),
            )
            # Remoção bem-sucedida: a ONU não existe mais na OLT
            if acao == "remover" and resultado == "ok":
                cur.execute("DELETE FROM olt_onus WHERE id = %s", (onu_id,))
        conn.commit()
    finally:
        conn.close()

    if resultado != "ok":
        raise HTTPException(status_code=502, detail=f"Falha na OLT ao {acao} {interface}: {resultado}")
    return {"message": f"ONU {interface} — {acao} executado.", "interface": interface}


@router.post("/api/olt/onus/{onu_id}/reboot")
def reboot_onu(onu_id: int, body: AcaoBody, request: Request):
    return _acao_onu(onu_id, "reboot", body, request)


@router.post("/api/olt/onus/{onu_id}/remover")
def remover_onu(onu_id: int, body: AcaoBody, request: Request):
    return _acao_onu(onu_id, "remover", body, request)


@router.get("/api/olt/acoes")
def listar_acoes(limit: int = 50):
    conn = db.get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT id, usuario, acao, onu_interface, onu_serial, motivo, resultado, criado_em "
                "FROM olt_acoes ORDER BY id DESC LIMIT %s", (limit,)
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    for r in rows:
        r["criado_em"] = r["criado_em"].isoformat() if r["criado_em"] else None
    return rows


@router.get("/api/olt/config")
def olt_config():
    """Config do frontend (ex.: se as ações destrutivas estão habilitadas)."""
    return {"acoes_ativas": OLT_ACOES_ATIVAS}


@router.get("/api/olt/clientes-fibra")
def listar_clientes_fibra(busca: str = ""):
    where, params = ["ativo"], []
    if busca:
        where.append("(nome ILIKE %s OR mac ILIKE %s OR endereco ILIKE %s)")
        params += [f"%{busca}%"] * 3
    conn = db.get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(f"""
                SELECT id, mac, nome, latitude, longitude, endereco, id_caixa_ftth, atualizado_em
                FROM olt_clientes_fibra WHERE {' AND '.join(where)} ORDER BY nome
            """, params)
            rows = [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()
    for r in rows:
        r["atualizado_em"] = r["atualizado_em"].isoformat() if r["atualizado_em"] else None
    return rows
