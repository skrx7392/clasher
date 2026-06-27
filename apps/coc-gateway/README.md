# @clasher/coc-gateway

A **separate, internal-only** service that is the sole holder of the official
Clash of Clans API key and the only egress to the RoyaleAPI proxy. Deployed on
its own (not a module of `apps/api`) so the key's blast radius is one pod
(DESIGN §1/§9, NFR-11).

## Invariants (do not regress)

- **Official key lives only here** (`COC_API_KEY`, required — fails loud if missing).
- **Only this service egresses** to the proxy `COC_PROXY_BASE_URL`
  (default `https://cocproxy.royaleapi.dev/v1`, whitelist `45.79.218.79`) — never
  `api.clashofclans.com` directly in the pilot.
- **verifytoken tokens are never persisted and are redacted from all logs** — the
  `RedactingLogger` deep-redacts any `token`/credential key before emitting
  (NFR-11, FR-4). Proven by `redact` + `redacting.logger` specs.
- ~10 req/s throttle (`COC_MAX_RPS`) on outbound calls (stubbed until M2).

## Surface (skeleton)

- `GET /health` → 200 (liveness).
- `POST /internal/verifytoken` → 501 (placeholder; M1).
- `GET /internal/clan/:tag` → 400 on an invalid tag (SSRF guard via
  `@clasher/shared`), else 501 (placeholder; M2).

Live proxy calls, the real token-bucket limiter, and key rotation land in M1/M2
on the `TokenPool` / `RateLimiter` seams in `src/coc/`.

## Develop

```bash
pnpm --filter @clasher/coc-gateway build
pnpm --filter @clasher/coc-gateway typecheck
pnpm --filter @clasher/coc-gateway test
COC_API_KEY=... pnpm --filter @clasher/coc-gateway start   # node dist/main.js (:3100)
```

## Image

`apps/coc-gateway/Dockerfile` (multi-stage, non-root) — **build from the repo root**:

```bash
docker build -f apps/coc-gateway/Dockerfile -t clasher-coc-gateway .
```
