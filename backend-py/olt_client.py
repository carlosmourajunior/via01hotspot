"""Cliente da OLT Nokia/Alcatel-Lucent ISAM (via netmiko SSH/telnet).

Port do olt/utils.py do sistema Django ISP. Os parsers são funções puras
(str → dados), testáveis sem OLT. Com OLT_MOCK_DIR definido, a conexão é
substituída por um fake que responde comandos lendo arquivos de fixture —
permite E2E local completo (a OLT real só é alcançável do servidor).

Rodar sempre o serviço com 1 worker uvicorn: a OLT não aceita sessões
paralelas e a trava de coleta (olt_admin._OLT_LOCK) vive em memória.
"""
import os
import re
from pathlib import Path

# ── Comandos ISAM ────────────────────────────────────────────────────────────
CMD_ONT_STATUS  = "show equipment ont status pon 1/1/{slot}/{pon}"
CMD_INHIBIT     = "environment inhibit-alarms"
CMD_FDB         = "show vlan bridge-port-fdb"          # pesado: read_timeout 1200s
CMD_VERSION     = "show software-mngt version etsi"
CMD_UPTIME      = "show core1-uptime"
CMD_SLOTS       = "show equipment slot"
CMD_TEMPERATURE = "show equipment temperature"
CMD_ONT_DOWN    = "configure equipment ont interface {interface} admin-state down"
CMD_ONT_REMOVE  = "configure equipment ont no interface {interface}"
CMD_ONT_REBOOT  = "admin equipment ont interface {interface} reboot with-active-image"

# Faixas de varredura da OLT (mesmas do sistema original)
SLOTS = range(3)    # 0-2
PONS  = range(17)   # 0-16

FDB_READ_TIMEOUT = 1200


def get_device_params() -> dict:
    """Parâmetros netmiko a partir das variáveis NOKIA_* (iguais ao Django)."""
    return {
        "device_type":         os.getenv("NOKIA_DEVICE_TYPE", "alcatel_aos"),
        "host":                os.getenv("NOKIA_HOST", ""),
        "username":            os.getenv("NOKIA_USERNAME", ""),
        "password":            os.getenv("NOKIA_PASSWORD", ""),
        "verbose":             os.getenv("NOKIA_VERBOSE") == "True",
        "global_delay_factor": int(os.getenv("NOKIA_GLOBAL_DELAY_FACTOR", "2")),
        # Compatibilidade com OLTs antigos/Nokia/Alcatel que rejeitam host key
        # estrita em algumas combinações de Paramiko/Netmiko.
        "ssh_strict": False,
    }


# ── Parsers puros ────────────────────────────────────────────────────────────

# Linha do "show equipment ont status pon":
# 1/1/1/14   1/1/1/14/90    RCMG:3A88390E up  up  -23.0  0.5  tomazpaiva  tomazpaiva  undefined
# Nota: o regex original do Django exigia desc1/desc2 preenchidas e perdia
# ONUs sem descrição — aqui os 7 primeiros campos são fixos e o resto (descs
# + hosts) é tratado por tokens, cobrindo descrições vazias.
_ONT_LINE_RE = re.compile(
    r"^\s*(\d+/\d+/\d+/\d+)\s+(\d+/\d+/\d+/\d+/\d+)\s+(\S+:\S+)\s+(\S+)\s+(\S+)"
    r"\s+([-.\d]+|invalid)\s+([-.\d]+|invalid)\s*(.*)$"
)

# Linha da tabela FDB: "1/1/1/14/90/14/1  835  aa:bb:cc:dd:ee:ff ..."
# Porta tem 7 partes: pon (4) / posição / uni / bridge-port. O regex original do
# Django casava deslocado e o chamador remontava o pon — aqui ancoramos as 7
# partes e exigimos MAC completo (17 chars).
_FDB_RE = re.compile(
    r"\b(\d+/\d+/\d+/\d+)/(\d+)/\d+/\d+\s+\d+\s+((?:[0-9a-f]{2}:){5}[0-9a-f]{2})",
    re.IGNORECASE,
)


def parse_ont_status(output: str) -> list:
    """Extrai as ONUs da saída do 'show equipment ont status pon'."""
    onus = []
    for line in (output or "").splitlines():
        m = _ONT_LINE_RE.match(line)
        if not m:
            continue
        try:
            olt_rx_sig = float(m.group(6))
        except (ValueError, TypeError):
            olt_rx_sig = None  # 'invalid' (ONU down)

        # Cauda: desc1, desc2 e a coluna hosts ('undefined'); descs podem estar vazias
        tokens = m.group(8).split()
        if tokens and tokens[-1] == "undefined":
            tokens = tokens[:-1]
        desc1 = tokens[0] if len(tokens) >= 1 else ""
        desc2 = tokens[1] if len(tokens) >= 2 else ""

        onus.append({
            "pon":         m.group(1),
            "position":    int(m.group(2).split("/")[-1]),
            "serial":      m.group(3),
            "admin_state": m.group(4),
            "oper_state":  m.group(5),
            "olt_rx_sig":  olt_rx_sig,
            "ont_olt":     m.group(7),
            "desc1":       desc1,
            "desc2":       desc2,
        })
    return onus


def parse_ocupacao(output: str):
    """Extrai o total de ONUs da linha 'count' da saída do ont status."""
    for line in (output or "").splitlines():
        if "count" in line:
            try:
                return int(line.split(":")[1])
            except (ValueError, IndexError):
                continue
    return None


def parse_fdb(output: str) -> list:
    """Extrai (pon, position, mac) de cada linha da tabela FDB."""
    registros = []
    for line in (output or "").splitlines():
        m = _FDB_RE.search(line)
        if m:
            registros.append({
                "pon":      m.group(1),   # '1/1/1/14'
                "position": int(m.group(2)),
                "mac":      m.group(3),
            })
    return registros


def parse_isam_release(output: str) -> str:
    m = re.search(r"isam-release\s*:\s*(\S+)", output or "")
    return m.group(1) if m else "Unknown"


def parse_uptime(output: str) -> dict:
    """Ex.: 'System Up Time : 958 days, 12:26:47.46 (hr:min:sec)'."""
    m = re.search(r"(\d+)\s+days?,\s+(\d+):(\d+):(\d+)", output or "")
    if m:
        return {
            "days": int(m.group(1)), "hours": int(m.group(2)),
            "minutes": int(m.group(3)), "seconds": int(m.group(4)),
            "raw": (output or "").strip(),
        }
    return {"days": 0, "hours": 0, "minutes": 0, "seconds": 0, "raw": (output or "").strip()}


_SLOT_PREFIXOS = ("acu:", "nt-", "lt:", "vlt:")


def parse_slots(output: str) -> list:
    slots = []
    for line in (output or "").splitlines():
        parts = [p for p in line.strip().split() if p]
        if len(parts) < 6 or not any(pfx in parts[0] for pfx in _SLOT_PREFIXOS):
            continue
        slots.append({
            "slot_name":     parts[0],
            "actual_type":   parts[1],
            "enabled":       parts[2].lower() == "yes",
            "error_status":  parts[3],
            "availability":  parts[4],
            "restart_count": int(parts[5]) if parts[5].isdigit() else 0,
        })
    return slots


_TEMP_PREFIXOS = ("nt-", "lt:", "acu:")


def parse_temperature(output: str) -> list:
    temps = []
    for line in (output or "").splitlines():
        parts = [p for p in line.strip().split() if p]
        if len(parts) < 7 or not any(pfx in parts[0] for pfx in _TEMP_PREFIXOS):
            continue
        try:
            temps.append({
                "slot_name":     parts[0],
                "sensor_id":     int(parts[1]),
                "actual_temp":   int(parts[2]),
                "tca_low":       int(parts[3]),
                "tca_high":      int(parts[4]),
                "shutdown_low":  int(parts[5]),
                "shutdown_high": int(parts[6]),
            })
        except (ValueError, IndexError):
            continue
    return temps


# ── Conexão (real via netmiko, ou mock por fixtures) ────────────────────────

def _cmd_para_arquivo(cmd: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", cmd.strip().lower()).strip("_") + ".txt"


class FakeConnection:
    """Conexão simulada: responde comandos lendo fixtures de OLT_MOCK_DIR.

    Arquivo procurado: comando sanitizado (ex. 'show equipment slot' →
    show_equipment_slot.txt). Sem arquivo correspondente → resposta vazia
    (equivale a uma porta sem ONUs).
    """

    def __init__(self, mock_dir: str):
        self.dir = Path(mock_dir)
        self.comandos = []  # trilha p/ testes

    def find_prompt(self):
        return "mock>"

    def send_command(self, cmd, **kwargs):
        self.comandos.append(cmd)
        arquivo = self.dir / _cmd_para_arquivo(cmd)
        if arquivo.is_file():
            return arquivo.read_text(encoding="utf-8")
        return ""

    def write_channel(self, cmd):
        self.comandos.append(cmd.strip())

    def read_channel(self):
        return ""

    def disconnect(self):
        pass


def conectar():
    """Abre uma conexão com a OLT (ou o mock, se OLT_MOCK_DIR estiver setado)."""
    mock_dir = os.getenv("OLT_MOCK_DIR")
    if mock_dir:
        return FakeConnection(mock_dir)
    from netmiko import ConnectHandler  # import tardio: netmiko é pesado
    conn = ConnectHandler(**get_device_params())
    conn.find_prompt()
    return conn


class OltConnection:
    """Context manager: garante disconnect mesmo em erro."""

    def __enter__(self):
        self.conn = conectar()
        return self.conn

    def __exit__(self, exc_type, exc, tb):
        try:
            self.conn.disconnect()
        except Exception:
            pass
        return False


# ── Ações destrutivas na OLT ─────────────────────────────────────────────────

def reboot_onu(interface: str):
    """Reinicia a ONU (ex.: interface '1/1/1/14/90')."""
    with OltConnection() as olt:
        olt.send_command(CMD_ONT_REBOOT.format(interface=interface))


def remover_onu(interface: str):
    """Desautoriza e remove a ONU da OLT (admin-state down + no interface)."""
    import time
    with OltConnection() as olt:
        olt.write_channel(CMD_ONT_DOWN.format(interface=interface) + "\n")
        time.sleep(2)
        olt.read_channel()
        olt.write_channel(CMD_ONT_REMOVE.format(interface=interface) + "\n")
        time.sleep(2)
        olt.read_channel()
