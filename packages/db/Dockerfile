# syntax=docker/dockerfile:1
#
# Migration runner for @clasher/db (#13). This image is the CD "migration gate":
# it runs `node-pg-migrate up` against DATABASE_URL and exits 0 on success, so the
# deploy pipeline can BLOCK the SHA-pinned image roll until the schema is migrated
# (DESIGN §9, expand/contract). It runs in-cluster as a k8s Job (clasher-backend),
# reading DATABASE_URL from the `api-credentials` Secret — the DB creds never leave
# the cluster and the NetworkPolicy isolation (backend -> Postgres only) is preserved.
#
# BUILD CONTEXT MUST BE THE REPO ROOT so the pnpm workspace is available:
#   docker build -f packages/db/Dockerfile -t clasher-migrate .

# ---- deps: fetch the whole workspace's deps from the lockfile only ----
FROM node:24-slim AS deps
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
# corepack pins the exact pnpm from packageManager before any pnpm command runs
# (reproducibility, NFR-2); `pnpm fetch` caches on the lockfile alone.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
RUN pnpm fetch

# ---- builder: offline install, then prune @clasher/db to a self-contained prod tree ----
FROM deps AS builder
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --offline
# @clasher/db has no build step (migrations are plain SQL); `deploy` copies the
# package (migrations/ + scripts/) plus its prod deps (node-pg-migrate, pg).
# `--legacy` is required since pnpm v10 refuses to deploy non-injected workspaces.
RUN pnpm --filter @clasher/db --prod --legacy deploy /app

# ---- runner: node-pg-migrate CLI as an unprivileged one-shot ----
FROM node:24-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
# `node` user ships in the official image (uid 1000); run unprivileged.
COPY --from=builder --chown=node:node /app ./
USER node
# node-pg-migrate reads the connection string from DATABASE_URL (default var) and
# applies every pending migration under ./migrations. Re-running is a no-op once
# applied (the pgmigrations ledger tracks state), so the gate is safe to retry.
CMD ["node_modules/.bin/node-pg-migrate", "up", "--migrations-dir", "migrations"]
