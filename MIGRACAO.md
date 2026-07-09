# Roteiro de deploy no servidor — migração para FastAPI

O código das Fases 0–3 já está no branch `migracao-fastapi`, validado localmente.
Os passos abaixo são executados **no servidor** onde a stack do hotspot roda hoje.

## 1. Atualizar o código e o .env

```bash
git fetch && git checkout migracao-fastapi
cp .env.example .env   # preencher com os valores reais (UniFi, Evolution, IXC, OneDrive)
```

O `.env` da raiz é novo — consolida `backend/.env` (UniFi/Evolution) e o `.env`
do controleinterno (IXC, OneDrive, DATABASE_URL, SECRET_KEY). O `backend/.env`
antigo continua sendo usado só pelo serviço Node legado.

## 2. Subir os serviços novos (portal na 80 NÃO muda)

```bash
docker compose build admin portal
docker compose up -d db admin portal
curl http://localhost:8082/api/health   # admin ok
curl http://localhost:8090/health       # portal FastAPI ok (em paralelo)
curl http://localhost/health            # Node continua atendendo na 80
```

## 3. Popular os dados (sem dump)

O controleinterno antigo estava em fase de testes — não há dados a migrar.
O banco novo começa vazio; o usuário bootstrap `admin/admin123` é criado
automaticamente no primeiro start (trocar a senha depois).

Popular pela própria interface em `http://<servidor>:8082`:
- Tela **Admin** → botões de sincronização IXC (clientes, OS, contratos, logins)
- Sincronizações de planilhas (OneDrive) conforme necessário

## 4. Importar os guests do jsonl

```bash
docker compose exec admin python scripts/import_guests_jsonl.py
```

Idempotente — pode rodar quantas vezes quiser. Conferir na tela "Wi-Fi Guests"
do admin que os totais batem com o `/admin` antigo.

## 5. Teste E2E do portal novo (porta 8090) — o passo mais importante

Com um celular conectado à rede de convidados:

1. Abrir `http://<servidor>:8090/?id=<MAC-do-celular>` no próprio celular.
2. Informar o WhatsApp → receber o código → digitar.
3. Confirmar: acesso liberado no controller UniFi, registro aparece na tela
   Wi-Fi Guests do admin (`:8082`).
4. Testes negativos: código errado, código expirado (aguardar 5 min), telefone
   com menos de 10 dígitos.

## 6. Cutover da porta 80 (janela de ~1 minuto, horário de baixo movimento)

No `docker-compose.yml`:
- serviço `portal`: trocar `"8090:3000"` por `"80:3000"`
- serviço `backend` (Node): remover o mapeamento `"80:3000"` e adicionar
  `profiles: ["legacy"]`

```bash
docker compose up -d
docker compose exec admin python scripts/import_guests_jsonl.py   # pega o delta
curl http://localhost/health
```

Fazer o fluxo OTP completo com celular real logo em seguida.

**Rollback (<2 min):** reverter os dois mapeamentos de porta e
`docker compose --profile legacy up -d backend`.

## 7. Observação (3–7 dias) e aposentadoria

- Acompanhar `docker compose logs -f portal` e o volume diário na tela Wi-Fi Guests.
- Depois: remover `backend/` (Node), renomear `backend-py/` → `backend/`,
  arquivar `backend/data/guests.jsonl` como backup, atualizar `SETUP.md`,
  trocar/desativar o usuário bootstrap `admin/admin123` na tela Admin.

## Portas finais

| Porta | Serviço |
|---|---|
| 80 | Portal captivo (clientes UniFi) |
| 8082 | Área administrativa (rede interna) |
| 8081 | Evolution API |
| 8090 | Portal em teste (some após o cutover) |
