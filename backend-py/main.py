import io
import re
import json
import math
import time
import base64
import asyncio
import hashlib
import unicodedata
from os import environ
from pathlib import Path
from datetime import datetime, timedelta
from difflib import SequenceMatcher, get_close_matches
from zoneinfo import ZoneInfo

import requests
import pandas as pd
import psycopg2
import psycopg2.extras
from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from jose import JWTError, jwt
from passlib.context import CryptContext
from dotenv import load_dotenv

import db as hotspot_db
from guests_admin import router as guests_router, reclassificar_guests
from funil_admin import router as funil_router

load_dotenv()

# ── Auth ────────────────────────────────────────────────────────────────────
SECRET_KEY = environ.get("SECRET_KEY", "via01-dev-secret-change-in-production")
ALGORITHM  = "HS256"
TOKEN_EXPIRE_HOURS = 8

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

class LoginRequest(BaseModel):
    username: str
    password: str

# ── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(title="Controle Interno API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rotas públicas — sem autenticação
_PUBLIC = {"/api/auth/login", "/api/health"}

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    # Só as rotas /api/* exigem token; o resto é o frontend estático (SPA)
    if not request.url.path.startswith("/api") or request.url.path in _PUBLIC or request.method == "OPTIONS":
        return await call_next(request)
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return JSONResponse({"detail": "Não autenticado"}, status_code=401)
    try:
        jwt.decode(auth[7:], SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return JSONResponse({"detail": "Token inválido ou expirado"}, status_code=401)
    return await call_next(request)

UPLOAD_DIR = Path("/app/uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

CACHE_TTL = int(environ.get("CACHE_TTL_SECONDS", 300))
DATABASE_URL = environ.get("DATABASE_URL", "postgresql://controle:controle@db:5432/controle")

COLUNAS_EXCEL = ["DIA", "NOME", "TELEFONE", "CIDADE", "BAIRRO", "FACEBOOK/INSTAGRAM", "RESULTADO"]

# Cidades disponíveis: id → configuração da aba do Excel
CIDADES = {
    "ouro_fino":  {"label": "Ouro Fino",    "sheet": "ANÚNCIO OURO FINO"},
    "borda_mata": {"label": "Clientes Borda", "sheet": "ANÚNCIO BORDA"},
}

# Cidades de vendas: id → aba do Excel
CIDADES_VENDAS = {
    "borda_mata":    {"label": "Clientes Borda", "sheet": "Clientes Borda",                "skiprows": 1896},
    "ouro_fino":     {"label": "Ouro Fino",     "sheet": "Clientes Ouro Fino",             "skiprows": 0},
    "inconfidentes": {"label": "Inconfidentes", "sheet": "Clientes Via 01 Inconfidentes",  "skiprows": 0},
}

CIDADES_CANCELAMENTOS = {
    "borda_mata":    {"label": "Clientes Borda", "sheet": "Cancelamentos Borda",        "skiprows": 1},
    "ouro_fino":     {"label": "Ouro Fino",      "sheet": "CANCELAMENTOS OF",           "skiprows": 0},
    "inconfidentes": {"label": "Inconfidentes",  "sheet": "Cancelamentos Inconfidentes","skiprows": 1},
}

# Vendas — colunas A-F
COLUNAS_VENDAS = ["data", "nome", "instalacao", "mes", "dia_semana", "vendedor"]

# --------------- IXC Provedor API ---------------

IXC_HOST  = environ.get("IXC_HOST", "")
IXC_TOKEN = environ.get("IXC_TOKEN", "")
IXC_BASE  = f"https://{IXC_HOST}/webservice/v1"

IXC_CIDADES = {
    "borda_mata":    "2331",
    "ouro_fino":     "2780",
    "inconfidentes": "2590",
}

# Mapa id_assunto → nome (tabela su_oss_assunto do IXC)
IXC_ASSUNTOS: dict[str, str] = {
    "1":  "Instalação",
    "2":  "Instabilidade",
    "3":  "Mudança de endereço",
    "4":  "Troca de equipamento",
    "5":  "Problemas no Wi-Fi",
    "6":  "Cancelamento - Retirada de equipamento",
    "7":  "Sem conexão",
    "8":  "Visita Técnica",
    "9":  "Configuração de Roteador",
    "10": "Passagem de cabo",
    "11": "Configuração de Deco",
    "12": "Sinal alto",
    "13": "Atualização de Firmware",
    "14": "Acesso Remoto",
    "15": "Cadastro",
    "16": "Financeiro",
    "17": "Telefone",
    "18": "Novo Cliente",
    "19": "Desistência de instalação",
    "20": "Última Tentativa de Negociação",
    "21": "Entrega de Equipamento em Loja",
    "22": "Cancelar Contrato no Sistema",
    "23": "Recolhido - Conferência",
    "24": "Não recolhido - Gerar Cobrança",
    "25": "Cancelamento por inadimplência",
    "26": "Reversão do Cancelamento",
    "27": "Agendar Retirada",
    "28": "Cancelamento por solicitação",
    "29": "Lembrete - cancelamento inadimplência",
}

# Grupos de assuntos para análise
IXC_GRUPOS_ASSUNTO = {
    "Instalação / Novo Cliente": {"1", "18"},
    "Cancelamento":              {"6", "19", "22", "25", "27", "28", "29"},
    "Reversão / Recuperação":   {"20", "26"},
    "Suporte Técnico":           {"2", "5", "7", "8", "9", "10", "11", "12", "13", "14"},
    "Administrativo":            {"3", "4", "15", "16", "17", "21", "23", "24"},
}

IXC_CACHE_TTL_SECS = int(environ.get("IXC_CACHE_TTL_SECONDS", "600"))
_ixc_cache: dict = {}

MESES_A = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]


def _ixc_headers() -> dict:
    b64 = base64.b64encode(IXC_TOKEN.encode()).decode()
    return {
        "Authorization": f"Basic {b64}",
        "Content-Type": "application/json",
        "ixcsoft": "listar",
    }


def _ixc_fetch_por_ano(ano: int) -> list:
    """Busca do IXC todos os clientes com data_cadastro no ano informado (com cache)."""
    cache_key = f"ixc_{ano}"
    now = time.time()
    cached = _ixc_cache.get(cache_key, {})
    if cached.get("data") is not None and (now - cached.get("ts", 0)) < IXC_CACHE_TTL_SECS:
        return cached["data"]

    todos: list = []
    page = 1
    while True:
        payload = {
            "qtype":     "data_cadastro",
            "query":     f"{ano}-01-01",
            "oper":      ">=",
            "page":      page,
            "rp":        200,
            "sortname":  "data_cadastro",
            "sortorder": "asc",
        }
        try:
            resp = requests.post(
                f"{IXC_BASE}/cliente",
                data=json.dumps(payload),
                headers=_ixc_headers(),
                timeout=30,
                verify=True,
            )
            data = resp.json()
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Erro ao consultar IXC: {e}")

        if data.get("type") == "error":
            raise HTTPException(status_code=502, detail=f"IXC: {data.get('message','erro desconhecido')}")

        regs = data.get("registros", [])
        if not regs:
            break

        for r in regs:
            dc = r.get("data_cadastro", "")
            if dc.startswith(str(ano)):
                todos.append(r)

        total_api = int(data.get("total", 0))
        if len(todos) >= total_api or not regs:
            break
        page += 1

    _ixc_cache[cache_key] = {"data": todos, "ts": now}
    return todos


def _ixc_fetch_all_clientes() -> list:
    """Busca TODOS os clientes do IXC sem filtro de ano (para sync completo)."""
    todos: list = []
    page = 1
    while True:
        payload = {
            "qtype": "id", "query": "1", "oper": ">=",
            "page": page, "rp": 200,
            "sortname": "id", "sortorder": "asc",
        }
        try:
            resp = requests.post(
                f"{IXC_BASE}/cliente",
                data=json.dumps(payload),
                headers=_ixc_headers(),
                timeout=60,
                verify=True,
            )
            data = resp.json()
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Erro ao consultar IXC: {e}")

        if data.get("type") == "error":
            raise HTTPException(status_code=502, detail=f"IXC: {data.get('message','erro desconhecido')}")

        regs = data.get("registros", [])
        if not regs:
            break

        todos.extend(regs)
        total_api = int(data.get("total", 0))
        total_pages = (total_api + 199) // 200
        if page >= total_pages:
            break
        page += 1

    return todos


def _ixc_fetch_os(data_inicio: str, data_fim: str) -> list:
    """Busca Ordens de Serviço do IXC no período informado."""
    todos: list = []
    page = 1
    while True:
        payload = {
            "qtype": "data_abertura", "query": data_inicio, "oper": ">=",
            "page": page, "rp": 200,
            "sortname": "data_abertura", "sortorder": "asc",
        }
        try:
            resp = requests.post(
                f"{IXC_BASE}/su_oss_chamado",
                data=json.dumps(payload),
                headers=_ixc_headers(),
                timeout=60,
                verify=True,
            )
            data = resp.json()
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Erro ao consultar OS IXC: {e}")

        if data.get("type") == "error":
            raise HTTPException(status_code=502, detail=f"IXC OS: {data.get('message','erro desconhecido')}")

        regs = data.get("registros", [])
        if not regs:
            break

        for r in regs:
            da = (r.get("data_abertura") or "")[:10]
            if da <= data_fim:
                todos.append(r)

        total_api = int(data.get("total", 0))
        total_pages = (total_api + 199) // 200
        if page >= total_pages:
            break
        page += 1

    return todos


def _ixc_fetch_logins(data_inicio: str) -> list:
    """Busca radusuarios do IXC com ultima_atualizacao >= data_inicio.
    radusuarios: um registro por conexão PPPoE (login); ultima_atualizacao = CURRENT_TIMESTAMP na criação.
    """
    todos: list = []
    page = 1
    while True:
        payload = {
            "qtype":     "radusuarios.ultima_atualizacao",
            "query":     data_inicio,
            "oper":      ">=",
            "page":      page,
            "rp":        200,
            "sortname":  "radusuarios.ultima_atualizacao",
            "sortorder": "asc",
        }
        try:
            resp = requests.post(
                f"{IXC_BASE}/radusuarios",
                data=json.dumps(payload),
                headers=_ixc_headers(),
                timeout=60,
                verify=True,
            )
            data = resp.json()
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Erro ao consultar radusuarios IXC: {e}")

        if data.get("type") == "error":
            raise HTTPException(status_code=502, detail=f"IXC radusuarios: {data.get('message', 'erro desconhecido')}")

        regs = data.get("registros", [])
        if not regs:
            break

        todos.extend(regs)
        total_api = int(data.get("total", 0))
        total_pages = (total_api + 199) // 200
        if page >= total_pages:
            break
        page += 1

    return todos


def _ixc_fetch_contratos(data_inicio: str = None) -> list:
    """Busca contratos do IXC (cliente_contrato).

    Com data_inicio: só contratos com data_ativacao >= data_inicio (incremental).
    Sem data_inicio: a base COMPLETA (necessária para detectar ex-clientes antigos).
    """
    todos: list = []
    page = 1
    while True:
        if data_inicio:
            payload = {
                "qtype":     "data_ativacao",
                "query":     data_inicio,
                "oper":      ">=",
                "page":      page,
                "rp":        200,
                "sortname":  "data_ativacao",
                "sortorder": "asc",
            }
        else:
            payload = {
                "qtype":     "id",
                "query":     "1",
                "oper":      ">=",
                "page":      page,
                "rp":        200,
                "sortname":  "id",
                "sortorder": "asc",
            }
        try:
            resp = requests.post(
                f"{IXC_BASE}/cliente_contrato",
                data=json.dumps(payload),
                headers=_ixc_headers(),
                timeout=60,
                verify=True,
            )
            data = resp.json()
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Erro ao consultar contratos IXC: {e}")

        if data.get("type") == "error":
            raise HTTPException(status_code=502, detail=f"IXC contratos: {data.get('message', 'erro desconhecido')}")

        regs = data.get("registros", [])
        if not regs:
            break

        todos.extend(regs)
        total_api = int(data.get("total", 0))
        total_pages = (total_api + 199) // 200
        if page >= total_pages:
            break
        page += 1

    return todos


# --------------- banco de dados ---------------

def get_conn():
    return psycopg2.connect(DATABASE_URL)


def init_db():
    conn = get_conn()
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS anuncio_ouro_fino (
                id                 SERIAL PRIMARY KEY,
                hash               CHAR(64) UNIQUE NOT NULL,
                dia                TEXT,
                nome               TEXT,
                telefone           TEXT,
                cidade             TEXT,
                bairro             TEXT,
                facebook_instagram TEXT,
                resultado          TEXT,
                origem             TEXT NOT NULL DEFAULT 'ouro_fino',
                importado_em       TIMESTAMP DEFAULT NOW()
            )
        """)
        cur.execute("""
            ALTER TABLE anuncio_ouro_fino
            ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'ouro_fino'
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS vendas_borda_mata (
                id           SERIAL PRIMARY KEY,
                hash         CHAR(64) UNIQUE NOT NULL,
                data         TEXT,
                nome         TEXT,
                instalacao   TEXT,
                mes          TEXT,
                dia_semana   TEXT,
                vendedor     TEXT,
                origem       TEXT NOT NULL DEFAULT 'ouro_fino',
                importado_em TIMESTAMP DEFAULT NOW()
            )
        """)
        cur.execute("""
            ALTER TABLE vendas_borda_mata
            ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'ouro_fino'
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS ixc_clientes (
                id                SERIAL PRIMARY KEY,
                ixc_id            INTEGER UNIQUE NOT NULL,
                nome              TEXT,
                data_cadastro     DATE,
                cidade_ixc_id     TEXT,
                bairro            TEXT,
                cep               TEXT,
                fone              TEXT,
                ativo             CHAR(1),
                status_prospeccao TEXT,
                synced_at         TIMESTAMP DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_ixc_clientes_cidade ON ixc_clientes (cidade_ixc_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_ixc_clientes_data ON ixc_clientes (data_cadastro)")
        # Todos os telefones do cadastro, normalizados (só dígitos, separados por vírgula)
        # — usados para classificar acessos do hotspot por telefone
        cur.execute("ALTER TABLE ixc_clientes ADD COLUMN IF NOT EXISTS fones TEXT")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS ixc_os (
                id              SERIAL PRIMARY KEY,
                ixc_os_id       INTEGER UNIQUE NOT NULL,
                protocolo       TEXT,
                id_cliente      INTEGER,
                id_assunto      INTEGER,
                id_login        INTEGER,
                id_cidade       TEXT,
                assunto         TEXT,
                tipo_chamado    TEXT,
                status          TEXT,
                data_abertura   TIMESTAMP,
                data_fechamento TIMESTAMP,
                mensagem        TEXT,
                bairro          TEXT,
                synced_at       TIMESTAMP DEFAULT NOW()
            )
        """)
        cur.execute("ALTER TABLE ixc_os ADD COLUMN IF NOT EXISTS id_assunto   INTEGER")
        cur.execute("ALTER TABLE ixc_os ADD COLUMN IF NOT EXISTS id_login     INTEGER")
        cur.execute("ALTER TABLE ixc_os ADD COLUMN IF NOT EXISTS id_cidade    TEXT")
        cur.execute("ALTER TABLE ixc_os ADD COLUMN IF NOT EXISTS mensagem     TEXT")
        cur.execute("ALTER TABLE ixc_os ADD COLUMN IF NOT EXISTS bairro       TEXT")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_ixc_os_cliente  ON ixc_os (id_cliente)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_ixc_os_data     ON ixc_os (data_abertura)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_ixc_os_assunto  ON ixc_os (id_assunto)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_ixc_os_cidade   ON ixc_os (id_cidade)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS cancelamentos (
                id           SERIAL PRIMARY KEY,
                hash         CHAR(64) UNIQUE NOT NULL,
                nome         TEXT,
                motivo       TEXT,
                col_c        TEXT,
                mes          TEXT,
                origem       TEXT NOT NULL,
                importado_em TIMESTAMP DEFAULT NOW()
            )
        """)
        cur.execute("ALTER TABLE cancelamentos ADD COLUMN IF NOT EXISTS nome   TEXT")
        cur.execute("ALTER TABLE cancelamentos ADD COLUMN IF NOT EXISTS motivo TEXT")
        cur.execute("ALTER TABLE cancelamentos ADD COLUMN IF NOT EXISTS col_c  TEXT")
        cur.execute("ALTER TABLE cancelamentos ADD COLUMN IF NOT EXISTS mes    TEXT")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_canc_origem ON cancelamentos (origem)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_canc_mes    ON cancelamentos (mes)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS cancelamentos_meta (
                origem     TEXT PRIMARY KEY,
                headers    TEXT NOT NULL DEFAULT '[]',
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS ixc_contratos (
                id               SERIAL PRIMARY KEY,
                ixc_contrato_id  INTEGER UNIQUE NOT NULL,
                id_cliente       INTEGER,
                data_ativacao    DATE,
                status           TEXT,
                cidade_ixc_id    TEXT,
                synced_at        TIMESTAMP DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_ixc_contratos_data   ON ixc_contratos (data_ativacao)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_ixc_contratos_cidade ON ixc_contratos (cidade_ixc_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_ixc_contratos_cli    ON ixc_contratos (id_cliente)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS contratos_manuais (
                id            SERIAL PRIMARY KEY,
                nome          TEXT NOT NULL,
                data_ativacao DATE NOT NULL,
                status        TEXT DEFAULT 'A',
                cidade_ixc_id TEXT,
                bairro        TEXT,
                fone          TEXT,
                obs           TEXT,
                criado_em     TIMESTAMP DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_contratos_manuais_cidade ON contratos_manuais (cidade_ixc_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_contratos_manuais_data   ON contratos_manuais (data_ativacao)")
        # Registros do IXC ocultados manualmente da dashboard (duplicados,
        # lançamentos errados etc.) — o sync não os traz de volta à lista
        cur.execute("""
            CREATE TABLE IF NOT EXISTS ixc_registros_ocultos (
                tipo        TEXT NOT NULL,          -- 'contrato' | 'os'
                source_id   INTEGER NOT NULL,
                nome        TEXT,
                ocultado_em TIMESTAMP DEFAULT NOW(),
                PRIMARY KEY (tipo, source_id)
            )
        """)
        # Registros validados manualmente como nova instalação — passam por
        # cima da regra automática (cadastro novo + OS de instalação)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS ixc_registros_validados (
                tipo        TEXT NOT NULL,
                source_id   INTEGER NOT NULL,
                nome        TEXT,
                validado_em TIMESTAMP DEFAULT NOW(),
                PRIMARY KEY (tipo, source_id)
            )
        """)
        cur.execute("ALTER TABLE ixc_registros_ocultos   ADD COLUMN IF NOT EXISTS motivo TEXT")
        cur.execute("ALTER TABLE ixc_registros_validados ADD COLUMN IF NOT EXISTS motivo TEXT")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS cancelamentos_manuais (
                id            SERIAL PRIMARY KEY,
                nome          TEXT NOT NULL,
                data_abertura DATE NOT NULL,
                cidade_ixc_id TEXT,
                bairro        TEXT,
                fone          TEXT,
                obs           TEXT,
                criado_em     TIMESTAMP DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_cancelamentos_manuais_cidade ON cancelamentos_manuais (cidade_ixc_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_cancelamentos_manuais_data   ON cancelamentos_manuais (data_abertura)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS ixc_logins (
                id            SERIAL PRIMARY KEY,
                ixc_login_id  INTEGER UNIQUE NOT NULL,
                id_cliente    INTEGER,
                id_contrato   INTEGER,
                login         TEXT,
                data_criacao  DATE,
                ativo         CHAR(1),
                cidade_ixc_id TEXT,
                synced_at     TIMESTAMP DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_ixc_logins_data    ON ixc_logins (data_criacao)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_ixc_logins_cidade  ON ixc_logins (cidade_ixc_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_ixc_logins_cliente ON ixc_logins (id_cliente)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS usuarios (
                id       SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                nome     TEXT,
                senha    TEXT NOT NULL,
                ativo    BOOLEAN DEFAULT TRUE,
                admin    BOOLEAN DEFAULT FALSE
            )
        """)
        cur.execute("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS admin BOOLEAN DEFAULT FALSE")
    conn.commit()
    conn.close()


def _criar_admin_padrao():
    """Cria usuário admin se nenhum usuário existir no banco."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM usuarios")
            if cur.fetchone()[0] == 0:
                senha_hash = pwd_context.hash("admin123")
                cur.execute(
                    "INSERT INTO usuarios (username, nome, senha, admin) VALUES (%s, %s, %s, TRUE)",
                    ("admin", "Administrador", senha_hash),
                )
        # Garante que o usuário admin sempre tem permissão admin=TRUE
        conn2 = get_conn()
        try:
            with conn2.cursor() as cur2:
                cur2.execute("UPDATE usuarios SET admin = TRUE WHERE username = 'admin' AND admin = FALSE")
            conn2.commit()
        finally:
            conn2.close()
        conn.commit()
    finally:
        conn.close()


@app.on_event("startup")
def startup():
    if DATABASE_URL:
        init_db()
        hotspot_db.init_hotspot_tables()
        _criar_admin_padrao()


# ── Sincronização IXC agendada (diária) ──────────────────────────────────────
# Roda todos os dias no horário IXC_SYNC_HORA (HH:MM, hora local; vazio desativa).
# Os botões manuais da tela Admin continuam funcionando normalmente.
IXC_SYNC_HORA = environ.get("IXC_SYNC_HORA", "08:00")
_TZ_LOCAL = ZoneInfo(environ.get("TZ", "America/Sao_Paulo"))


async def _agendador_sync_ixc():
    hora, minuto = (int(x) for x in IXC_SYNC_HORA.split(":"))
    while True:
        agora = datetime.now(_TZ_LOCAL)
        proximo = agora.replace(hour=hora, minute=minuto, second=0, microsecond=0)
        if proximo <= agora:
            proximo += timedelta(days=1)
        await asyncio.sleep((proximo - agora).total_seconds())

        print(f"[SYNC] Sincronização IXC agendada iniciando ({datetime.now(_TZ_LOCAL):%d/%m/%Y %H:%M})")
        etapas = [
            ("clientes",  ixc_sync_clientes),
            ("contratos", ixc_sync_contratos),
            ("logins",    ixc_sync_logins),
            ("os",        ixc_sync_os),
            ("reclassificar-guests", reclassificar_guests),
        ]
        for nome, fn in etapas:
            try:
                resultado = await asyncio.to_thread(fn)
                print(f"[SYNC] {nome}: {resultado.get('message', 'ok')}")
            except Exception as e:
                print(f"[SYNC] Erro em {nome}: {e}")
        print("[SYNC] Sincronização agendada concluída.")


@app.on_event("startup")
async def _inicia_agendador_sync():
    if IXC_SYNC_HORA and IXC_TOKEN and DATABASE_URL:
        asyncio.create_task(_agendador_sync_ixc())
        print(f"[SYNC] Agendador diário ativo — próxima execução às {IXC_SYNC_HORA} ({_TZ_LOCAL.key})")


def _row_hash(row: dict, colunas: list) -> str:
    key = "|".join(str(row.get(c, "")) for c in colunas)
    return hashlib.sha256(key.encode()).hexdigest()


def _clean(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return ""
    s = str(v).strip()
    return "" if s == "nan" else s


_FORMATOS_DATA = ["%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"]

def _parse_data(s: str):
    for fmt in _FORMATOS_DATA:
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            pass
    return None


def _resolver_aba(source, nome_configurado) -> str:
    """Encontra o nome exato da aba no arquivo, tolerando diferenças de espaço e capitalização."""
    xl = pd.ExcelFile(source)
    abas = xl.sheet_names
    alvo = str(nome_configurado).strip().lower()
    for aba in abas:
        if aba.strip().lower() == alvo:
            return aba
    raise ValueError(
        f"Aba '{nome_configurado}' não encontrada. Abas disponíveis: {abas}"
    )


def _normalizar_data(v) -> str:
    """Converte qualquer valor de data para 'YYYY-MM-DD', ou '' se inválido."""
    if hasattr(v, "isoformat"):
        return v.isoformat().split("T")[0]
    s = _clean(v)
    if not s:
        return ""
    dt = _parse_data(s)
    return dt.strftime("%Y-%m-%d") if dt else s


def _df_to_rows(df: pd.DataFrame, origem: str) -> list:
    registros = []
    for _, r in df.iterrows():
        row = {
            "DIA":                _normalizar_data(r.get("DIA", "")),
            "NOME":               _clean(r.get("NOME", "")),
            "TELEFONE":           _clean(r.get("TELEFONE", "")),
            "CIDADE":             _clean(r.get("CIDADE", "")),
            "BAIRRO":             _clean(r.get("BAIRRO", "")),
            "FACEBOOK/INSTAGRAM": _clean(r.get("FACEBOOK/INSTAGRAM", "")),
            "RESULTADO":          _clean(r.get("RESULTADO", "")),
            "origem":             origem,
        }
        registros.append(row)
    return registros


def _vendas_to_rows(df: pd.DataFrame) -> list:
    registros = []
    for _, r in df.iterrows():
        data = r.get("data", "")
        if hasattr(data, "isoformat"):
            data = data.isoformat().split("T")[0]
        row = {
            "data":       _clean(data),
            "nome":       _clean(r.get("nome", "")),
            "instalacao": _clean(r.get("instalacao", "")),
            "mes":        _clean(r.get("mes", "")),
            "dia_semana": _clean(r.get("dia_semana", "")),
            "vendedor":   _clean(r.get("vendedor", "")),
        }
        registros.append(row)
    return registros


# --------------- download OneDrive ---------------

_cache: dict = {}        # leads: keyed by origem → {"df": df, "ts": ts}
_vendas_cache: dict = {} # vendas: {"df": df, "ts": ts}
_canc_cache: dict = {}   # cancelamentos: {"df": df, "ts": ts, "headers": [...]}


def _onedrive_download_url(share_url: str) -> str:
    sep = "&" if "?" in share_url else "?"
    return f"{share_url}{sep}download=1"


def _get_excel_source():
    local_files = (
        sorted(UPLOAD_DIR.glob("*.xlsx"))
        + sorted(UPLOAD_DIR.glob("*.xls"))
        + sorted(UPLOAD_DIR.glob("*.xlsm"))
    )
    if local_files:
        return local_files[-1]
    share_url = environ.get("ONEDRIVE_SHARE_URL", "")
    if not share_url:
        raise HTTPException(
            status_code=400,
            detail="Nenhuma planilha disponivel. Faca upload ou configure ONEDRIVE_SHARE_URL.",
        )
    url = _onedrive_download_url(share_url)
    session = requests.Session()
    session.headers.update(
        {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    )
    resp = None
    for attempt in range(3):
        resp = session.get(url, allow_redirects=True, timeout=30)
        if resp.status_code == 200:
            break
        time.sleep(2 * (attempt + 1))
    if resp.status_code != 200:
        raise HTTPException(
            status_code=resp.status_code,
            detail=f"Erro ao baixar do OneDrive (HTTP {resp.status_code}).",
        )
    return io.BytesIO(resp.content)


def get_dataframe(origem: str = "ouro_fino") -> pd.DataFrame:
    now = time.time()
    cached = _cache.get(origem, {})
    if cached.get("df") is not None and (now - cached.get("ts", 0)) < CACHE_TTL:
        return cached["df"]

    source = _get_excel_source()
    sheet_name = _resolver_aba(source, CIDADES[origem]["sheet"])
    df = pd.read_excel(source, sheet_name=sheet_name)
    df.columns = [str(c).strip() for c in df.columns]
    df = df.loc[:, ~df.columns.str.startswith("Unnamed")]
    df = df.dropna(how="all")
    if "NOME" in df.columns:
        df = df[df["NOME"].notna() & (df["NOME"].astype(str).str.strip() != "")]
    _cache[origem] = {"df": df, "ts": now}
    return df


def _read_vendas_excel(source, sheet_name: str, skiprows: int) -> pd.DataFrame:
    """Lê uma aba de vendas pulando `skiprows` linhas, colunas A-F."""
    df = pd.read_excel(
        source,
        sheet_name=sheet_name,
        skiprows=skiprows,
        header=None,
        usecols=[0, 1, 2, 3, 4, 5],
        names=COLUNAS_VENDAS,
    )
    df = df.dropna(how="all")
    df = df[df["data"].notna()]
    df = df[df["nome"].notna() & (df["nome"].astype(str).str.strip() != "")]
    return df


def get_vendas_dataframe(origem: str = "ouro_fino") -> pd.DataFrame:
    now = time.time()
    cached = _vendas_cache.get(origem, {})
    if cached.get("df") is not None and (now - cached.get("ts", 0)) < CACHE_TTL:
        return cached["df"]

    source = _get_excel_source()
    cfg = CIDADES_VENDAS[origem]
    sheet_name = _resolver_aba(source, cfg["sheet"])
    df = _read_vendas_excel(source, sheet_name, cfg["skiprows"])
    _vendas_cache[origem] = {"df": df, "ts": now}
    return df


_MESES_PT = {
    "janeiro": "01", "fevereiro": "02", "março": "03", "marco": "03",
    "abril": "04", "maio": "05", "junho": "06", "julho": "07",
    "agosto": "08", "setembro": "09", "outubro": "10",
    "novembro": "11", "dezembro": "12",
}


def get_cancelamentos_dataframe(origem: str):
    now = time.time()
    cached = _canc_cache.get(origem, {})
    if cached.get("df") is not None and (now - cached.get("ts", 0)) < CACHE_TTL:
        return cached["df"], cached.get("headers", [])

    source = _get_excel_source()
    cfg = CIDADES_CANCELAMENTOS[origem]
    sheet_name = _resolver_aba(source, cfg["sheet"])
    skiprows = cfg.get("skiprows", 0)

    df = pd.read_excel(source, sheet_name=sheet_name, header=0, skiprows=skiprows)
    df.columns = [str(c).strip() for c in df.columns]

    # Seleciona primeiras 3 colunas válidas por POSIÇÃO (evita problema de nomes duplicados)
    seen: set = set()
    valid_pairs: list = []
    for i, c in enumerate(df.columns):
        if not c or c.lower() in ("nan", "") or c.startswith("Unnamed"):
            continue
        if c in seen:
            continue
        seen.add(c)
        valid_pairs.append((i, c))
        if len(valid_pairs) >= 3:
            break

    headers = [name for _, name in valid_pairs]
    if valid_pairs:
        df = df.iloc[:, [i for i, _ in valid_pairs]].copy()
        df.columns = headers
    df = df.dropna(how="all")

    _canc_cache[origem] = {"df": df, "ts": now, "headers": headers}
    return df, headers


def _canc_to_rows(df: pd.DataFrame) -> list:
    """Col A → nome, Col B → motivo, Col C → col_c."""
    registros = []
    cols = list(df.columns)

    def safe(r, i):
        return _clean(r.iloc[i]) if i < len(r) else ""

    for _, r in df.iterrows():
        row = {
            "nome":   safe(r, 0),
            "motivo": safe(r, 1),
            "col_c":  safe(r, 2),
        }
        registros.append(row)
    return registros


# --------------- endpoints ---------------

@app.get("/api/health")
def health():
    return {"status": "ok"}


# ── Auth endpoints ────────────────────────────────────────────────────────────

@app.post("/api/auth/login")
def auth_login(body: LoginRequest):
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT id, username, nome, senha, ativo, admin FROM usuarios WHERE username = %s",
                (body.username.strip(),),
            )
            user = cur.fetchone()
    finally:
        conn.close()

    if not user or not user["ativo"]:
        raise HTTPException(status_code=401, detail="Usuário ou senha inválidos")
    if not pwd_context.verify(body.password, user["senha"]):
        raise HTTPException(status_code=401, detail="Usuário ou senha inválidos")

    expires = datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS)
    token = jwt.encode(
        {"sub": user["username"], "nome": user["nome"], "admin": bool(user["admin"]), "exp": expires},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )
    return {
        "access_token": token, "token_type": "bearer",
        "nome": user["nome"], "username": user["username"],
        "admin": bool(user["admin"]),
    }


@app.get("/api/auth/me")
def auth_me(request: Request):
    token = request.headers.get("Authorization", "")[7:]
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return {
            "username": payload.get("sub"),
            "nome":     payload.get("nome"),
            "admin":    bool(payload.get("admin", False)),
        }
    except JWTError:
        raise HTTPException(status_code=401, detail="Token inválido")


@app.post("/api/auth/alterar-senha")
def auth_alterar_senha(request: Request, body: dict):
    token = request.headers.get("Authorization", "")[7:]
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    username = payload.get("sub")
    senha_atual = body.get("senha_atual", "")
    nova_senha  = body.get("nova_senha", "")
    if not nova_senha or len(nova_senha) < 4:
        raise HTTPException(status_code=400, detail="Nova senha deve ter ao menos 4 caracteres")
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT senha FROM usuarios WHERE username = %s", (username,))
            user = cur.fetchone()
            if not user or not pwd_context.verify(senha_atual, user["senha"]):
                raise HTTPException(status_code=401, detail="Senha atual incorreta")
            cur.execute(
                "UPDATE usuarios SET senha = %s WHERE username = %s",
                (pwd_context.hash(nova_senha), username),
            )
        conn.commit()
    finally:
        conn.close()
    return {"message": "Senha alterada com sucesso"}


def _payload(request: Request) -> dict:
    token = request.headers.get("Authorization", "")[7:]
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Token inválido")

def _require_admin(request: Request) -> dict:
    payload = _payload(request)
    if not payload.get("admin"):
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores")
    return payload


@app.get("/api/usuarios")
def listar_usuarios(request: Request):
    _require_admin(request)
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT id, username, nome, ativo, admin FROM usuarios ORDER BY id")
            return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


@app.post("/api/usuarios")
def criar_usuario(request: Request, body: dict):
    _require_admin(request)
    username = (body.get("username") or "").strip()
    nome     = (body.get("nome")     or "").strip()
    senha    = (body.get("senha")    or "")
    is_admin = bool(body.get("admin", False))
    if not username or not senha:
        raise HTTPException(status_code=400, detail="username e senha são obrigatórios")
    if len(senha) < 4:
        raise HTTPException(status_code=400, detail="Senha deve ter ao menos 4 caracteres")
    senha_hash = pwd_context.hash(senha)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO usuarios (username, nome, senha, admin) VALUES (%s, %s, %s, %s) RETURNING id",
                (username, nome, senha_hash, is_admin),
            )
            new_id = cur.fetchone()[0]
        conn.commit()
    except Exception as e:
        conn.rollback()
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail="Usuário já existe")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()
    return {"id": new_id, "username": username, "nome": nome, "admin": is_admin}


@app.patch("/api/usuarios/{uid}")
def atualizar_usuario(uid: int, request: Request, body: dict):
    payload = _require_admin(request)
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT id, username FROM usuarios WHERE id = %s", (uid,))
            user = cur.fetchone()
            if not user:
                raise HTTPException(status_code=404, detail="Usuário não encontrado")
            # Impede desativar a si mesmo
            if user["username"] == payload.get("sub") and body.get("ativo") is False:
                raise HTTPException(status_code=400, detail="Você não pode desativar sua própria conta")
            campos = {}
            if "ativo" in body:
                campos["ativo"] = bool(body["ativo"])
            if "admin" in body:
                campos["admin"] = bool(body["admin"])
            if campos:
                sets = ", ".join(f"{k} = %s" for k in campos)
                cur.execute(f"UPDATE usuarios SET {sets} WHERE id = %s", (*campos.values(), uid))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.delete("/api/usuarios/{uid}")
def deletar_usuario(uid: int, request: Request):
    payload = _require_admin(request)
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT username FROM usuarios WHERE id = %s", (uid,))
            user = cur.fetchone()
            if not user:
                raise HTTPException(status_code=404, detail="Usuário não encontrado")
            if user["username"] == payload.get("sub"):
                raise HTTPException(status_code=400, detail="Você não pode excluir sua própria conta")
            cur.execute("DELETE FROM usuarios WHERE id = %s", (uid,))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.get("/api/admin/arquivo")
def admin_arquivo():
    """Retorna informações sobre o arquivo Excel atual no servidor."""
    local_files = (
        sorted(UPLOAD_DIR.glob("*.xlsx"))
        + sorted(UPLOAD_DIR.glob("*.xls"))
        + sorted(UPLOAD_DIR.glob("*.xlsm"))
    )
    if not local_files:
        return {"arquivo": None, "tamanho": None, "modificado": None}
    f = local_files[-1]
    stat = f.stat()
    return {
        "arquivo": f.name,
        "tamanho_kb": round(stat.st_size / 1024, 1),
        "modificado": datetime.fromtimestamp(stat.st_mtime).strftime("%d/%m/%Y %H:%M"),
    }


@app.get("/api/admin/debug-sheets")
def admin_debug_sheets():
    """Lista todas as abas do arquivo Excel e mostra colunas/amostra de cada cidade configurada."""
    local_files = (
        sorted(UPLOAD_DIR.glob("*.xlsx"))
        + sorted(UPLOAD_DIR.glob("*.xls"))
        + sorted(UPLOAD_DIR.glob("*.xlsm"))
    )
    if not local_files:
        raise HTTPException(status_code=400, detail="Nenhum arquivo Excel disponível.")

    arquivo = local_files[-1]

    # Lista todas as abas
    xl = pd.ExcelFile(arquivo)
    abas = xl.sheet_names

    # Testa cada cidade de leads
    leads_debug = {}
    for orig, cfg in CIDADES.items():
        try:
            sheet_real = _resolver_aba(arquivo, cfg["sheet"])
            df = pd.read_excel(arquivo, sheet_name=sheet_real, nrows=5)
            df.columns = [str(c).strip() for c in df.columns]
            df_clean = df.dropna(how="all")
            leads_debug[orig] = {
                "sheet_real": sheet_real,
                "total_linhas": len(df_clean),
                "colunas": list(df.columns),
                "primeiras_linhas": df_clean.head(3).fillna("").astype(str).to_dict(orient="records"),
            }
        except Exception as e:
            leads_debug[orig] = {"sheet_configurado": str(cfg["sheet"]), "erro": str(e)}

    # Testa cada cidade de vendas — mostra início e região do skiprows
    vendas_debug = {}
    for orig, cfg in CIDADES_VENDAS.items():
        try:
            sheet_real = _resolver_aba(arquivo, cfg["sheet"])
            skip = cfg["skiprows"]
            total = pd.read_excel(arquivo, sheet_name=sheet_real, header=None, usecols=[0]).shape[0]
            df_inicio = pd.read_excel(arquivo, sheet_name=sheet_real, header=None,
                                      usecols=[0,1,2,3,4,5], nrows=3)
            df_skip = pd.read_excel(arquivo, sheet_name=sheet_real, header=None,
                                    usecols=[0,1,2,3,4,5], skiprows=skip, nrows=3)
            vendas_debug[orig] = {
                "sheet_real": sheet_real,
                "total_linhas_na_aba": total,
                "skiprows_configurado": skip,
                "linhas_inicio": df_inicio.fillna("").astype(str).values.tolist(),
                "linhas_apos_skip": df_skip.fillna("").astype(str).values.tolist(),
            }
        except Exception as e:
            vendas_debug[orig] = {"sheet_configurado": cfg["sheet"], "erro": str(e)}

    return {
        "arquivo": arquivo.name,
        "abas_no_arquivo": abas,
        "leads": leads_debug,
        "vendas": vendas_debug,
    }


@app.get("/api/admin/debug-cancelamentos")
def admin_debug_cancelamentos():
    """Mostra as primeiras linhas de cada aba de cancelamentos — útil para diagnosticar estrutura."""
    local_files = (
        sorted(UPLOAD_DIR.glob("*.xlsx"))
        + sorted(UPLOAD_DIR.glob("*.xls"))
        + sorted(UPLOAD_DIR.glob("*.xlsm"))
    )
    if not local_files:
        raise HTTPException(status_code=400, detail="Nenhum arquivo Excel disponível.")

    arquivo = local_files[-1]
    xl = pd.ExcelFile(arquivo)
    abas = xl.sheet_names

    resultado = {}
    for orig, cfg in CIDADES_CANCELAMENTOS.items():
        try:
            sheet_real = _resolver_aba(arquivo, cfg["sheet"])
            skip = cfg.get("skiprows", 0)
            total_linhas = pd.read_excel(arquivo, sheet_name=sheet_real, header=None, usecols=[0]).shape[0]

            # Primeiras linhas brutas (sem skiprows) para ver estrutura
            df_bruto = pd.read_excel(arquivo, sheet_name=sheet_real, header=None, nrows=8)
            linhas_brutas = df_bruto.fillna("").astype(str).values.tolist()

            # Com skiprows + header=0 (como o sync faz)
            df_com_skip = pd.read_excel(arquivo, sheet_name=sheet_real, header=0, skiprows=skip, nrows=5)
            df_com_skip.columns = [str(c).strip() for c in df_com_skip.columns]
            valid_cols = [c for c in df_com_skip.columns if not c.startswith("Unnamed")][:6]
            primeiras_linhas = []
            if valid_cols:
                primeiras_linhas = df_com_skip[valid_cols].fillna("").astype(str).to_dict(orient="records")

            resultado[orig] = {
                "sheet_real": sheet_real,
                "total_linhas_na_aba": total_linhas,
                "skiprows_configurado": skip,
                "colunas_detectadas": valid_cols,
                "linhas_brutas_primeiras_8": linhas_brutas,
                "dados_apos_skip_primeiros_5": primeiras_linhas,
            }
        except Exception as e:
            resultado[orig] = {"sheet_configurado": cfg["sheet"], "erro": str(e)}

    return {"arquivo": arquivo.name, "abas_disponiveis": abas, "cancelamentos": resultado}


@app.post("/api/sync")
def sync_planilha(origem: str = "ouro_fino"):
    """Baixa a planilha e insere registros novos no banco para a cidade indicada."""
    if origem not in CIDADES:
        raise HTTPException(status_code=400, detail=f"Origem desconhecida: {origem}")
    _cache.pop(origem, None)
    df = get_dataframe(origem)
    registros = _df_to_rows(df, origem)

    inseridos = 0
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            for row in registros:
                h = _row_hash(row, COLUNAS_EXCEL + ["origem"])
                cur.execute(
                    """
                    INSERT INTO anuncio_ouro_fino
                        (hash, dia, nome, telefone, cidade, bairro, facebook_instagram, resultado, origem)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (hash) DO NOTHING
                    """,
                    (
                        h,
                        row["DIA"],
                        row["NOME"],
                        row["TELEFONE"],
                        row["CIDADE"],
                        row["BAIRRO"],
                        row["FACEBOOK/INSTAGRAM"],
                        row["RESULTADO"],
                        row["origem"],
                    ),
                )
                if cur.rowcount:
                    inseridos += 1
        conn.commit()
    finally:
        conn.close()

    return {
        "message": "Sincronizacao concluida.",
        "origem": origem,
        "lidos": len(registros),
        "inseridos": inseridos,
        "sincronizado_em": datetime.now().isoformat(),
    }


@app.get("/api/dados")
def listar_dados(origem: str = "ouro_fino"):
    """Retorna registros do banco de dados filtrados por cidade."""
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT dia, nome, telefone, cidade, bairro,
                       facebook_instagram AS "FACEBOOK/INSTAGRAM",
                       resultado, importado_em
                FROM anuncio_ouro_fino
                WHERE origem = %s
                ORDER BY id
                """,
                (origem,)
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    colunas = ["dia", "nome", "telefone", "cidade", "bairro", "FACEBOOK/INSTAGRAM", "resultado", "importado_em"]

    registros = []
    for r in rows:
        rec = dict(r)
        if rec.get("importado_em"):
            rec["importado_em"] = rec["importado_em"].strftime("%d/%m/%Y %H:%M")
        registros.append(rec)

    return {
        "colunas": colunas,
        "total": len(registros),
        "registros": registros,
    }


@app.post("/api/upload")
async def upload_planilha(file: UploadFile = File(...)):
    """Recebe upload de planilha Excel, armazena e sincroniza todas as cidades."""
    if not file.filename.endswith((".xlsx", ".xls", ".xlsm")):
        raise HTTPException(status_code=400, detail="Apenas arquivos .xlsx, .xls ou .xlsm sao aceitos.")
    content = await file.read()
    dest = UPLOAD_DIR / file.filename
    dest.write_bytes(content)
    _cache.clear()
    _vendas_cache.clear()
    _canc_cache.clear()
    resultados = {"leads": {}, "vendas": {}, "cancelamentos": {}}
    for origem in CIDADES:
        try:
            resultados["leads"][origem] = sync_planilha(origem=origem)
        except Exception as e:
            resultados["leads"][origem] = {"error": str(e)}
    for origem in CIDADES_VENDAS:
        try:
            resultados["vendas"][origem] = sync_vendas(origem=origem)
        except Exception as e:
            resultados["vendas"][origem] = {"error": str(e)}
    for origem in CIDADES_CANCELAMENTOS:
        try:
            resultados["cancelamentos"][origem] = sync_cancelamentos(origem=origem)
        except Exception as e:
            resultados["cancelamentos"][origem] = {"error": str(e)}
    return resultados


@app.post("/api/sync-vendas")
def sync_vendas(origem: str = "ouro_fino"):
    """Sincroniza vendas da cidade indicada para o banco (incremental)."""
    if origem not in CIDADES_VENDAS:
        raise HTTPException(status_code=400, detail=f"Origem desconhecida: {origem}")
    _vendas_cache.pop(origem, None)
    df = get_vendas_dataframe(origem)
    registros = _vendas_to_rows(df)

    from datetime import timedelta
    um_ano_atras = datetime.now() - timedelta(days=365)

    registros_filtrados = []
    for row in registros:
        raw = row["data"]
        if not raw:
            continue
        dt = _parse_data(raw)
        if dt is None:
            continue
        row["data"] = dt.strftime("%Y-%m-%d")
        row["origem"] = origem
        if dt >= um_ano_atras:
            registros_filtrados.append(row)

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            for row in registros_filtrados:
                h = _row_hash(row, ["nome", "data", "origem"])
                cur.execute(
                    """
                    INSERT INTO vendas_borda_mata
                        (hash, data, nome, instalacao, mes, dia_semana, vendedor, origem)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (hash) DO UPDATE SET
                        instalacao = EXCLUDED.instalacao,
                        mes        = EXCLUDED.mes,
                        dia_semana = EXCLUDED.dia_semana,
                        vendedor   = EXCLUDED.vendedor
                    """,
                    (
                        h,
                        row["data"],
                        row["nome"],
                        row["instalacao"],
                        row["mes"],
                        row["dia_semana"],
                        row["vendedor"],
                        origem,
                    ),
                )
        conn.commit()
    finally:
        conn.close()

    return {
        "message": "Sincronizacao de vendas concluida.",
        "lidos": len(registros),
        "do_ultimo_ano": len(registros_filtrados),
        "inseridos": len(registros_filtrados),
        "sincronizado_em": datetime.now().isoformat(),
    }


@app.get("/api/vendas")
def listar_vendas(origem: str = "ouro_fino"):
    """Retorna registros de vendas do ultimo ano filtrados por cidade."""
    from datetime import timedelta
    um_ano_atras = datetime.now() - timedelta(days=365)

    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, data, nome, instalacao, mes, dia_semana, vendedor, importado_em
                FROM vendas_borda_mata
                WHERE data >= %s AND origem = %s
                ORDER BY data DESC
                """,
                (um_ano_atras.strftime("%Y-%m-%d"), origem)
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    colunas = ["data", "nome", "instalacao", "mes", "dia_semana", "vendedor", "importado_em"]

    registros = []
    for r in rows:
        rec = dict(r)
        if rec.get("importado_em"):
            rec["importado_em"] = rec["importado_em"].strftime("%d/%m/%Y %H:%M")
        registros.append(rec)

    return {
        "colunas": colunas,
        "total": len(registros),
        "registros": registros,
    }


@app.get("/api/resumo-vendas")
def resumo_vendas(origem: str = "ouro_fino"):
    """Retorna resumo de vendas por cidade, com contagem por status de instalação."""
    from datetime import timedelta
    um_ano_atras = datetime.now() - timedelta(days=365)
    data_limite = um_ano_atras.strftime("%Y-%m-%d")

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM vendas_borda_mata WHERE data >= %s AND origem = %s",
                (data_limite, origem)
            )
            total = cur.fetchone()[0]
            cur.execute(
                "SELECT MAX(importado_em) FROM vendas_borda_mata WHERE data >= %s AND origem = %s",
                (data_limite, origem)
            )
            ultima_sync = cur.fetchone()[0]
            cur.execute(
                """SELECT COALESCE(NULLIF(TRIM(instalacao),''), 'Não informado'), COUNT(*)
                   FROM vendas_borda_mata
                   WHERE data >= %s AND origem = %s
                   GROUP BY 1 ORDER BY 2 DESC""",
                (data_limite, origem)
            )
            status_instalacao = [{"status": r[0], "total": r[1]} for r in cur.fetchall()]
    finally:
        conn.close()

    return {
        "total": total,
        "status_instalacao": status_instalacao,
        "ultima_sincronizacao": ultima_sync.isoformat() if ultima_sync else None,
    }


@app.delete("/api/vendas/{venda_id}")
def deletar_venda(venda_id: int):
    """Remove um registro de venda pelo id."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM vendas_borda_mata WHERE id = %s", (venda_id,))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Registro não encontrado.")
        conn.commit()
    finally:
        conn.close()
    return {"message": "Registro removido."}


@app.post("/api/sync-cancelamentos")
def sync_cancelamentos(origem: str = "borda_mata"):
    """Sincroniza cancelamentos da cidade indicada para o banco (incremental)."""
    if origem not in CIDADES_CANCELAMENTOS:
        raise HTTPException(status_code=400, detail=f"Origem desconhecida: {origem}")
    _canc_cache.pop(origem, None)
    try:
        df, headers = get_cancelamentos_dataframe(origem)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    registros_raw = _canc_to_rows(df)

    registros = []
    mes_atual = ""
    HEADER_WORDS = {"cliente", "nome", "motivo", "cancelamento"}

    for row in registros_raw:
        nome_raw = row.get("nome", "").strip()
        nome_lower = nome_raw.lower()

        if not nome_raw:
            continue

        # Linha de título de seção (Borda): nome contém mês em português e motivo é vazio
        mes_encontrado = next(
            (num for pt, num in _MESES_PT.items() if pt in nome_lower),
            None,
        )
        if mes_encontrado and not row.get("motivo", "").strip():
            mes_atual = mes_encontrado
            continue

        # Descarta linhas de cabeçalho repetido (ex: "Cliente", "Motivo do cancelamento")
        if nome_lower.rstrip() in HEADER_WORDS or any(w in nome_lower for w in ("cliente", "motivo do")):
            continue

        # Tenta extrair mês da coluna Retirada (Inconfidentes): "Retirada ok (07/12/23)"
        mes_row = mes_atual
        col_c_val = row.get("col_c", "")
        if not mes_row and col_c_val:
            m = re.search(r'\((\d{1,2})/(\d{2})/(\d{2,4})\)', col_c_val)
            if m:
                mes_row = m.group(2).zfill(2)  # mês é o segundo grupo DD/MM/AAAA

        row["mes"] = mes_row
        row["origem"] = origem
        registros.append(row)

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            inseridos = 0
            for row in registros:
                h = _row_hash(row, ["nome", "motivo", "mes", "origem"])
                cur.execute(
                    """
                    INSERT INTO cancelamentos
                        (hash, nome, motivo, col_c, mes, origem)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (hash) DO UPDATE SET
                        motivo = EXCLUDED.motivo,
                        col_c  = EXCLUDED.col_c,
                        mes    = EXCLUDED.mes
                    """,
                    (h, row["nome"], row["motivo"], row["col_c"],
                     row.get("mes", ""), origem),
                )
                if cur.rowcount:
                    inseridos += 1
            cur.execute(
                """
                INSERT INTO cancelamentos_meta (origem, headers, updated_at)
                VALUES (%s, %s, NOW())
                ON CONFLICT (origem) DO UPDATE SET headers = EXCLUDED.headers, updated_at = NOW()
                """,
                (origem, json.dumps(headers, ensure_ascii=False)),
            )
        conn.commit()
    finally:
        conn.close()

    return {
        "message": "Sincronizacao de cancelamentos concluida.",
        "lidos": len(registros_raw),
        "inseridos": inseridos,
        "headers": headers,
        "sincronizado_em": datetime.now().isoformat(),
    }


@app.get("/api/cancelamentos")
def listar_cancelamentos(origem: str = "borda_mata"):
    """Retorna registros de cancelamentos filtrados por cidade."""
    if origem not in CIDADES_CANCELAMENTOS:
        raise HTTPException(status_code=400, detail=f"Origem desconhecida: {origem}")

    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, nome, motivo, col_c, mes, importado_em
                FROM cancelamentos
                WHERE origem = %s
                ORDER BY mes, nome
                """,
                (origem,)
            )
            rows = cur.fetchall()
            cur.execute("SELECT headers FROM cancelamentos_meta WHERE origem = %s", (origem,))
            meta = cur.fetchone()
            headers = json.loads(meta["headers"]) if meta else []
    finally:
        conn.close()

    registros = []
    for r in rows:
        rec = dict(r)
        if rec.get("importado_em"):
            rec["importado_em"] = rec["importado_em"].strftime("%d/%m/%Y %H:%M")
        registros.append(rec)

    return {
        "colunas": ["nome", "motivo", "col_c", "mes"],
        "headers": headers,
        "total": len(registros),
        "registros": registros,
    }


@app.delete("/api/cancelamentos/{canc_id}")
def deletar_cancelamento(canc_id: int):
    """Remove um registro de cancelamento pelo id."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM cancelamentos WHERE id = %s", (canc_id,))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Registro não encontrado.")
        conn.commit()
    finally:
        conn.close()
    return {"message": "Registro removido."}


@app.get("/api/admin/status")
def admin_status():
    """Retorna contagens por cidade para o painel de administração."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            leads = {}
            for orig, cfg in CIDADES.items():
                cur.execute("SELECT COUNT(*) FROM anuncio_ouro_fino WHERE origem = %s", (orig,))
                leads[orig] = {"label": cfg["label"], "total": cur.fetchone()[0]}
            vendas = {}
            for orig, cfg in CIDADES_VENDAS.items():
                cur.execute("SELECT COUNT(*) FROM vendas_borda_mata WHERE origem = %s", (orig,))
                vendas[orig] = {"label": cfg["label"], "total": cur.fetchone()[0]}
            canc = {}
            for orig, cfg in CIDADES_CANCELAMENTOS.items():
                cur.execute("SELECT COUNT(*) FROM cancelamentos WHERE origem = %s", (orig,))
                canc[orig] = {"label": cfg["label"], "total": cur.fetchone()[0]}
    finally:
        conn.close()
    return {"leads": leads, "vendas": vendas, "cancelamentos": canc}


@app.post("/api/admin/recriar-leads")
def admin_recriar_leads():
    """Apaga e recria a tabela de leads."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DROP TABLE IF EXISTS anuncio_ouro_fino")
            cur.execute("""
                CREATE TABLE anuncio_ouro_fino (
                    id                 SERIAL PRIMARY KEY,
                    hash               CHAR(64) UNIQUE NOT NULL,
                    dia                TEXT,
                    nome               TEXT,
                    telefone           TEXT,
                    cidade             TEXT,
                    bairro             TEXT,
                    facebook_instagram TEXT,
                    resultado          TEXT,
                    origem             TEXT NOT NULL DEFAULT 'ouro_fino',
                    importado_em       TIMESTAMP DEFAULT NOW()
                )
            """)
        conn.commit()
    finally:
        conn.close()
    _cache.clear()
    return {"message": "Tabela de leads recriada com sucesso."}


@app.post("/api/admin/recriar-vendas")
def admin_recriar_vendas():
    """Apaga e recria a tabela de vendas."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DROP TABLE IF EXISTS vendas_borda_mata")
            cur.execute("""
                CREATE TABLE vendas_borda_mata (
                    id           SERIAL PRIMARY KEY,
                    hash         CHAR(64) UNIQUE NOT NULL,
                    data         TEXT,
                    nome         TEXT,
                    instalacao   TEXT,
                    mes          TEXT,
                    dia_semana   TEXT,
                    vendedor     TEXT,
                    origem       TEXT NOT NULL DEFAULT 'borda_mata',
                    importado_em TIMESTAMP DEFAULT NOW()
                )
            """)
        conn.commit()
    finally:
        conn.close()
    _vendas_cache.clear()
    return {"message": "Tabela de vendas recriada com sucesso."}


@app.post("/api/admin/limpar-leads")
def admin_limpar_leads(origem: str):
    """Remove todos os leads de uma cidade específica."""
    if origem not in CIDADES:
        raise HTTPException(status_code=400, detail=f"Origem desconhecida: {origem}")
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM anuncio_ouro_fino WHERE origem = %s", (origem,))
            removidos = cur.rowcount
        conn.commit()
    finally:
        conn.close()
    _cache.pop(origem, None)
    return {"message": f"{removidos} leads de '{CIDADES[origem]['label']}' removidos."}


@app.post("/api/admin/limpar-vendas")
def admin_limpar_vendas(origem: str):
    """Remove todas as vendas de uma cidade específica."""
    if origem not in CIDADES_VENDAS:
        raise HTTPException(status_code=400, detail=f"Origem desconhecida: {origem}")
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM vendas_borda_mata WHERE origem = %s", (origem,))
            removidos = cur.rowcount
        conn.commit()
    finally:
        conn.close()
    _vendas_cache.pop(origem, None)
    return {"message": f"{removidos} vendas de '{CIDADES_VENDAS[origem]['label']}' removidas."}


@app.post("/api/admin/corrigir-origens")
def admin_corrigir_origens():
    """Corrige registros de vendas com origem padrão errada (ouro_fino → borda_mata)."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE vendas_borda_mata SET origem = 'borda_mata'
                WHERE origem = 'ouro_fino'
            """)
            atualizados = cur.rowcount
        conn.commit()
    finally:
        conn.close()
    _vendas_cache.clear()
    return {"message": f"{atualizados} registros de vendas corrigidos para 'borda_mata'."}


# mantido por compatibilidade
@app.post("/api/reset-vendas")
def reset_vendas():
    return admin_recriar_vendas()


@app.get("/api/ixc/cadastros")
def ixc_cadastros(origem: str = "borda_mata", ano: int = None):
    """Retorna cadastros do IXC para a origem e ano, agrupados por mês."""
    if not IXC_TOKEN:
        raise HTTPException(status_code=503, detail="IXC_TOKEN não configurado no servidor.")
    if origem not in IXC_CIDADES:
        raise HTTPException(status_code=400, detail=f"Origem desconhecida: {origem}")
    if ano is None:
        ano = datetime.now().year

    cidade_id = IXC_CIDADES[origem]
    todos = _ixc_fetch_por_ano(ano)

    registros = []
    contagem = [0] * 12
    for c in todos:
        if str(c.get("cidade", "")) != cidade_id:
            continue
        dc = c.get("data_cadastro", "")
        try:
            mes_idx = int(dc[5:7]) - 1
            contagem[mes_idx] += 1
        except (ValueError, IndexError):
            continue
        registros.append({
            "id":            c.get("id"),
            "nome":          (c.get("razao") or c.get("fantasia") or "").strip(),
            "data_cadastro": dc,
            "bairro":        c.get("bairro", ""),
            "fone":          c.get("telefone_celular") or c.get("fone", ""),
            "ativo":         c.get("ativo", ""),
            "status":        c.get("status_prospeccao", ""),
        })

    por_mes = [{"mes": MESES_A[i], "mes_num": i + 1, "total": contagem[i]} for i in range(12)]

    return {
        "total":     len(registros),
        "por_mes":   por_mes,
        "registros": registros,
        "origem":    origem,
        "ano":       ano,
    }


@app.delete("/api/ixc/cache")
def limpar_cache_ixc():
    """Limpa o cache de dados do IXC (força nova busca na próxima chamada)."""
    _ixc_cache.clear()
    return {"message": "Cache do IXC limpo."}


@app.get("/api/ixc/status-sync")
def ixc_status_sync():
    """Retorna status da última sincronização do IXC no banco local."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*), MAX(synced_at), MIN(data_cadastro), MAX(data_cadastro) FROM ixc_clientes")
            row = cur.fetchone()
            cur.execute("SELECT COUNT(*), MAX(synced_at) FROM ixc_os")
            row_os = cur.fetchone()
    finally:
        conn.close()

    return {
        "clientes": {
            "total":          row[0] or 0,
            "ultima_sync":    row[1].isoformat() if row[1] else None,
            "cadastro_min":   str(row[2]) if row[2] else None,
            "cadastro_max":   str(row[3]) if row[3] else None,
        },
        "os": {
            "total":       row_os[0] or 0,
            "ultima_sync": row_os[1].isoformat() if row_os[1] else None,
        },
    }


@app.post("/api/ixc/sync-clientes")
def ixc_sync_clientes():
    """Sincroniza todos os clientes do IXC para o banco local (upsert incremental)."""
    if not IXC_TOKEN:
        raise HTTPException(status_code=503, detail="IXC_TOKEN não configurado.")

    clientes = _ixc_fetch_all_clientes()

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            for c in clientes:
                razao    = (c.get("razao")    or "").strip()
                fantasia = (c.get("fantasia") or "").strip()
                if fantasia and razao and fantasia.lower() not in razao.lower():
                    nome = f"{fantasia} - {razao}"
                else:
                    nome = razao or fantasia
                fone = c.get("telefone_celular") or c.get("fone") or ""
                # Todos os telefones do cadastro, normalizados, p/ classificação por telefone
                fones = ",".join(sorted({
                    hotspot_db.normalizar_fone(c.get(campo))
                    for campo in ("telefone_celular", "fone", "whatsapp", "telefone_comercial")
                    if hotspot_db.normalizar_fone(c.get(campo))
                }))
                dc_raw = (c.get("data_cadastro") or "")[:10]
                dc = dc_raw if dc_raw and dc_raw != "0000-00-00" else None
                cur.execute("""
                    INSERT INTO ixc_clientes
                        (ixc_id, nome, data_cadastro, cidade_ixc_id, bairro, cep, fone, fones, ativo, status_prospeccao, synced_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (ixc_id) DO UPDATE SET
                        nome              = EXCLUDED.nome,
                        data_cadastro     = EXCLUDED.data_cadastro,
                        cidade_ixc_id     = EXCLUDED.cidade_ixc_id,
                        bairro            = EXCLUDED.bairro,
                        cep               = EXCLUDED.cep,
                        fone              = EXCLUDED.fone,
                        fones             = EXCLUDED.fones,
                        ativo             = EXCLUDED.ativo,
                        status_prospeccao = EXCLUDED.status_prospeccao,
                        synced_at         = NOW()
                """, (
                    int(c.get("id", 0)),
                    nome,
                    dc,
                    str(c.get("cidade", "")),
                    c.get("bairro", ""),
                    c.get("cep", ""),
                    fone,
                    fones,
                    c.get("ativo", ""),
                    c.get("status_prospeccao", ""),
                ))
        conn.commit()
    finally:
        conn.close()

    return {
        "message": f"Sincronizados {len(clientes)} clientes do IXC.",
        "total": len(clientes),
        "synced_at": datetime.now().isoformat(),
    }


@app.post("/api/ixc/sync-os")
def ixc_sync_os(ano: int = None):
    """Sincroniza Ordens de Serviço do IXC para o banco local."""
    if not IXC_TOKEN:
        raise HTTPException(status_code=503, detail="IXC_TOKEN não configurado.")
    if ano is None:
        ano = datetime.now().year

    data_inicio = f"{ano}-01-01"
    data_fim    = f"{ano}-12-31"

    os_list = _ixc_fetch_os(data_inicio, data_fim)

    def _safe_dt(v):
        s = (v or "")[:19]
        return s if s and not s.startswith("0000") else None

    def _int_or_none(v):
        try:
            n = int(v or 0)
            return n if n else None
        except (ValueError, TypeError):
            return None

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            for o in os_list:
                assunto_id  = str(o.get("id_assunto") or "")
                assunto_nome = IXC_ASSUNTOS.get(assunto_id, o.get("assunto") or "")
                cur.execute("""
                    INSERT INTO ixc_os
                        (ixc_os_id, protocolo, id_cliente, id_assunto, id_login, id_cidade,
                         assunto, tipo_chamado, status,
                         data_abertura, data_fechamento, mensagem, bairro, synced_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (ixc_os_id) DO UPDATE SET
                        protocolo       = EXCLUDED.protocolo,
                        id_cliente      = EXCLUDED.id_cliente,
                        id_assunto      = EXCLUDED.id_assunto,
                        id_login        = EXCLUDED.id_login,
                        id_cidade       = EXCLUDED.id_cidade,
                        assunto         = EXCLUDED.assunto,
                        tipo_chamado    = EXCLUDED.tipo_chamado,
                        status          = EXCLUDED.status,
                        data_abertura   = EXCLUDED.data_abertura,
                        data_fechamento = EXCLUDED.data_fechamento,
                        mensagem        = EXCLUDED.mensagem,
                        bairro          = EXCLUDED.bairro,
                        synced_at       = NOW()
                """, (
                    int(o.get("id", 0)),
                    o.get("protocolo", ""),
                    _int_or_none(o.get("id_cliente")),
                    _int_or_none(o.get("id_assunto")),
                    _int_or_none(o.get("id_login")),
                    str(o.get("id_cidade") or ""),
                    assunto_nome,
                    o.get("tipo", ""),
                    o.get("status", ""),
                    _safe_dt(o.get("data_abertura")),
                    _safe_dt(o.get("data_fechamento")),
                    (o.get("mensagem") or "")[:500],
                    o.get("bairro", ""),
                ))
        conn.commit()
    finally:
        conn.close()

    return {
        "message": f"Sincronizadas {len(os_list)} OS do IXC para {ano}.",
        "total": len(os_list),
        "synced_at": datetime.now().isoformat(),
    }


@app.get("/api/ixc/os")
def ixc_listar_os(ano: int = None, status: str = None):
    """Lista OS do banco local com filtros opcionais."""
    if ano is None:
        ano = datetime.now().year
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            filtros = [f"data_abertura >= '{ano}-01-01'", f"data_abertura < '{ano+1}-01-01'"]
            if status:
                filtros.append(f"status = '{status}'")
            where = " AND ".join(filtros)
            cur.execute(f"""
                SELECT ixc_os_id, protocolo, id_cliente, assunto, tipo_chamado,
                       status, data_abertura, data_fechamento
                FROM ixc_os
                WHERE {where}
                ORDER BY data_abertura DESC
            """)
            rows = [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()

    for r in rows:
        if r.get("data_abertura"):
            r["data_abertura"] = r["data_abertura"].strftime("%Y-%m-%d %H:%M")
        if r.get("data_fechamento"):
            r["data_fechamento"] = r["data_fechamento"].strftime("%Y-%m-%d %H:%M")

    return {"total": len(rows), "registros": rows, "ano": ano}


def _norm_nome(nome: str) -> str:
    """Normaliza nome para comparação: minúsculo, sem acentos, sem pontuação, espaços simples."""
    nome = unicodedata.normalize("NFD", (nome or "").lower().strip())
    nome = "".join(c for c in nome if unicodedata.category(c) != "Mn")
    nome = re.sub(r"[^a-z0-9 ]", "", nome)
    return re.sub(r"\s+", " ", nome).strip()


def _similaridade(a: str, b: str) -> float:
    """Retorna similaridade 0-1 entre dois nomes já normalizados."""
    return SequenceMatcher(None, a, b).ratio()


def _melhor_match(nome_norm: str, candidatos: dict, threshold: float) -> tuple[str | None, float]:
    """
    Busca o candidato mais similar acima do threshold.
    candidatos: {nome_norm: dado_original}
    Retorna (chave_encontrada, similaridade) ou (None, 0.0).
    """
    if nome_norm in candidatos:
        return nome_norm, 1.0
    # get_close_matches usa SequenceMatcher internamente e é mais eficiente
    hits = get_close_matches(nome_norm, candidatos.keys(), n=1, cutoff=threshold)
    if hits:
        return hits[0], _similaridade(nome_norm, hits[0])
    return None, 0.0


@app.get("/api/ixc/analise")
def ixc_analise(origem: str = "borda_mata", ano: int = None, mes: int = None, similaridade: float = 0.82):
    """
    Análise aprofundada usando banco local de clientes IXC com fuzzy matching.
    Requer que /api/ixc/sync-clientes tenha sido executado antes.

    similaridade: threshold de 0.0 a 1.0 para correspondência de nomes (default 0.82)

    Classifica cada entrada da planilha:
    - matched:       encontrado no IXC no mesmo ano (dentro do threshold)
    - segundo_ponto: cliente existia no IXC em outro ano (instalação extra / segundo ponto)
    - sem_ixc:       não encontrado no IXC em nenhum ano acima do threshold
    """
    if origem not in IXC_CIDADES:
        raise HTTPException(status_code=400, detail=f"Origem desconhecida: {origem}")
    if ano is None:
        ano = datetime.now().year
    if mes is not None:
        mes = max(1, min(12, mes))
        if mes == 12:
            data_inicio = f"{ano}-12-01"
            data_fim    = f"{ano+1}-01-01"
        else:
            data_inicio = f"{ano}-{mes:02d}-01"
            data_fim    = f"{ano}-{mes+1:02d}-01"
    else:
        data_inicio = f"{ano}-01-01"
        data_fim    = f"{ano+1}-01-01"
    similaridade = max(0.0, min(1.0, similaridade))

    cidade_id = IXC_CIDADES[origem]

    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT ixc_id, nome, data_cadastro, cidade_ixc_id, bairro, fone, ativo, status_prospeccao
                FROM ixc_clientes
                ORDER BY data_cadastro
            """)
            todos_ixc = [dict(r) for r in cur.fetchall()]

            cur.execute("""
                SELECT ixc_id, nome, data_cadastro, bairro, fone, ativo, status_prospeccao
                FROM ixc_clientes
                WHERE cidade_ixc_id = %s
                  AND data_cadastro >= %s AND data_cadastro < %s
                ORDER BY data_cadastro
            """, (cidade_id, data_inicio, data_fim))
            ixc_do_ano = [dict(r) for r in cur.fetchall()]

            cur.execute("""
                SELECT id, data, nome, instalacao, vendedor
                FROM vendas_borda_mata
                WHERE data >= %s AND data < %s AND origem = %s
                ORDER BY data
            """, (data_inicio, data_fim, origem))
            planilha_rows = [dict(r) for r in cur.fetchall()]

            cur.execute("""
                SELECT DISTINCT id_cliente
                FROM ixc_os
                WHERE id_assunto = ANY(%s)
                  AND data_abertura >= %s AND data_abertura < %s
                  AND id_cidade = %s
            """, ([1, 18], data_inicio, data_fim, cidade_id))
            ids_instalacao_periodo = {r["id_cliente"] for r in cur.fetchall()}

            cur.execute(
                "SELECT MAX(synced_at) AS s FROM ixc_clientes WHERE cidade_ixc_id = %s",
                (cidade_id,)
            )
            last_sync = cur.fetchone()["s"]
    finally:
        conn.close()

    # Mapas nome_norm → registro para lookup fuzzy
    ixc_do_ano_map: dict = {}
    for r in ixc_do_ano:
        n = _norm_nome(r["nome"])
        if n and n not in ixc_do_ano_map:
            ixc_do_ano_map[n] = r

    todos_ixc_map: dict = {}
    for r in todos_ixc:
        n = _norm_nome(r["nome"])
        if n and n not in todos_ixc_map:
            todos_ixc_map[n] = r

    matched = []
    segundo_ponto = []
    sem_ixc = []

    for row in planilha_rows:
        n = _norm_nome(row.get("nome", ""))
        if not n:
            continue

        # Tenta achar no IXC do ano (com fuzzy)
        chave_ano, sim_ano = _melhor_match(n, ixc_do_ano_map, similaridade)
        if chave_ano:
            matched.append({**row, "_sim": round(sim_ano, 2)})
            continue

        # Tenta achar em qualquer período (segundo ponto confirmado via OS, ou cliente antigo)
        chave_todos, sim_todos = _melhor_match(n, todos_ixc_map, similaridade)
        if chave_todos:
            ixc_ref = todos_ixc_map[chave_todos]
            ixc_id  = ixc_ref.get("ixc_id")
            dc      = ixc_ref.get("data_cadastro")
            if ixc_id in ids_instalacao_periodo:
                # OS de instalação no período confirma segundo ponto real
                segundo_ponto.append({
                    **row,
                    "_sim":              round(sim_todos, 2),
                    "_nome_ixc":         ixc_ref.get("nome", ""),
                    "ixc_id":            ixc_id,
                    "ixc_data_cadastro": str(dc) if dc else "",
                    "ixc_ano_cadastro":  str(dc)[:4] if dc else "?",
                    "ixc_ativo":         ixc_ref.get("ativo", ""),
                })
            else:
                # Cliente antigo sem nova instalação confirmada no período
                sem_ixc.append({
                    **row,
                    "_ixc_id":            ixc_id,
                    "_ixc_data_cadastro": str(dc) if dc else "",
                    "_ixc_ativo":         ixc_ref.get("ativo", ""),
                })
        else:
            sem_ixc.append(row)

    # Clientes IXC do ano sem correspondência na planilha (fuzzy)
    nomes_planilha_map = {
        _norm_nome(r["nome"]): r for r in planilha_rows if r.get("nome")
    }
    so_ixc = []
    for r in ixc_do_ano:
        n = _norm_nome(r["nome"])
        chave, sim = _melhor_match(n, nomes_planilha_map, similaridade)
        if not chave:
            so_ixc.append({
                **r,
                "data_cadastro": str(r["data_cadastro"]) if r.get("data_cadastro") else "",
            })

    # Buscar OS para clientes divergentes
    ids_foco = list({r["ixc_id"] for r in so_ixc if r.get("ixc_id")}
                  | {r["ixc_id"] for r in segundo_ponto if r.get("ixc_id")}
                  | {r["_ixc_id"] for r in sem_ixc if r.get("_ixc_id")})

    os_por_cliente: dict = {}
    if ids_foco:
        conn2 = get_conn()
        try:
            with conn2.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("""
                    SELECT id_cliente, ixc_os_id, protocolo, tipo_chamado, status,
                           to_char(data_abertura,  'YYYY-MM-DD') AS data_abertura,
                           to_char(data_fechamento, 'YYYY-MM-DD') AS data_fechamento
                    FROM ixc_os
                    WHERE id_cliente = ANY(%s)
                    ORDER BY data_abertura
                """, (ids_foco,))
                for o in cur.fetchall():
                    os_por_cliente.setdefault(o["id_cliente"], []).append(dict(o))
        finally:
            conn2.close()

    for r in so_ixc:
        r["os"] = os_por_cliente.get(r.get("ixc_id"), [])
    for r in segundo_ponto:
        r["os"] = os_por_cliente.get(r.get("ixc_id"), [])
    for r in sem_ixc:
        if r.get("_ixc_id"):
            r["_os"] = os_por_cliente.get(r["_ixc_id"], [])

    return {
        "origem":          origem,
        "ano":             ano,
        "mes":             mes,
        "similaridade":    similaridade,
        "last_sync_ixc":  last_sync.isoformat() if last_sync else None,
        "sem_sync":        len(todos_ixc) == 0,
        "total_ixc_ano":              len(ixc_do_ano),
        "total_novas_instalacoes_ixc": len(ixc_do_ano) + len(segundo_ponto),
        "total_planilha":             len(planilha_rows),
        "total_matched":              len(matched),
        "so_ixc":         so_ixc,
        "segundo_ponto":  segundo_ponto,
        "sem_ixc":        sem_ixc,
    }


@app.get("/api/ixc/buscar-cliente")
def ixc_buscar_cliente(nome: str, similaridade: float = 0.70):
    """
    Busca um cliente pelo nome (fuzzy) no banco local IXC e retorna:
    - Todos os registros IXC que batem acima do threshold
    - OS de cada cliente encontrado
    - Entradas correspondentes na planilha (todas as origens)
    Útil para investigar clientes com múltiplas conexões (ex: TrustIT).
    """
    if not nome or not nome.strip():
        raise HTTPException(status_code=400, detail="Parâmetro 'nome' obrigatório.")
    similaridade = max(0.0, min(1.0, similaridade))
    nome_norm = _norm_nome(nome)

    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # Todos os clientes IXC do banco local
            cur.execute("""
                SELECT ixc_id, nome, data_cadastro, cidade_ixc_id,
                       bairro, cep, fone, ativo, status_prospeccao
                FROM ixc_clientes
                ORDER BY data_cadastro
            """)
            todos_ixc = [dict(r) for r in cur.fetchall()]

            # Planilha: todas as origens para cruzar por nome
            cur.execute("""
                SELECT data, nome, instalacao, vendedor, origem
                FROM vendas_borda_mata
                ORDER BY data
            """)
            planilha_rows = [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()

    # Filtra clientes IXC com similaridade acima do threshold
    clientes_match = []
    for c in todos_ixc:
        n = _norm_nome(c["nome"])
        sim = _similaridade(nome_norm, n)
        if sim >= similaridade:
            dc = c.get("data_cadastro")
            clientes_match.append({
                **c,
                "data_cadastro": str(dc) if dc else "",
                "_sim": round(sim, 2),
            })
    clientes_match.sort(key=lambda x: -x["_sim"])

    # Busca OS para todos os clientes encontrados
    ids_match = [c["ixc_id"] for c in clientes_match]
    os_por_cliente: dict = {}
    if ids_match:
        conn2 = get_conn()
        try:
            with conn2.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("""
                    SELECT id_cliente, ixc_os_id, protocolo, tipo_chamado, status,
                           to_char(data_abertura,  'YYYY-MM-DD') AS data_abertura,
                           to_char(data_fechamento, 'YYYY-MM-DD') AS data_fechamento
                    FROM ixc_os
                    WHERE id_cliente = ANY(%s)
                    ORDER BY data_abertura
                """, (ids_match,))
                for o in cur.fetchall():
                    os_por_cliente.setdefault(o["id_cliente"], []).append(dict(o))
        finally:
            conn2.close()

    for c in clientes_match:
        c["os"] = os_por_cliente.get(c["ixc_id"], [])

    # Entradas na planilha que batem por nome (fuzzy)
    planilha_match = []
    for row in planilha_rows:
        n = _norm_nome(row.get("nome", ""))
        sim = _similaridade(nome_norm, n)
        if sim >= similaridade:
            planilha_match.append({**row, "_sim": round(sim, 2)})
    planilha_match.sort(key=lambda x: (-x["_sim"], x.get("data", "")))

    return {
        "busca":           nome,
        "nome_norm":       nome_norm,
        "similaridade":    similaridade,
        "clientes_ixc":   clientes_match,
        "total_ixc":      len(clientes_match),
        "planilha":       planilha_match,
        "total_planilha": len(planilha_match),
    }


@app.get("/api/ixc/debug-os")
def ixc_debug_os(pagina: int = 1, rp: int = 3):
    """
    Busca OS diretamente da API IXC e retorna os campos crus de uma amostra.
    Use para descobrir quais campos indicam o tipo/categoria da OS.
    """
    if not IXC_TOKEN:
        raise HTTPException(status_code=503, detail="IXC_TOKEN não configurado.")
    payload = {
        "qtype": "id", "query": "1", "oper": ">=",
        "page": pagina, "rp": rp,
        "sortname": "id", "sortorder": "desc",
    }
    try:
        resp = requests.post(
            f"{IXC_BASE}/su_oss_chamado",
            data=json.dumps(payload),
            headers=_ixc_headers(),
            timeout=30,
            verify=True,
        )
        data = resp.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    registros = data.get("registros", [])
    total = data.get("total", 0)

    # Para cada registro, lista todos os campos não-vazios e seus valores
    amostra = []
    for r in registros:
        campos = {k: v for k, v in r.items() if v not in (None, "", "0", 0)}
        amostra.append({"todos_campos": r, "campos_preenchidos": campos})

    # Lista de todos os campos distintos vistos
    todos_campos = set()
    for r in registros:
        todos_campos.update(r.keys())

    return {
        "total_api":       total,
        "campos_disponiveis": sorted(todos_campos),
        "amostra":         amostra,
    }


@app.get("/api/ixc/os-tipos")
def ixc_os_tipos():
    """Retorna tipos de OS existentes no banco local com contagem — útil para saber quais filtrar."""
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT tipo_chamado, status, COUNT(*) AS total
                FROM ixc_os
                GROUP BY tipo_chamado, status
                ORDER BY total DESC
            """)
            rows = [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()
    return {"tipos": rows, "total_os": sum(r["total"] for r in rows)}


@app.get("/api/ixc/analise-os")
def ixc_analise_os(ano: int = None, cidade: str = None):
    """
    Análise completa das OS do IXC para o ano informado, agrupadas por assunto real.
    Requer sync-os executado. Junta com ixc_clientes para trazer nome do cliente.
    """
    if ano is None:
        ano = datetime.now().year

    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            filtro_cidade = ""
            params: list = [ano]
            if cidade and cidade in IXC_CIDADES:
                filtro_cidade = "AND o.id_cidade = %s"
                params.append(IXC_CIDADES[cidade])

            cur.execute(f"""
                SELECT
                    o.ixc_os_id,
                    o.protocolo,
                    o.id_cliente,
                    o.id_assunto,
                    o.id_login,
                    o.id_cidade,
                    o.assunto,
                    o.status,
                    o.mensagem,
                    o.bairro,
                    to_char(o.data_abertura,  'YYYY-MM-DD') AS data_abertura,
                    to_char(o.data_fechamento,'YYYY-MM-DD') AS data_fechamento,
                    EXTRACT(MONTH FROM o.data_abertura)::int AS mes_num,
                    c.nome   AS nome_cliente,
                    c.ativo  AS cliente_ativo
                FROM ixc_os o
                LEFT JOIN ixc_clientes c ON c.ixc_id = o.id_cliente
                WHERE EXTRACT(YEAR FROM o.data_abertura) = %s {filtro_cidade}
                ORDER BY o.data_abertura DESC
            """, params)
            registros = [dict(r) for r in cur.fetchall()]

            cur.execute("SELECT COUNT(*) AS n FROM ixc_os")
            total_banco = cur.fetchone()["n"]
    finally:
        conn.close()

    # Determina grupo para cada OS
    def _grupo(id_assunto):
        s = str(id_assunto or "")
        for grp, ids in IXC_GRUPOS_ASSUNTO.items():
            if s in ids:
                return grp
        return "Outros"

    for r in registros:
        r["assunto_nome"] = IXC_ASSUNTOS.get(str(r.get("id_assunto") or ""), r.get("assunto") or "Sem assunto")
        r["grupo"]        = _grupo(r.get("id_assunto"))

    # Agrupamento por assunto
    assuntos_map: dict = {}
    for r in registros:
        chave = r["assunto_nome"]
        if chave not in assuntos_map:
            assuntos_map[chave] = {
                "assunto":  chave,
                "grupo":    r["grupo"],
                "id_assunto": r.get("id_assunto"),
                "total": 0, "abertas": 0, "fechadas": 0,
                "por_mes": [0] * 12,
            }
        assuntos_map[chave]["total"] += 1
        if (r["status"] or "").upper() in ("F", "FECHADO", "CONCLUIDO", "FINALIZADO"):
            assuntos_map[chave]["fechadas"] += 1
        else:
            assuntos_map[chave]["abertas"] += 1
        mes_idx = (r["mes_num"] or 1) - 1
        if 0 <= mes_idx < 12:
            assuntos_map[chave]["por_mes"][mes_idx] += 1

    assuntos = sorted(assuntos_map.values(), key=lambda x: -x["total"])

    # Agrupamento por grupo
    grupos_map: dict = {}
    for a in assuntos:
        g = a["grupo"]
        if g not in grupos_map:
            grupos_map[g] = {"grupo": g, "total": 0, "abertas": 0, "fechadas": 0, "por_mes": [0] * 12}
        grupos_map[g]["total"]   += a["total"]
        grupos_map[g]["abertas"] += a["abertas"]
        grupos_map[g]["fechadas"] += a["fechadas"]
        for i in range(12):
            grupos_map[g]["por_mes"][i] += a["por_mes"][i]

    grupos = sorted(grupos_map.values(), key=lambda x: -x["total"])

    # Breakdown mensal por grupo
    por_mes = []
    for i, mes in enumerate(MESES_A):
        entry: dict = {"mes": mes, "mes_num": i + 1, "total": 0}
        for g in grupos:
            entry[g["grupo"]] = g["por_mes"][i]
            entry["total"]   += g["por_mes"][i]
        por_mes.append(entry)

    return {
        "ano":         ano,
        "cidade":      cidade,
        "total":       len(registros),
        "total_banco": total_banco,
        "sem_sync":    total_banco == 0,
        "grupos":      grupos,
        "assuntos":    assuntos,
        "por_mes":     por_mes,
        "registros":   registros,
    }


@app.post("/api/ixc/sync-contratos")
def ixc_sync_contratos(meses: int = 0):
    """Sincroniza cliente_contrato do IXC. Requer sync-clientes executado.

    Por padrão (meses=0) traz a base COMPLETA de contratos — necessário para
    classificar ex-clientes antigos pelo telefone. Passe meses=N para uma
    janela incremental por data_ativacao.
    """
    if not IXC_TOKEN:
        raise HTTPException(status_code=503, detail="IXC_TOKEN não configurado.")

    from datetime import timedelta
    data_inicio = (datetime.now() - timedelta(days=30 * meses)).strftime("%Y-%m-%d") if meses else None

    contratos = _ixc_fetch_contratos(data_inicio)

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            # Mapa ixc_id → cidade_ixc_id a partir dos clientes já sincronizados
            cur.execute("SELECT ixc_id, cidade_ixc_id FROM ixc_clientes")
            cidade_map = {r[0]: r[1] for r in cur.fetchall()}

            inseridos = atualizados = 0
            for c in contratos:
                da_raw = (c.get("data_ativacao") or "")[:10]
                if not da_raw or da_raw.startswith("0000"):
                    continue
                try:
                    id_contrato = int(c.get("id", 0))
                    id_cliente  = int(c.get("id_cliente") or 0) or None
                except (ValueError, TypeError):
                    continue
                cidade_id = cidade_map.get(id_cliente)
                cur.execute("""
                    INSERT INTO ixc_contratos
                        (ixc_contrato_id, id_cliente, data_ativacao, status, cidade_ixc_id, synced_at)
                    VALUES (%s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (ixc_contrato_id) DO UPDATE SET
                        id_cliente    = EXCLUDED.id_cliente,
                        data_ativacao = EXCLUDED.data_ativacao,
                        status        = EXCLUDED.status,
                        cidade_ixc_id = EXCLUDED.cidade_ixc_id,
                        synced_at     = NOW()
                """, (id_contrato, id_cliente, da_raw, c.get("status", ""), cidade_id))
                if cur.rowcount == 1:
                    inseridos += 1
                else:
                    atualizados += 1
        conn.commit()
    finally:
        conn.close()

    return {
        "message":    f"Sincronizados {len(contratos)} contratos do IXC.",
        "total":      len(contratos),
        "inseridos":  inseridos,
        "atualizados": atualizados,
        "synced_at":  datetime.now().isoformat(),
    }


@app.get("/api/ixc/debug-contratos")
def ixc_debug_contratos(pagina: int = 1, rp: int = 3):
    """Retorna campos crus de cliente_contrato — útil para inspecionar a estrutura da API IXC."""
    if not IXC_TOKEN:
        raise HTTPException(status_code=503, detail="IXC_TOKEN não configurado.")
    payload = {
        "qtype": "id", "query": "1", "oper": ">=",
        "page": pagina, "rp": rp,
        "sortname": "id", "sortorder": "desc",
    }
    try:
        resp = requests.post(
            f"{IXC_BASE}/cliente_contrato",
            data=json.dumps(payload),
            headers=_ixc_headers(),
            timeout=30,
            verify=True,
        )
        data = resp.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    registros = data.get("registros", [])
    todos_campos = set()
    for r in registros:
        todos_campos.update(r.keys())

    return {
        "total_api":          data.get("total", 0),
        "campos_disponiveis": sorted(todos_campos),
        "amostra":            registros,
    }


@app.post("/api/ixc/sync-logins")
def ixc_sync_logins(meses: int = 14):
    """Sincroniza radusuarios do IXC usando ultima_atualizacao. Requer sync-clientes executado antes."""
    if not IXC_TOKEN:
        raise HTTPException(status_code=503, detail="IXC_TOKEN não configurado.")

    from datetime import timedelta
    data_inicio = (datetime.now() - timedelta(days=30 * meses)).strftime("%Y-%m-%d")

    logins = _ixc_fetch_logins(data_inicio)

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT ixc_id, cidade_ixc_id FROM ixc_clientes")
            cidade_map = {r[0]: r[1] for r in cur.fetchall()}

            inseridos = atualizados = 0
            for lg in logins:
                # ultima_atualizacao é setado como CURRENT_TIMESTAMP na criação do registro
                dc_raw = (lg.get("ultima_atualizacao") or "")[:10]
                if not dc_raw or dc_raw.startswith("0000"):
                    continue
                try:
                    ixc_login_id = int(lg.get("id", 0))
                    id_cliente   = int(lg.get("id_cliente") or 0) or None
                    id_contrato  = int(lg.get("id_contrato") or 0) or None
                except (ValueError, TypeError):
                    continue
                cidade_id = cidade_map.get(id_cliente)
                cur.execute("""
                    INSERT INTO ixc_logins
                        (ixc_login_id, id_cliente, id_contrato, login, data_criacao, ativo, cidade_ixc_id, synced_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (ixc_login_id) DO UPDATE SET
                        id_cliente    = EXCLUDED.id_cliente,
                        id_contrato   = EXCLUDED.id_contrato,
                        login         = EXCLUDED.login,
                        ativo         = EXCLUDED.ativo,
                        cidade_ixc_id = EXCLUDED.cidade_ixc_id,
                        synced_at     = NOW()
                    -- data_criacao NÃO é atualizada: preserva a data da primeira inserção (criação real)
                """, (
                    ixc_login_id, id_cliente, id_contrato,
                    lg.get("login", ""),
                    dc_raw,
                    (lg.get("ativo") or "S")[:1],
                    cidade_id,
                ))
                if cur.rowcount == 1:
                    inseridos += 1
                else:
                    atualizados += 1
        conn.commit()
    finally:
        conn.close()

    return {
        "message":    f"Sincronizados {len(logins)} logins do IXC.",
        "total":      len(logins),
        "inseridos":  inseridos,
        "atualizados": atualizados,
        "synced_at":  datetime.now().isoformat(),
    }


@app.get("/api/ixc/debug-logins")
def ixc_debug_logins(pagina: int = 1, rp: int = 3):
    """Retorna campos crus de radusuarios — endpoint de logins PPPoE do IXC."""
    if not IXC_TOKEN:
        raise HTTPException(status_code=503, detail="IXC_TOKEN não configurado.")
    payload = {
        "qtype": "radusuarios.id", "query": "1", "oper": ">=",
        "page": pagina, "rp": rp,
        "sortname": "radusuarios.id", "sortorder": "desc",
    }
    try:
        resp = requests.post(
            f"{IXC_BASE}/radusuarios",
            data=json.dumps(payload),
            headers=_ixc_headers(),
            timeout=30,
            verify=True,
        )
        data = resp.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    registros = data.get("registros", [])
    todos_campos = set()
    for r in registros:
        todos_campos.update(r.keys())

    return {
        "total_api":          data.get("total", 0),
        "ixc_type":           data.get("type", "ok"),
        "ixc_message":        data.get("message", ""),
        "campos_disponiveis": sorted(todos_campos),
        "amostra":            registros,
    }


@app.get("/api/ixc/debug-cancelamentos")
def ixc_debug_cancelamentos(origem: str = "borda_mata"):
    """Lista assuntos e status distintos das OS de cancelamento — para calibrar filtros."""
    if origem not in IXC_CIDADES:
        raise HTTPException(status_code=400, detail=f"Origem desconhecida: {origem}")
    cidade_id = IXC_CIDADES[origem]
    ids_canc  = [int(x) for x in IXC_GRUPOS_ASSUNTO["Cancelamento"]]
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT o.assunto, o.status, COUNT(*) AS total
                FROM ixc_os o
                WHERE o.id_cidade = %s AND o.id_assunto = ANY(%s)
                GROUP BY o.assunto, o.status
                ORDER BY o.assunto, o.status
            """, (cidade_id, ids_canc))
            return {"por_assunto_status": [dict(r) for r in cur.fetchall()]}
    finally:
        conn.close()


@app.get("/api/ixc/cancelamentos-ixc")
def ixc_cancelamentos_ixc(origem: str = "borda_mata"):
    """Retorna cancelamentos IXC por cidade (OS id=26, status F), incluindo registros manuais.

    origem='todas' agrega as três cidades (visão da empresa).
    """
    if origem == "todas":
        cidade_ids = list(IXC_CIDADES.values())
    elif origem in IXC_CIDADES:
        cidade_ids = [IXC_CIDADES[origem]]
    else:
        raise HTTPException(status_code=400, detail=f"Origem desconhecida: {origem}")

    ID_REVERSAO_CANCELAMENTO = 26

    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT * FROM (
                    SELECT
                        o.ixc_os_id        AS source_id,
                        FALSE              AS manual,
                        o.id_assunto,
                        o.assunto,
                        o.status,
                        to_char(o.data_abertura,   'YYYY-MM-DD') AS data_abertura,
                        to_char(o.data_fechamento, 'YYYY-MM-DD') AS data_fechamento,
                        cl.nome,
                        cl.bairro,
                        cl.fone
                    FROM ixc_os o
                    LEFT JOIN ixc_clientes cl ON cl.ixc_id = o.id_cliente
                    WHERE o.id_cidade = ANY(%s)
                      AND o.id_assunto = %s
                      AND o.status = 'F'
                      AND NOT EXISTS (
                          SELECT 1 FROM ixc_registros_ocultos oc
                          WHERE oc.tipo = 'os' AND oc.source_id = o.ixc_os_id
                      )

                    UNION ALL

                    SELECT
                        id                 AS source_id,
                        TRUE               AS manual,
                        NULL               AS id_assunto,
                        'Manual'           AS assunto,
                        'F'                AS status,
                        to_char(data_abertura, 'YYYY-MM-DD') AS data_abertura,
                        NULL               AS data_fechamento,
                        nome,
                        bairro,
                        fone
                    FROM cancelamentos_manuais
                    WHERE cidade_ixc_id = ANY(%s)
                ) t
                ORDER BY data_abertura DESC
            """, (cidade_ids, ID_REVERSAO_CANCELAMENTO, cidade_ids))
            rows = [dict(r) for r in cur.fetchall()]

            por_assunto: dict = {}
            for r in rows:
                a = r.get("assunto") or "Sem assunto"
                por_assunto[a] = por_assunto.get(a, 0) + 1
            breakdown = sorted(
                [{"assunto": k, "total": v} for k, v in por_assunto.items()],
                key=lambda x: -x["total"]
            )

            cur.execute(
                "SELECT MAX(synced_at) AS ts FROM ixc_os WHERE id_cidade = ANY(%s) AND id_assunto = %s",
                (cidade_ids, ID_REVERSAO_CANCELAMENTO)
            )
            last_sync_row = cur.fetchone()
            last_sync = last_sync_row["ts"] if last_sync_row else None
    finally:
        conn.close()

    return {
        "total":     len(rows),
        "registros": rows,
        "breakdown": breakdown,
        "origem":    origem,
        "last_sync": last_sync.isoformat() if last_sync else None,
        "sem_sync":  len(rows) == 0 and last_sync is None,
    }


@app.delete("/api/ixc/registros-ixc/{tipo}/{source_id}")
def ocultar_registro_ixc(tipo: str, source_id: int, nome: str = "", motivo: str = ""):
    """Oculta da dashboard um registro vindo do IXC (contrato ou OS de cancelamento).

    O registro continua existindo no espelho local e no IXC; ele apenas sai da
    lista e das estatísticas, e o sync não o traz de volta.
    """
    if tipo not in ("contrato", "os"):
        raise HTTPException(status_code=400, detail="Tipo inválido (use 'contrato' ou 'os').")
    if not motivo.strip():
        raise HTTPException(status_code=400, detail="Informe o motivo da remoção.")

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO ixc_registros_ocultos (tipo, source_id, nome, motivo)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (tipo, source_id) DO NOTHING
            """, (tipo, source_id, nome or "", motivo.strip()))
        conn.commit()
    finally:
        conn.close()
    return {"message": "Registro ocultado da lista."}


@app.post("/api/ixc/registros-ixc/{tipo}/{source_id}/validar")
def validar_registro_ixc(tipo: str, source_id: int, nome: str = "", motivo: str = ""):
    """Valida manualmente um registro do IXC como nova instalação.

    Passa por cima da regra automática (cadastro novo + OS de instalação):
    o registro sobe para a lista de novos contratos e conta nas estatísticas.
    """
    if tipo not in ("contrato", "os"):
        raise HTTPException(status_code=400, detail="Tipo inválido (use 'contrato' ou 'os').")
    if not motivo.strip():
        raise HTTPException(status_code=400, detail="Informe o motivo da validação.")

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO ixc_registros_validados (tipo, source_id, nome, motivo)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (tipo, source_id) DO NOTHING
            """, (tipo, source_id, nome or "", motivo.strip()))
        conn.commit()
    finally:
        conn.close()
    return {"message": "Registro validado como nova instalação."}


@app.get("/api/ixc/ajustes-manuais")
def ixc_ajustes_manuais(origem: str = "todas"):
    """Trilha de auditoria dos ajustes manuais da dashboard:
    registros ocultados, validados como instalação e inseridos manualmente.

    origem filtra por cidade; 'todas' mostra tudo. Registros sem cidade
    identificável (ex.: fora do espelho local) aparecem em qualquer filtro.
    """
    if origem == "todas":
        cidade_ids = None
    elif origem in IXC_CIDADES:
        cidade_ids = {IXC_CIDADES[origem]}
    else:
        raise HTTPException(status_code=400, detail=f"Origem desconhecida: {origem}")

    cidades_label = {v: k.replace("_", " ").title() for k, v in IXC_CIDADES.items()}

    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT oc.tipo, oc.source_id, oc.nome, oc.ocultado_em, oc.motivo,
                       COALESCE(ct.data_ativacao::text, to_char(o.data_abertura, 'YYYY-MM-DD')) AS data,
                       COALESCE(ct.cidade_ixc_id, o.id_cidade) AS cidade_ixc_id
                FROM ixc_registros_ocultos oc
                LEFT JOIN ixc_contratos ct ON oc.tipo = 'contrato' AND ct.ixc_contrato_id = oc.source_id
                LEFT JOIN ixc_os o         ON oc.tipo = 'os'       AND o.ixc_os_id = oc.source_id
                ORDER BY oc.ocultado_em DESC
            """)
            ocultados = [dict(r) for r in cur.fetchall()]

            cur.execute("""
                SELECT v.tipo, v.source_id, v.nome, v.validado_em, v.motivo,
                       ct.data_ativacao::text AS data,
                       ct.cidade_ixc_id
                FROM ixc_registros_validados v
                LEFT JOIN ixc_contratos ct ON v.tipo = 'contrato' AND ct.ixc_contrato_id = v.source_id
                ORDER BY v.validado_em DESC
            """)
            validados = [dict(r) for r in cur.fetchall()]

            cur.execute("""
                SELECT id, nome, data_ativacao::text AS data, cidade_ixc_id, criado_em,
                       'contrato' AS tipo, obs AS motivo
                FROM contratos_manuais
                UNION ALL
                SELECT id, nome, data_abertura::text AS data, cidade_ixc_id, criado_em,
                       'cancelamento' AS tipo, obs AS motivo
                FROM cancelamentos_manuais
                ORDER BY criado_em DESC
            """)
            inseridos = [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()

    def _fmt(lista, campo_ts):
        out = []
        for r in lista:
            # Filtro de cidade (registros sem cidade aparecem sempre)
            if cidade_ids and r.get("cidade_ixc_id") and r["cidade_ixc_id"] not in cidade_ids:
                continue
            ts = r.pop(campo_ts, None)
            out.append({
                **r,
                "quando": ts.isoformat() if ts else None,
                "cidade": cidades_label.get(r.get("cidade_ixc_id"), r.get("cidade_ixc_id") or "—"),
            })
        return out

    return {
        "ocultados": _fmt(ocultados, "ocultado_em"),
        "validados": _fmt(validados, "validado_em"),
        "inseridos": _fmt(inseridos, "criado_em"),
    }


@app.delete("/api/ixc/registros-ocultos/{tipo}/{source_id}")
def restaurar_registro_oculto(tipo: str, source_id: int):
    """Restaura um registro ocultado — ele volta à lista da dashboard."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM ixc_registros_ocultos WHERE tipo = %s AND source_id = %s",
                (tipo, source_id),
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Registro não encontrado")
        conn.commit()
    finally:
        conn.close()
    return {"message": "Registro restaurado."}


@app.delete("/api/ixc/registros-validados/{tipo}/{source_id}")
def desfazer_validacao(tipo: str, source_id: int):
    """Desfaz uma validação manual — o registro volta a seguir a regra automática."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM ixc_registros_validados WHERE tipo = %s AND source_id = %s",
                (tipo, source_id),
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Registro não encontrado")
        conn.commit()
    finally:
        conn.close()
    return {"message": "Validação desfeita."}


@app.post("/api/ixc/contratos-manuais")
def criar_contrato_manual(body: dict):
    """Insere um contrato manualmente (não vai ao IXC, não é removido pelo sync)."""
    origem = (body.get("origem") or "").strip()
    if origem not in IXC_CIDADES:
        raise HTTPException(status_code=400, detail="Origem inválida")
    nome = (body.get("nome") or "").strip()
    if not nome:
        raise HTTPException(status_code=400, detail="Nome é obrigatório")
    data_ativacao = (body.get("data_ativacao") or "")[:10]
    if not data_ativacao:
        raise HTTPException(status_code=400, detail="Data de ativação é obrigatória")
    if not (body.get("obs") or "").strip():
        raise HTTPException(status_code=400, detail="Informe o motivo da inserção manual")
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO contratos_manuais
                    (nome, data_ativacao, status, cidade_ixc_id, bairro, fone, obs)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                nome,
                data_ativacao,
                (body.get("status") or "A")[:10],
                IXC_CIDADES[origem],
                (body.get("bairro") or ""),
                (body.get("fone")   or ""),
                (body.get("obs")    or ""),
            ))
            new_id = cur.fetchone()[0]
        conn.commit()
    finally:
        conn.close()
    return {"id": new_id, "message": "Contrato manual criado."}


@app.delete("/api/ixc/contratos-manuais/{mid}")
def excluir_contrato_manual(mid: int):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM contratos_manuais WHERE id = %s", (mid,))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Registro não encontrado")
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.post("/api/ixc/cancelamentos-manuais")
def criar_cancelamento_manual(body: dict):
    """Insere um cancelamento manualmente (não vai ao IXC, não é removido pelo sync)."""
    origem = (body.get("origem") or "").strip()
    if origem not in IXC_CIDADES:
        raise HTTPException(status_code=400, detail="Origem inválida")
    nome = (body.get("nome") or "").strip()
    if not nome:
        raise HTTPException(status_code=400, detail="Nome é obrigatório")
    data_abertura = (body.get("data_abertura") or "")[:10]
    if not data_abertura:
        raise HTTPException(status_code=400, detail="Data é obrigatória")
    if not (body.get("obs") or "").strip():
        raise HTTPException(status_code=400, detail="Informe o motivo da inserção manual")
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO cancelamentos_manuais
                    (nome, data_abertura, cidade_ixc_id, bairro, fone, obs)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                nome,
                data_abertura,
                IXC_CIDADES[origem],
                (body.get("bairro") or ""),
                (body.get("fone")   or ""),
                (body.get("obs")    or ""),
            ))
            new_id = cur.fetchone()[0]
        conn.commit()
    finally:
        conn.close()
    return {"id": new_id, "message": "Cancelamento manual criado."}


@app.delete("/api/ixc/cancelamentos-manuais/{mid}")
def excluir_cancelamento_manual(mid: int):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM cancelamentos_manuais WHERE id = %s", (mid,))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Registro não encontrado")
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.get("/api/ixc/vendas")
def ixc_vendas(origem: str = "borda_mata"):
    """Retorna novos contratos IXC por cidade (data_ativacao), incluindo registros manuais.

    origem='todas' agrega as três cidades (visão da empresa).
    """
    if origem == "todas":
        cidade_ids = list(IXC_CIDADES.values())
    elif origem in IXC_CIDADES:
        cidade_ids = [IXC_CIDADES[origem]]
    else:
        raise HTTPException(status_code=400, detail=f"Origem desconhecida: {origem}")

    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT * FROM (
                    SELECT
                        ct.ixc_contrato_id AS source_id,
                        FALSE              AS manual,
                        ct.id_cliente,
                        ct.data_ativacao,
                        ct.status,
                        cl.nome,
                        cl.bairro,
                        cl.fone,
                        cl.ativo           AS cliente_ativo,
                        -- Nova instalação exige cadastro recente: troca de
                        -- titularidade reaproveita cadastro antigo
                        (cl.data_cadastro IS NOT NULL
                         AND cl.data_cadastro >= ct.data_ativacao - INTERVAL '90 days') AS cadastro_novo,
                        -- ... e OS de instalação (assuntos 1=Instalação, 18=Novo Cliente)
                        EXISTS (
                            SELECT 1 FROM ixc_os osx
                            WHERE osx.id_cliente = ct.id_cliente
                              AND osx.id_assunto IN (1, 18)
                        ) AS tem_os_instalacao,
                        -- Validação manual passa por cima da regra automática
                        EXISTS (
                            SELECT 1 FROM ixc_registros_validados v
                            WHERE v.tipo = 'contrato' AND v.source_id = ct.ixc_contrato_id
                        ) AS validado,
                        -- Ponto adicional: cliente antigo com login novo criado
                        -- junto deste contrato (novo ponto = novo login)
                        EXISTS (
                            SELECT 1 FROM ixc_logins lg
                            WHERE lg.id_contrato = ct.ixc_contrato_id
                              AND lg.data_criacao BETWEEN ct.data_ativacao - INTERVAL '30 days'
                                                      AND ct.data_ativacao + INTERVAL '60 days'
                        ) AS login_novo
                    FROM ixc_contratos ct
                    LEFT JOIN ixc_clientes cl ON cl.ixc_id = ct.id_cliente
                    WHERE ct.cidade_ixc_id = ANY(%s)
                      AND cl.ativo = 'S'
                      AND NOT EXISTS (
                          SELECT 1 FROM ixc_registros_ocultos oc
                          WHERE oc.tipo = 'contrato' AND oc.source_id = ct.ixc_contrato_id
                      )

                    UNION ALL

                    SELECT
                        id                 AS source_id,
                        TRUE               AS manual,
                        NULL               AS id_cliente,
                        data_ativacao,
                        status,
                        nome,
                        bairro,
                        fone,
                        'S'                AS cliente_ativo,
                        TRUE               AS cadastro_novo,
                        TRUE               AS tem_os_instalacao,
                        FALSE              AS validado,
                        FALSE              AS login_novo
                    FROM contratos_manuais
                    WHERE cidade_ixc_id = ANY(%s)
                ) t
                ORDER BY data_ativacao DESC
            """, (cidade_ids, cidade_ids))
            rows = [dict(r) for r in cur.fetchall()]

            cur.execute(
                "SELECT MAX(synced_at) AS ts FROM ixc_contratos WHERE cidade_ixc_id = ANY(%s)",
                (cidade_ids,)
            )
            last_sync_row = cur.fetchone()
            last_sync = last_sync_row["ts"] if last_sync_row else None

            # A exigência de OS só vale para o período coberto pelo sync de OS
            # (senão o histórico antigo, sem OS sincronizada, sumiria da lista)
            cur.execute("SELECT MIN(data_abertura)::date AS d FROM ixc_os")
            os_min_row = cur.fetchone()
            os_min = os_min_row["d"] if os_min_row else None

            # Base atual de contratos ativos (status A) — bate com o número do IXC
            cur.execute(
                "SELECT COUNT(*) AS n FROM ixc_contratos WHERE cidade_ixc_id = ANY(%s) AND status = 'A'",
                (cidade_ids,)
            )
            contratos_ativos = cur.fetchone()["n"]
    finally:
        conn.close()

    registros, desconsiderados = [], []
    for r in rows:
        da = r.get("data_ativacao")
        cadastro_novo = r.pop("cadastro_novo", True)
        tem_os = r.pop("tem_os_instalacao", True)
        login_novo = r.pop("login_novo", False)
        r["data_ativacao"] = str(da) if da else ""
        # Cliente antigo que contratou mais um ponto: login novo neste contrato
        r["ponto_adicional"] = bool(not cadastro_novo and login_novo and not r["manual"])

        motivo = None
        if not r["manual"] and not r.get("validado"):
            if not cadastro_novo and not login_novo:
                motivo = "Cadastro antigo sem login novo — possível troca de titularidade"
            elif cadastro_novo and os_min and da and da >= os_min and not tem_os:
                motivo = "Sem OS de instalação vinculada"

        if motivo:
            desconsiderados.append({**r, "motivo": motivo})
        else:
            registros.append(r)

    return {
        "total":            len(registros),
        "contratos_ativos": contratos_ativos,
        "registros":        registros,
        "desconsiderados":  desconsiderados,
        "origem":           origem,
        "last_sync":        last_sync.isoformat() if last_sync else None,
        "sem_sync":         len(registros) == 0 and last_sync is None,
    }


@app.get("/api/ixc/divergencias")
def ixc_divergencias(origem: str = "borda_mata", ano: int = None):
    """Compara registros ativos do IXC com a planilha e retorna divergências."""
    if not IXC_TOKEN:
        raise HTTPException(status_code=503, detail="IXC_TOKEN não configurado no servidor.")
    if origem not in IXC_CIDADES:
        raise HTTPException(status_code=400, detail=f"Origem desconhecida: {origem}")
    if ano is None:
        ano = datetime.now().year

    cidade_id = IXC_CIDADES[origem]
    todos = _ixc_fetch_por_ano(ano)

    ixc_ativos = []
    for c in todos:
        if str(c.get("cidade", "")) != cidade_id:
            continue
        if c.get("ativo", "") != "S":
            continue
        nome = (c.get("razao") or c.get("fantasia") or "").strip()
        ixc_ativos.append({
            "id":            c.get("id"),
            "nome":          nome,
            "data_cadastro": c.get("data_cadastro", ""),
            "bairro":        c.get("bairro", ""),
            "fone":          c.get("telefone_celular") or c.get("fone", ""),
            "status":        c.get("status_prospeccao", ""),
        })

    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, data, nome, instalacao, vendedor
                FROM vendas_borda_mata
                WHERE data >= %s AND data < %s AND origem = %s
                ORDER BY data
                """,
                (f"{ano}-01-01", f"{ano + 1}-01-01", origem),
            )
            planilha_rows = [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()

    nomes_planilha = {_norm_nome(r["nome"]) for r in planilha_rows if r.get("nome")}
    nomes_ixc      = {_norm_nome(r["nome"]) for r in ixc_ativos    if r.get("nome")}

    so_ixc      = [r for r in ixc_ativos    if _norm_nome(r["nome"]) not in nomes_planilha]
    so_planilha = [r for r in planilha_rows if _norm_nome(r.get("nome", "")) not in nomes_ixc]

    return {
        "total_ixc_ativos": len(ixc_ativos),
        "total_planilha":   len(planilha_rows),
        "so_ixc":           so_ixc,
        "so_planilha":      so_planilha,
        "origem":           origem,
        "ano":              ano,
    }


@app.get("/api/resumo")
def resumo(origem: str = "ouro_fino"):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM anuncio_ouro_fino WHERE origem = %s", (origem,))
            total = cur.fetchone()[0]
            cur.execute("SELECT MAX(importado_em) FROM anuncio_ouro_fino WHERE origem = %s", (origem,))
            ultima_sync = cur.fetchone()[0]
    finally:
        conn.close()
    return {
        "total": total,
        "ultima_sincronizacao": ultima_sync.isoformat() if ultima_sync else None,
    }


# ── Acessos do hotspot (Wi-Fi guests) e funil de vendas ─────────────────────
app.include_router(guests_router)
app.include_router(funil_router)


# ── Frontend estático (build do frontend-admin) ─────────────────────────────
# Montado por último para não interceptar as rotas /api/*.
_STATIC_ADMIN = Path(__file__).parent / "static_admin"
if _STATIC_ADMIN.is_dir():
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory=_STATIC_ADMIN, html=True), name="static_admin")
