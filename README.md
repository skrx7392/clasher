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

## Attribution
- Historical war/CWL data: **ClashKing** (clashk.ing).
- CWL ranking algorithm inspired by **[cwlranking.vercel.app](https://cwlranking.vercel.app)**.
- This material is unofficial and is not endorsed by Supercell. For more information see [Supercell's Fan Content Policy](https://supercell.com/en/fan-content-policy/).
