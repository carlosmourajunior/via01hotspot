# ── Etapa 1: build do frontend admin ────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend-admin
COPY frontend-admin/package*.json ./
RUN npm install
COPY frontend-admin/ ./
RUN npm run build

# ── Etapa 2: build do frontend do portal ────────────────────
FROM node:20-alpine AS portal-builder
WORKDIR /app/frontend-portal
COPY frontend-portal/package*.json ./
RUN npm ci
COPY frontend-portal/ ./
RUN npm run build

# ── Etapa 3: backend FastAPI (admin e portal na mesma imagem)
FROM python:3.12-slim
WORKDIR /app
COPY backend-py/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend-py/ .
COPY --from=frontend-builder /app/backend-py/static_admin ./static_admin
COPY --from=portal-builder /app/backend-py/static_portal ./static_portal

EXPOSE 8000
# Serviço "admin" usa este CMD; o serviço "portal" sobrescreve com uvicorn portal:app
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
