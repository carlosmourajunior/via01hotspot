# Deploy — Funções de usuário (RBAC) + módulo OLT

Tudo já está na branch `main`. Passos no servidor de produção (UnifyServer).

## 1. Atualizar código e dependências

```bash
git pull
docker compose build admin        # instala netmiko (paramiko/cryptography)
```

## 2. Configurar o `.env` do servidor

Adicione o bloco da OLT (credenciais reais da OLT Nokia/ISAM — as mesmas do
sistema Django antigo, em `isp/.env`):

```
NOKIA_DEVICE_TYPE=alcatel_aos
NOKIA_HOST=<ip-da-olt>
NOKIA_USERNAME=<usuario>
NOKIA_PASSWORD=<senha>
NOKIA_VERBOSE=False
NOKIA_GLOBAL_DELAY_FACTOR=2
OLT_SYNC_INTERVALO_HORAS=2
# NÃO definir OLT_MOCK_DIR em produção (deixe ausente/vazio)
# Ações destrutivas começam DESLIGADAS; ligar só após validar (passo 6)
OLT_ACOES_ATIVAS=0
```

## 3. Subir

```bash
docker compose up -d admin
docker compose logs admin --tail=5   # deve mostrar os 2 agendadores ativos
```

## 4. Atribuir funções aos usuários (RBAC)

Antes que o enforcement afete alguém, na aba **Admin** atribua funções a cada
usuário (Vendas / Financeiro / Suporte). **Todos precisam relogar** — o token
antigo (8h) não tem o claim de funções e cairá em 403 nas rotas restritas.
Usuários `admin` continuam vendo tudo.

Mapa de abas: vendas → Dashboard, Wi-Fi Guests, Funil · financeiro → Dashboard,
Financeiro · suporte → OS IXC, OLT · admin → tudo + Admin.

## 5. Primeira coleta da OLT

Logado como suporte (ou admin), aba **OLT** → **Coleta completa**. A primeira
leva alguns minutos (a coleta de MACs é a mais demorada, ~20 min). Acompanhe em
"Coletas recentes". Depois disso o agendador roda sozinho a cada 2h.

Compare os números da Visão Geral com o sistema Django antigo (rodando em
paralelo) — total de ONUs, offline, ocupação de portas.

## 6. Habilitar ações destrutivas (reboot/remover) — só após validar leitura

```
OLT_ACOES_ATIVAS=1     # no .env
docker compose up -d admin
```

Teste primeiro um **reboot** em uma ONU combinada com a equipe e confirme na OLT
que reiniciou. As remoções pedem digitação do serial e tudo fica na sub-aba
**Auditoria**. Para desligar as ações instantaneamente: `OLT_ACOES_ATIVAS=0` +
`docker compose up -d admin`.

## 7. Aposentar o sistema Django ISP

Depois de alguns dias com os números batendo e as ações validadas, desligar a
stack Django antiga (`isp/`) e arquivar o repositório.

## Notas
- O serviço `admin` deve rodar com **1 worker uvicorn** (default) — a trava de
  coleta da OLT vive em memória. Não aumentar workers.
- `clientes_fibra` é a única coleta que não usa a OLT (fala só com o IXC), então
  roda em paralelo às demais.
