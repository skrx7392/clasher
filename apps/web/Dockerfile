# syntax=docker/dockerfile:1
#
# Multi-stage build for @clasher/web (Next.js standalone). BUILD CONTEXT MUST BE
# THE REPO ROOT:
#   docker build -f apps/web/Dockerfile -t clasher-web .

# ---- deps: fetch the whole workspace's deps from the lockfile only ----
FROM node:24-slim AS deps
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml ./
RUN pnpm fetch

# ---- builder: offline install + build shared then web ----
FROM deps AS builder
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN pnpm install --frozen-lockfile --offline
RUN pnpm --filter @clasher/shared build \
 && pnpm --filter @clasher/web build

# ---- runner: minimal Next standalone server ----
FROM node:24-slim AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
# Standalone output is traced from the monorepo root (outputFileTracingRoot), so
# it preserves the apps/web/ path layout and includes @clasher/shared.
COPY --from=builder --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
