# syntax=docker/dockerfile:1
#
# Multi-stage build for @clasher/api. BUILD CONTEXT MUST BE THE REPO ROOT so the
# pnpm workspace and packages/shared are available:
#   docker build -f apps/api/Dockerfile -t clasher-api .

# ---- deps: fetch the whole workspace's deps from the lockfile only ----
FROM node:24-slim AS deps
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
# Copy the lockfile + root manifest/workspace so (a) corepack pins the exact pnpm
# from packageManager before any pnpm command (reproducibility, NFR-2) and (b)
# `pnpm fetch` caches on dependencies, robust to new workspace packages later
# (no per-app package.json needed — avoids the per-manifest-copy trap).
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
RUN pnpm fetch

# ---- builder: offline install + build shared then api, then prune to prod ----
FROM deps AS builder
WORKDIR /repo
COPY . .
# Offline install from the fetched store; pnpm-workspace.yaml (now copied) carries
# allowBuilds so esbuild's script is permitted instead of erroring.
RUN pnpm install --frozen-lockfile --offline
RUN pnpm --filter @clasher/shared build \
 && pnpm --filter @clasher/api build
# Self-contained prod deployment: prod deps + the api's dist, with the workspace
# dependency (@clasher/shared) hard-copied in. `--legacy` is required since pnpm
# v10 refuses to deploy non-injected workspaces by default.
RUN pnpm --filter @clasher/api --prod --legacy deploy /app

# ---- runner ----
FROM node:24-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
# `node` user ships in the official image (uid 1000); run unprivileged.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
