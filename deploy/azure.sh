#!/usr/bin/env bash
#
# Deploy the Contextifly backend to Azure Container Apps, with managed
# Postgres + Redis. Single-replica by default (see MIN/MAX_REPLICAS).
#
# Prereqs: `az login` done, Docker not required (image is built in ACR).
# Usage:   LLM_API_KEY=sk-... ./deploy/azure.sh
#
set -euo pipefail

# ---- Config (override via env) ------------------------------------------
LOCATION="${LOCATION:-eastus}"
RG="${RG:-contextifly-rg}"
ACR="${ACR:-contextiflyacr$RANDOM}"        # must be globally unique
PG_SERVER="${PG_SERVER:-contextifly-pg-$RANDOM}"
PG_ADMIN="${PG_ADMIN:-contextifly}"
PG_PASSWORD="${PG_PASSWORD:?set PG_PASSWORD}"
PG_DB="${PG_DB:-contextifly}"
REDIS_NAME="${REDIS_NAME:-contextifly-redis-$RANDOM}"
APP_ENV="${APP_ENV:-contextifly-env}"
APP_NAME="${APP_NAME:-contextifly-backend}"
IMAGE_TAG="${IMAGE_TAG:-0.2.0}"
MIN_REPLICAS="${MIN_REPLICAS:-1}"
MAX_REPLICAS="${MAX_REPLICAS:-1}"

LLM_PROVIDER="${LLM_PROVIDER:-gemini}"
LLM_API_KEY="${LLM_API_KEY:?set LLM_API_KEY}"
LLM_MODEL="${LLM_MODEL:-}"
LLM_BASE_URL="${LLM_BASE_URL:-}"

echo "==> Registering providers (idempotent)…"
az provider register --namespace Microsoft.App --wait
az provider register --namespace Microsoft.OperationalInsights --wait

echo "==> Resource group: $RG"
az group create -n "$RG" -l "$LOCATION" -o none

echo "==> Container registry: $ACR"
az acr create -n "$ACR" -g "$RG" --sku Basic --admin-enabled true -o none

echo "==> Postgres flexible server: $PG_SERVER (this takes a few minutes)…"
az postgres flexible-server create \
  -g "$RG" -n "$PG_SERVER" -l "$LOCATION" \
  --admin-user "$PG_ADMIN" --admin-password "$PG_PASSWORD" \
  --tier Burstable --sku-name Standard_B1ms --version 16 \
  --database-name "$PG_DB" --yes -o none
# Allow other Azure services (Container Apps) to reach Postgres.
az postgres flexible-server firewall-rule create \
  -g "$RG" -n "$PG_SERVER" --rule-name AllowAzure \
  --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0 -o none

echo "==> Redis cache: $REDIS_NAME (this can take ~20 minutes)…"
az redis create -g "$RG" -n "$REDIS_NAME" -l "$LOCATION" \
  --sku Basic --vm-size c0 -o none
REDIS_KEY="$(az redis list-keys -g "$RG" -n "$REDIS_NAME" --query primaryKey -o tsv)"
REDIS_HOST="$REDIS_NAME.redis.cache.windows.net"

echo "==> Building image in ACR…"
az acr build -r "$ACR" -t "contextifly-backend:$IMAGE_TAG" . -o none
ACR_SERVER="$(az acr show -n "$ACR" --query loginServer -o tsv)"
ACR_USER="$(az acr credential show -n "$ACR" --query username -o tsv)"
ACR_PASS="$(az acr credential show -n "$ACR" --query 'passwords[0].value' -o tsv)"

echo "==> Container Apps environment: $APP_ENV"
az containerapp env create -g "$RG" -n "$APP_ENV" -l "$LOCATION" -o none

DATABASE_URL="postgresql://$PG_ADMIN:$PG_PASSWORD@$PG_SERVER.postgres.database.azure.com:5432/$PG_DB?sslmode=require"
REDIS_URL="rediss://:$REDIS_KEY@$REDIS_HOST:6380"

echo "==> Deploying app: $APP_NAME"
az containerapp create \
  -g "$RG" -n "$APP_NAME" --environment "$APP_ENV" \
  --image "$ACR_SERVER/contextifly-backend:$IMAGE_TAG" \
  --registry-server "$ACR_SERVER" \
  --registry-username "$ACR_USER" --registry-password "$ACR_PASS" \
  --target-port 3000 --ingress external \
  --min-replicas "$MIN_REPLICAS" --max-replicas "$MAX_REPLICAS" \
  --secrets \
     db-url="$DATABASE_URL" \
     redis-url="$REDIS_URL" \
     llm-key="$LLM_API_KEY" \
  --env-vars \
     NODE_ENV=production \
     DATABASE_URL=secretref:db-url \
     DATABASE_SSL=true \
     REDIS_URL=secretref:redis-url \
     LLM_PROVIDER="$LLM_PROVIDER" \
     LLM_API_KEY=secretref:llm-key \
     LLM_MODEL="$LLM_MODEL" \
     LLM_BASE_URL="$LLM_BASE_URL" \
  -o none

URL="https://$(az containerapp show -g "$RG" -n "$APP_NAME" --query properties.configuration.ingress.fqdn -o tsv)"
echo ""
echo "==> Done. Backend URL: $URL"
echo "    Health check:    $URL/health"
echo "    Set this as the plugin's default backend_url to ship to users."
