# ── Etapa 1: build do frontend admin ────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend-admin
COPY frontend-admin/package*.json ./
RUN npm install
COPY frontend-admin/ ./
RUN npm run build

# ── Etapa 2: backend FastAPI ────────────────────────────────
FROM python:3.12-slim
WORKDIR /app
COPY backend-py/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend-py/ .
COPY --from=frontend-builder /app/backend-py/static_admin ./static_admin

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
