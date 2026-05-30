# syntax=docker/dockerfile:1

# ---- Builder: install workspace, build shared + backend, prune to prod ----
FROM node:20-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# Copy workspace manifests first for better layer caching.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY packages/vscode-extension/package.json packages/vscode-extension/

RUN pnpm install --frozen-lockfile

# Build only what the backend needs (shared + backend).
COPY packages/shared packages/shared
COPY packages/backend packages/backend
RUN pnpm --filter @contextify/shared --filter @contextify/backend run build

# Produce a self-contained deploy dir (real node_modules, no symlinks).
RUN pnpm --filter=@contextify/backend deploy --prod /app/deploy

# ---- Runner: minimal image that just runs the built backend ----
FROM node:20-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app/deploy ./

# Uploads are written here; mount a volume (e.g. Azure Files) for multi-replica.
RUN mkdir -p /app/uploads
ENV UPLOAD_DIR=/app/uploads
ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/main.js"]
