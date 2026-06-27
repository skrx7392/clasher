# syntax=docker/dockerfile:1
#
# Multi-stage build for @clasher/api. BUILD CONTEXT MUST BE THE REPO ROOT so the
# pnpm workspace and packages/shared are available:
#   docker build -f apps/api/Dockerfile -t clasher-api .

# ---- builder ----
FROM node:24-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

# Manifests first for better layer caching.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile

# Sources, then build shared before the api.
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @clasher/shared build \
 && pnpm --filter @clasher/api build

# Produce a self-contained production deployment (prod deps + built dist only).
RUN pnpm --filter @clasher/api --prod deploy /app

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
