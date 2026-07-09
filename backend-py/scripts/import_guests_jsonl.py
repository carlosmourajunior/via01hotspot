"""Importa o guests.jsonl do backend Node para a tabela hotspot_guests.

Idempotente: a UNIQUE(phone, mac, connected_at) + ON CONFLICT DO NOTHING
permite re-executar quantas vezes for preciso (ex.: para pegar o delta no cutover).

Uso (dentro do container admin):
    python scripts/import_guests_jsonl.py [caminho/do/guests.jsonl]
Default: /hotspot-data/guests.jsonl (bind-mount de ./backend/data no compose).
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import db  # noqa: E402


def main():
    caminho = Path(sys.argv[1] if len(sys.argv) > 1 else "/hotspot-data/guests.jsonl")
    if not caminho.is_file():
        print(f"Arquivo não encontrado: {caminho}")
        sys.exit(1)

    inseridos = ignorados = invalidos = 0
    conn = db.get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(db.DDL_HOTSPOT_GUESTS)
            for n, linha in enumerate(caminho.read_text(encoding="utf-8").splitlines(), 1):
                linha = linha.strip()
                if not linha:
                    continue
                try:
                    reg = json.loads(linha)
                    phone = str(reg["phone"])
                    mac = str(reg.get("mac") or "")
                    connected_at = reg["connectedAt"]
                except (json.JSONDecodeError, KeyError) as e:
                    print(f"Linha {n} inválida ({e}) — pulando: {linha[:80]}")
                    invalidos += 1
                    continue
                cur.execute(
                    """
                    INSERT INTO hotspot_guests (phone, mac, ap, is_client, connected_at)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (phone, mac, connected_at) DO NOTHING
                    """,
                    (phone, mac, reg.get("ap"), bool(reg.get("isClient")), connected_at),
                )
                if cur.rowcount:
                    inseridos += 1
                else:
                    ignorados += 1
        conn.commit()
    finally:
        conn.close()

    print(f"Importação concluída: {inseridos} inseridos, {ignorados} já existiam, {invalidos} inválidos.")


if __name__ == "__main__":
    main()
