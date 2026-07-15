"""Valida os parsers do olt_client contra as fixtures de saídas reais da OLT.

Uso: python scripts/test_olt_parsers.py  (de dentro de backend-py/, sem OLT)
"""
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")  # console Windows (cp1252)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import olt_client  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures_olt"


def ler(nome):
    return (FIXTURES / nome).read_text(encoding="utf-8")


def main():
    erros = []

    # ── ONT status ──
    onus = olt_client.parse_ont_status(ler("show_equipment_ont_status_pon_1_1_1_14.txt"))
    print(f"parse_ont_status: {len(onus)} ONUs")
    for o in onus[:3]:
        print("  ", o["pon"], o["position"], o["serial"], o["oper_state"], o["olt_rx_sig"], "|", o["desc1"])
    if len(onus) != 10:
        erros.append(f"esperava 10 ONUs, veio {len(onus)}")
    down = [o for o in onus if o["oper_state"] == "down"]
    if len(down) != 2 or any(o["olt_rx_sig"] is not None for o in down):
        erros.append(f"esperava 2 ONUs down com sinal None, veio {len(down)}")
    sem_desc = [o for o in onus if not o["desc1"]]
    print(f"  ONUs sem descrição: {len(sem_desc)} (posição {[o['position'] for o in sem_desc]})")
    pabx = next((o for o in onus if o["position"] == 98), None)
    if not pabx or pabx["desc1"] != "PABX" or pabx["desc2"] != "Prefeitura":
        erros.append(f"desc1/desc2 da posição 98 incorretos: {pabx}")

    # ── Ocupação ──
    count = olt_client.parse_ocupacao(ler("show_equipment_ont_status_pon_1_1_1_14.txt"))
    print(f"parse_ocupacao: count = {count}")
    if count != 10:
        erros.append(f"esperava count 10, veio {count}")

    # ── FDB (MACs) ──
    macs = olt_client.parse_fdb(ler("show_vlan_bridge_port_fdb.txt"))
    print(f"parse_fdb: {len(macs)} registros → {macs}")
    if len(macs) != 3 or macs[0] != {"pon": "1/1/1/14", "position": 90, "mac": "aa:bb:cc:11:22:33"}:
        erros.append(f"FDB incorreto: {macs}")

    # ── Sistema ──
    release = olt_client.parse_isam_release(ler("show_software_mngt_version_etsi.txt"))
    print(f"parse_isam_release: {release}")
    if release != "L6GPAA62.673":
        erros.append(f"release incorreta: {release}")

    uptime = olt_client.parse_uptime(ler("show_core1_uptime.txt"))
    print(f"parse_uptime: {uptime['days']}d {uptime['hours']}h {uptime['minutes']}m")
    if (uptime["days"], uptime["hours"], uptime["minutes"]) != (958, 12, 26):
        erros.append(f"uptime incorreto: {uptime}")

    slots = olt_client.parse_slots(ler("show_equipment_slot.txt"))
    print(f"parse_slots: {len(slots)} slots → {[s['slot_name'] for s in slots]}")
    if len(slots) != 4 or slots[1] != {
        "slot_name": "nt-a", "actual_type": "fant-f", "enabled": True,
        "error_status": "no-error", "availability": "available", "restart_count": 2,
    }:
        erros.append(f"slots incorretos: {slots}")

    temps = olt_client.parse_temperature(ler("show_equipment_temperature.txt"))
    print(f"parse_temperature: {len(temps)} sensores → {[(t['slot_name'], t['actual_temp']) for t in temps]}")
    if len(temps) != 3 or temps[1]["actual_temp"] != 51 or temps[1]["tca_high"] != 84:
        erros.append(f"temperaturas incorretas: {temps}")

    print()
    if erros:
        print("FALHOU:")
        for e in erros:
            print("  ✗", e)
        sys.exit(1)
    print("✓ Todos os parsers passaram.")


if __name__ == "__main__":
    main()
