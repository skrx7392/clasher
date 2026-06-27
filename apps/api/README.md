# @clasher/api

NestJS service exposing the Clasher REST surface under `/api` (DESIGN §8).

## Layout

- `src/main.ts` — bootstrap; sets the global `/api` prefix, reads the validated port.
- `src/app.module.ts` — wires the global config module + feature modules.
- `src/config/env.schema.ts` — zod env contract; **fails loud** on misconfig (NFR-6).
- `src/health/` — `GET /api/health` (liveness) and `GET /api/ready` (readiness).
- `src/{auth,identity,clans,war,ingest,giveaways,ranking}/` — feature-module
  skeletons (DESIGN §2), filled in across M1–M4.

## Important constraint

The official Clash of Clans API key **never lives here** — it is isolated in the
separate `coc-gateway` service (DESIGN §1/§9). This service holds no upstream CoC
credentials.

## Develop

```bash
pnpm --filter @clasher/api build       # tsc -> dist
pnpm --filter @clasher/api typecheck
pnpm --filter @clasher/api test        # jest (unit + e2e health)
DATABASE_URL=... REDIS_QUEUE_URL=... REDIS_CACHE_URL=... \
  pnpm --filter @clasher/api start     # node dist/main.js
```

Required env: `DATABASE_URL`, `REDIS_QUEUE_URL`, `REDIS_CACHE_URL` (optional `PORT`,
default 3000; `NODE_ENV`). Missing/invalid values abort startup with an actionable error.

## Image

`apps/api/Dockerfile` is multi-stage + non-root; **build from the repo root**:

```bash
docker build -f apps/api/Dockerfile -t clasher-api .
```
