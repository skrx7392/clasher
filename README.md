# Clasher

Clash of Clans clan-management toolkit: clan registration (leader/co-leader verified), war & Clan War League (CWL) tracking, rule-based random giveaways, and a configurable CWL player ranking. Target: `clasher.skpodduturi.dev`.

> **Status:** planning complete & review-hardened; implementation (M0 — Foundation) next.

## Docs

- [ANALYSIS.md](ANALYSIS.md) — Clash of Clans API feasibility & verified constraints
- [REQUIREMENTS.md](REQUIREMENTS.md) — numbered functional / non-functional requirements
- [DESIGN.md](DESIGN.md) — architecture, data model, engines, deployment, milestones

## Stack (planned)

Next.js (web) · NestJS + a dedicated `coc-gateway` (api) · Postgres · Redis / BullMQ · self-hosted k3s.
Historical war/CWL data via the community **[ClashKing](https://clashk.ing)** API (ingest-and-own); live + identity via the official Supercell API.

## Repository layout

This is a [pnpm workspace](https://pnpm.io/workspaces) monorepo.

```
apps/
  web/           Next.js front-end                (issue #3)
  api/           NestJS API                       (issue #2)
  coc-gateway/   CoC gateway service              (issue #4)
packages/
  shared/        @clasher/shared — cross-cutting constants & value types
deploy/
  k8s/           Kubernetes manifests for quasar  (issues #6–#10, #13)
```

`packages/shared` is the single source of truth for cross-cutting constants —
notably the CoC tag allowlist regex that backs the SSRF guard (DESIGN §4). Apps
consume it via the workspace protocol: `"@clasher/shared": "workspace:*"`.

## Development

Prerequisites: **Node 24** (see `.nvmrc`) and **pnpm 11** (`corepack enable`).

```bash
pnpm install        # resolve all workspaces
pnpm build          # build every package (tsc project refs)
pnpm typecheck      # strict type-check across the workspace
pnpm lint           # ESLint (flat config + typescript-eslint)
pnpm format         # Prettier --write
pnpm test           # run package test suites (vitest; e.g. packages/shared)
```

Everything is in-repo and rebuildable on a fresh host (NFR-2) — no external
bootstrap steps beyond Node + pnpm.

## Attribution

- Historical war/CWL data: **ClashKing** (clashk.ing).
- CWL ranking algorithm inspired by **[cwlranking.vercel.app](https://cwlranking.vercel.app)**.
- This material is unofficial and is not endorsed by Supercell. For more information see [Supercell's Fan Content Policy](https://supercell.com/en/fan-content-policy/).
