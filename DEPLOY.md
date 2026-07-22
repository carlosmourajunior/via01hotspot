# Estratégia de Deploy — Hotspot Via01

Deploy contínuo para o servidor do hotspot. O servidor **puxa** a imagem: nada
entra pelo firewall e o build pesado não roda na máquina do provedor.

## Visão geral do fluxo

```
   git push em main
          │
          ▼
   GitHub Actions (.github/workflows/deploy.yml)
   builda backend-py/Dockerfile → publica no GHCR
   (imagem única: já contém FastAPI + frontend-admin + frontend-portal)
          │
          ▼  (o servidor puxa; nada precisa entrar)
   Watchtower detecta :latest nova → recria o container "admin"
          │
          ▼
   admin sobe e roda init_hotspot_tables() (cria tabelas/colunas novas)
   portal continua no ar, atualizado manualmente quando convier
```

**Por que uma imagem só:** o [backend-py/Dockerfile](backend-py/Dockerfile) é
multi-stage e já compila os dois frontends. Os serviços `admin` e `portal` usam
a mesma imagem — o portal apenas sobrescreve o CMD (`uvicorn portal:app`).

## O que atualiza sozinho

| Serviço        | Imagem                                       | Atualiza sozinho?     |
|----------------|----------------------------------------------|-----------------------|
| `admin`        | `ghcr.io/<owner>/<repo>:latest`              | ✅ Watchtower          |
| `portal`       | `ghcr.io/<owner>/<repo>:latest`              | ❌ manual (porta 80)   |
| `db`           | `postgres:16-alpine`                         | ❌ protegido           |
| `evolution-api`| `evoapicloud/evolution-api:v2.3.7`           | ❌ versão fixada       |
| `evolution-db` | `postgres:15-alpine`                         | ❌ protegido           |

> O Watchtower roda com `--label-enable`: só toca em containers com o label
> `com.centurylinklabs.watchtower.enable=true`, que hoje só o `admin` tem.
>
> **Por que o portal fica de fora:** ele responde na porta 80, para onde a
> controladora UniFi redireciona o captive portal. Recriar o container derruba
> o login do hotspot por ~15s, e isso não deve acontecer sem alguém olhando.

## Migrações de banco

Não há passo separado. `init_hotspot_tables()` roda no startup dos dois apps
([main.py](backend-py/main.py), [portal.py](backend-py/portal.py)) e usa
`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, então o próprio
deploy aplica as mudanças de schema. Colunas novas precisam de `DEFAULT` ou de
ser nulas, para que a versão antiga do código continue funcionando durante a
troca de container.

---

## Setup inicial (uma vez)

### 1. No GitHub
Nada a instalar: o workflow usa o `GITHUB_TOKEN` automático para publicar.
Depois do primeiro build, confira em `github.com/carlosmourajunior?tab=packages`.

Enquanto o repositório for **público**, o pacote também é público e o servidor
puxa a imagem sem autenticação.

### 2. No servidor do hotspot

```bash
# a) Clonar o repo (só precisa do compose + .env; o código vem na imagem)
git clone https://github.com/carlosmourajunior/via01hotspot.git
cd via01hotspot

# b) Configurar o .env de produção
cp .env.example .env
nano .env      # UNIFI_*, EVOLUTION_*, IXC_*, SECRET_KEY, etc.

# c) Subir
docker compose -f docker-compose.prod.yml up -d
```

A partir daí, **todo push em `main` chega ao servidor sozinho** (no `admin`).

### 3. Se o repositório virar privado
```bash
# no servidor, uma vez: PAT criado em github.com/settings/tokens (read:packages)
docker login ghcr.io -u carlosmourajunior -p <PAT>
```
E descomente o mount do `config.json` no serviço `watchtower` do
[docker-compose.prod.yml](docker-compose.prod.yml) — sem ele o Watchtower não
consegue consultar o registry privado.

---

## Rotina do dia a dia

- **Publicar mudança:** `git push` na `main`. O Actions builda (~3-5 min) e em
  até `WATCHTOWER_INTERVAL` segundos (padrão 300) o `admin` se atualiza.
- **Deploy imediato, sem esperar o intervalo:**
  ```bash
  docker compose -f docker-compose.prod.yml pull admin
  docker compose -f docker-compose.prod.yml up -d admin
  ```
- **Atualizar o portal** (quando a mudança mexer no captive portal), de
  preferência em horário de baixo movimento:
  ```bash
  docker compose -f docker-compose.prod.yml pull portal
  docker compose -f docker-compose.prod.yml up -d portal
  ```
- **Rollback:** no `.env` do servidor troque `IMAGE_TAG=latest` por
  `IMAGE_TAG=<sha do commit bom>` e rode o deploy imediato acima. Cada build
  publica também a tag com o SHA do commit.
- **Ver o que o Watchtower fez:** `docker logs watchtower --tail 50`.

## Desenvolvimento

O [docker-compose.yml](docker-compose.yml) continua sendo o de desenvolvimento:
builda local, sem Watchtower, sem GHCR.

```bash
docker compose up -d --build
```
