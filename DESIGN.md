# Clasher — Design / Architecture

> Companion to `REQUIREMENTS.md` (what) and `ANALYSIS.md` (API feasibility). This is the **how**.
> Stack/infra mirror the user's quasar conventions (allpets/local-ai). Posture: **Option A (lean hybrid)**.
> Status: **DRAFT v0.2** — incorporates the 5-lens adversarial design review (resolutions in §0).

---

## 0. Changelog — v0.2 (design-review resolutions)
Blockers/majors fixed in this revision:
- **Per-attack granularity** added (`member_war_attacks`) — v0.1's single `opponent_th`/`stars` per (war,player) couldn't represent a regular war's 2 attacks (broke FR-20 + TH-up). (§3)
- **Fairness hardening** — absence rules (8b/8d) are now **tri-state evaluable** (partial coverage ⇒ *inconclusive*, never silently satisfied); per-war **clamped missed**; 8e redefined; **single-shot draw** with server-side CSPRNG seed + canonical ordering + versioned PRNG + weighted **without-replacement**; scope intersected with tracking coverage. (§3,§6)
- **Blast radius** — Clasher no longer edits the shared `cloudflare-ddns` configmap; runs its **own scoped DDNS updater**. Default-deny **NetworkPolicies** + scoped **RBAC** added. (§9,§10)
- **Backups** — off-node, encrypted pg_dump + **restore drill pulled into the pilot** (was M5). (§9)
- **Authorization** — explicit default-deny ownership guard binding caller→registered clan/owned giveaway; UUID giveaway ids; admin bootstrap out-of-band. (§10)
- **coc-gateway is a separate deployment** (real key isolation), sole egress to the proxy. (§1,§9)
- **First-party safety-net capture** — the live official war we already fetch is persisted at `warEnded` (`source=first_party`) so a ClashKing gap isn't an irrecoverable hole. (§4)
- **Live CWL path** (official `leaguegroup` + `clanwarleagues/wars`) added for FR-17. (§4,§8)
- Plus: FR-9 deregistration, FR-7 role-loss enforcement, FR-8 ongoing private-log detection, FR-14 singleton-persons, Supercell disclaimer, verifytoken log redaction, CSRF, tag-input allowlist, Redis cache/queue split. (§3–§10)

---

## 1. Architecture at a glance
**Hybrid "ingest-and-own" (Option A).**
- **ClashKing API** (`api.clashk.ing`, free, no-auth, GPL-3.0, attribution required) = **primary historical/analytics source**, cached-through into Clasher's Postgres before any feature reads it. Solves cold-start backfill.
- **Official CoC API** (via `coc-gateway` → RoyaleAPI proxy) = **live + identity**: `verifytoken`, registration roster/roles, live current-war, live CWL (`leaguegroup`+`clanwarleagues/wars`), and a **best-effort first-party settled-war capture** (safety net).
- **Postgres = system of record.** Scoped guarantee: **no third-party call sits in the request path for settled/historical war views, rankings, or draws.** (The live current-war/CWL and roster views are deliberate official, short-TTL-cached reads that degrade to "live view unavailable" while history still serves.)

```
 Browser ─https─► Next.js (clasher.skpodduturi.dev)  /api →
                     ▼
                 NestJS API ───────────────► Postgres (system of record) ◄── off-node encrypted pg_dump
                     │ enqueue                   ▲
                     ▼                           │ ingest-and-own (validating adapter; raw kept per source)
              BullMQ workers (queue-Redis) ──────┤
                   ├─ clashking-client ──────────┘  (direct; public; honor 5-min cache; kill-switch)
                   └─► coc-gateway (SEPARATE pod, holds official key) ─► RoyaleAPI proxy ─► api.clashofclans.com
                 cache-Redis (short-TTL, separate from queue-Redis)
```
**coc-gateway is a standalone deployment** — the only component with the official key; the only pod allowed (NetworkPolicy) to egress to the proxy IP. All official calls route through it.

**Known top risk (tracked):** the official path is a single no-SLA dependency (RoyaleAPI proxy sees the Bearer key; key is IP-bound; homelab IP dynamic). Mitigation roadmap: self-hosted fixed-IP egress; key rotation + anomaly alerts; onboarding failures degrade with actionable messages.

---

## 2. Tech stack
- **Frontend:** React + **Next.js** (TS), **Auth.js** Google provider (`AUTH_SECRET` scoped to `clasher-frontend`).
- **Backend:** **NestJS** (TS) modules: `auth`, `identity`, `clans`, `war`, `ingest`, `giveaways`, `ranking`; `@nestjs/schedule` + **BullMQ**. **`coc-gateway` = separate deployment** (official key isolation).
- **Data:** **Postgres** (system of record; `jsonb` raw + normalized). **Two Redis roles:** queue-Redis (`noeviction`, AOF, PVC) and cache-Redis (bounded, LRU) — separated so cache eviction can't drop capture jobs.
- **Repo:** monorepo under `skrx7392` (`apps/web`, `apps/api`, `apps/coc-gateway`, `packages/shared`, `deploy/k8s`).

---

## 3. Data model (Postgres — illustrative DDL)

```sql
-- Identity ----------------------------------------------------------------
users(id uuid pk, google_sub uniq, email, name, role text default 'none'
      check in('none','manager','admin'), created_at)        -- role NOT self-settable; admin seeded out-of-band
account_ownership(user_id fk, player_tag, verified_at, revalidate_after)  -- token NEVER stored
accounts(player_tag pk, name, th_level int, last_synced_at, raw_json jsonb)
persons(id uuid pk, label, created_by fk)
person_accounts(person_id fk, player_tag, UNIQUE(player_tag))  -- an account belongs to ≤1 person (partition)

-- Clans -------------------------------------------------------------------
clans(clan_tag pk, name, war_log_public bool, trackable bool, war_league,
      status text check in('active','flagged','deregistered'), last_synced_at, raw_json jsonb)
clan_registrations(id uuid pk, clan_tag fk, user_id fk, verified_player_tag,
                   role_at_registration, status text check in('active','role_lost','revoked'),
                   created_at, last_revalidated_at)

-- Raw capture (multi-source, reconcilable) --------------------------------
war_snapshots(id uuid pk, war_identity, source text check in('clashking','official','first_party'),
              clan_tag, war_type text check in('regular','cwl'), season text null,
              round_index int null, war_tag text null,        -- CWL ordering/addressing
              state text, end_time timestamptz, fetched_at, schema_version int, raw_json jsonb,
              UNIQUE(war_identity, source))                    -- keep BOTH sources' raw for reconciliation
-- war_identity = hash( sort(clanTagA,clanTagB) || canonicalUtc(endTime) || war_type )  -- order- & format-stable
cwl_seasons(clan_tag, season, group_json jsonb, state, source, fetched_at, primary key(clan_tag,season))
warlog_entries(clan_tag, war_identity null, end_time, result, stars, destruction,
               opponent_tag null, war_type, source, primary key(clan_tag,end_time))  -- FR-16 + gap oracle
tracking_coverage(clan_tag, source, war_type, earliest_observed, primary key(clan_tag,source,war_type))

-- Derived analytics (read model) ------------------------------------------
member_war_attacks(war_identity, source, attacker_tag, attack_order int,    -- PER-ATTACK (regular = up to 2)
                   defender_tag, defender_th int, stars int, new_stars int, destruction numeric,
                   primary key(war_identity, source, attacker_tag, attack_order))
member_war_stats(clan_tag, player_tag, war_type, season null, war_identity, end_time,
                 th_level int, fielded bool, attacks_made int, attacks_allowed int,  -- allowed READ from attacksPerMember
                 missed int,                       -- clamped: Σ max(0, allowed − min(made,allowed))
                 stars int, gained_stars int, stars_conceded int,  -- conceded = bestOpponentAttack?.stars ?? 0
                 partial bool, primary key(war_identity, player_tag))
-- indexes: member_war_stats(clan_tag,war_type,end_time), (clan_tag,season), (player_tag);
--          war_snapshots(clan_tag,war_type,end_time)

-- Giveaways ---------------------------------------------------------------
giveaways(id uuid pk, clan_tag fk, created_by fk, entity_granularity text, person_mode text, -- explicit (D-3)
          scope_cwl_season text null, scope_war_start timestamptz null, scope_war_end timestamptz null,
          num_winners int check (num_winners>=1), status text check in('open','frozen','drawn'), created_at)
giveaway_rules(giveaway_id fk, rule_code text, weight int check (weight>=0))
giveaway_entries(giveaway_id fk, entity_key, entity_type, entries int,
                 breakdown_json jsonb, evaluable_json jsonb, partial_coverage bool, covered_span_json jsonb)
giveaway_draws(giveaway_id fk uniq, seed text, prng text, prng_version text,   -- single-shot (uniq)
               canonical_order text, drawn_at, winners_json jsonb, dataset_fingerprint text)
giveaway_winners(id uuid pk, giveaway_id fk, clan_tag, entity_key, entity_type, drawn_at)  -- clan-scoped history
ranking_configs(id uuid pk, clan_tag fk, name, weights_json jsonb)
```
Key derivation rules:
- **war_identity canonical**: sorted clan tags + endTime normalized to a UTC instant (NFR-12) + war_type → same war from any source/perspective collapses; raw kept per `source`.
- **member_war_stats derived ONLY from the most-complete `state=warEnded` snapshot** per `war_identity` (never prep/inWar → no false misses).
- **`new_stars`/`gained_stars`**: group attacks by `defender_tag`, sort by `order`, `new = max(0, stars − best_prior)`; `order` must be preserved in raw.
- **opponent TH** comes from `member_war_attacks.defender_th` (mapped via `defender_tag` → opponent member TH).

---

## 4. Data ingestion (ingest-and-own)
**Boundary:** all external JSON → strict zod adapter → internal schema; unexpected shape ⇒ **quarantine + fail-loud + alert** (never coerce). Raw kept per source (NFR-7). **Tag inputs validated** against `^#[0289PYLQGRJCUV]{3,15}$` (length-bounded — real tags are ≤~10 chars; canonicalize `%23`→`#`) before any outbound URL — prevents SSRF/path injection and oversized-path abuse. Defined once in `@clasher/shared` (`COC_TAG_REGEX`).

**Jobs (BullMQ on queue-Redis):**
1. **Backfill-on-registration** — ClashKing `/war/{tag}/previous` (paged) + `/cwl/{tag}/{season}` per available season → `war_snapshots`/`warlog_entries`/`cwl_seasons` → derive. Set `tracking_coverage`.
2. **Periodic settled sync** — recently-ended wars + current CWL season from ClashKing. **Honor `max-age=300` as a hard refetch floor**; off-peak batched; backoff; identifying UA+contact; Cloudflare-challenge ⇒ circuit-break. (Default cadence conservative; closes D-2.)
3. **Live official reads** (via coc-gateway, short cache, **restricted to clans the caller owns**, per-user rate-limited): current-war (FR-15), live CWL `leaguegroup`+`clanwarleagues/wars/{warTag}` (FR-17), roster/roles (FR-10).
4. **First-party safety-net capture** — when (3) observes a war/round at `warEnded`, persist that official payload as `source='first_party'` (we already hold it) → closes the ephemeral-data gap if ClashKing missed it.
5. **Reconciliation** (lightweight at launch) — where `clashking` and `first_party`/`official` raw exist for one `war_identity`, compare per-member counts; flag/quarantine mismatches; **block draws on unreconciled scoped wars**.
6. **Coverage-gap detector** — using `warlog_entries` as the oracle of expected wars, flag interior gaps per clan/source/war_type; feeds `partial_coverage` + alerts.

`coc-gateway`: token pool, ≤10 req/s throttle, `Cache-Control`-aware, 429 backoff, 503 circuit-break, **403-invalidIp alert**, verifytoken bodies **redacted from logs**.

---

## 5. Identity, registration, lifecycle
1. Google OAuth sign-in → `users` (default `role='none'`, least privilege; role never self-settable; first admin seeded out-of-band).
2. **Ownership proof:** paste in-game token → coc-gateway `verifytoken` → `account_ownership` (token redacted in logs, never stored; `revalidate_after` set for periodic re-proof — handles account transfer).
3. **Register clan:** live authoritative `GET /clans/{tag}` → require verified account `role ∈ {leader,coLeader}` + tag match → `clan_registrations` + clan→`manager` for the user; reject if `isWarLogPublic=false`; kick off backfill.
4. **Re-validation job:** re-checks role **and** `isWarLogPublic`. Role lost → `clan_registrations.status='role_lost'`; clan flips to `status='flagged'` **only when no active registrant holds leader/coLeader**; flagged ⇒ API guard blocks *new* giveaways/rankings; already-frozen giveaways remain drawable; data retained. War log gone private ⇒ `trackable=false` + actionable UI (FR-8/AC-2).
5. **Deregister (FR-9):** `DELETE /api/clans/:tag` (owner/admin) → `status='deregistered'`, stop sync; **history retained by default** (consistent with FR-7), with an explicit purge option.
6. **Admin linking:** map accounts → `persons` (`UNIQUE(player_tag)` enforced). Unlinked accounts resolve as **synthetic singleton persons** in person-mode (FR-14).

---

## 6. Giveaway engine
- **Entity universe (explicit):** the clan's registered accounts/persons **∪** entities with ≥1 fielded row in scope (includes departed participants); persisted in the frozen pool. 8a base entry applies to this universe (LEFT JOIN scoped stats).
- **Scope** intersected with `tracking_coverage` + gap detector at freeze; uncovered span surfaced and recorded in `covered_span_json`; date range is **UTC-inclusive**.
- **Rules → entries (additive), evaluated once per entity:**
  - **8a** base: every eligible entity (exactly one base entry, whether 1 or 5 linked accounts).
  - **8b** no missed regular attacks: requires ≥1 fielded regular war in scope; `Σ clamped_missed == 0`; **tri-state** — if any fielded scoped war lacks a settled complete snapshot ⇒ **inconclusive** (withheld, flagged), not satisfied.
  - **8c** participated in CWL: fielded ≥1 round (season).
  - **8d** no missed CWL attacks: requires ≥1 fielded round; clamped; tri-state as 8b.
  - **8e** max CWL stars: `fielded_rounds≥1 AND attacks_made==fielded_rounds AND Σstars==3×attacks_made` (raw stars, not gained).
- **Person mode (per giveaway, explicit):** participation rules (8c) use **any** regardless of toggle; absence/quality rules (8b/8d/8e) use the chosen **all/any**; under **all**, only accounts with *evaluable* data count (non-participants can't trivially satisfy strictness).
- **Anomaly guard:** `attacks_made > attacks_allowed` ⇒ data anomaly → quarantine/fail-loud (not netted out).
- **Draw (fairness-critical, single-shot):**
  - `status: open→frozen→drawn`, **immutable**; `/draw` rejects if already `drawn`.
  - **Seed generated server-side (CSPRNG) at draw time** (never client-supplied); optional commit-reveal (hash at freeze).
  - **Deterministic replay:** entries sorted by canonical key (`entity_key`) → pinned **versioned PRNG** seeded by `seed` → **weighted sampling without replacement** for `num_winners` (an entity wins ≤1 slot). `dataset_fingerprint` verified on replay (AC-5). `1 ≤ num_winners ≤ pool`.
  - **No external call in the draw path**; draw runs only on frozen `giveaway_entries`. Blocked (not run on partial data) if any pooled entity has an inconclusive absence-rule or unreconciled scoped war.
  - Audit ("show your work"): per-entity `breakdown_json` + `evaluable_json`; winners keyed by stable `entity_key` (names resolved at render).

---

## 7. CWL ranking engine
Reads `member_war_attacks` + `member_war_stats` for the season. Per fielded round r:
```
attack_r  = Σ attacks [ W_star·stars + W_thUp·max(0, defender_th − attacker_th) (+ W_dest·dest%) ]
defense_r = − W_def·stars_conceded            // stars_conceded = bestOpponentAttack?.stars ?? 0
miss_r    = − W_miss·(expected − made)         // expected = 1 (CWL)
raw_r     = attack_r + defense_r + miss_r
norm_r    = normalize(raw_r across players in round r)    // per-war equal weight, toggle
score(p)  = Σ_r norm_r
```
- Weights from `ranking_configs`; change ⇒ recompute. **TH delta from war data** (per-attack `defender_th`). Defense = stars conceded (not player `defenseWins`).
- UI: per-component **breakdown** (FR-43) + **credit cwlranking.vercel.app** (FR-44). Same engine ranks regular wars (FR-45) using `member_war_attacks`.

---

## 8. API surface (REST under `/api`) — all `/clans/:tag/*` & `/giveaways/:id/*` behind the ownership guard (§10)
```
POST /api/auth/*                         Auth.js (Google)
POST /api/accounts/verify                verifytoken (per-user rate-limited; body redacted)
GET  /api/accounts                       my owned accounts
POST /api/clans                          register clan (role gate)
GET  /api/clans                          my clans
DELETE /api/clans/:tag                   deregister (owner/admin)              [FR-9]
GET  /api/clans/:tag/members             live roster (official, owned-only)
GET  /api/clans/:tag/war                 live current war (official, cached)
GET  /api/clans/:tag/cwl/live            live CWL (official leaguegroup+wars)  [FR-17]
GET  /api/clans/:tag/warlog              history (owned store)
GET  /api/clans/:tag/cwl/:season         CWL season (owned store)
GET  /api/clans/:tag/cwl/:season/ranking?config=
CRUD /api/clans/:tag/ranking-configs
POST /api/clans/:tag/giveaways           create
GET  /api/giveaways/:id                  pool + entries (frozen)               (uuid id)
POST /api/giveaways/:id/draw             draw (single-shot, frozen pool)
GET  /api/giveaways/:id/winners          result
GET  /api/clans/:tag/giveaways/winners   clan-scoped winners history           [FR-29/FR-30]
ADMIN /api/admin/persons*                account↔person linking (admin only)
```

---

## 9. Deployment (quasar k3s)
- **Namespaces:** `clasher-frontend|backend|database`, `app.kubernetes.io/part-of: clasher`. **Requests+limits on every pod**; **default-deny NetworkPolicies** (Postgres reachable only from backend; only `coc-gateway` has external egress, restricted to 443 toward the Cloudflare-fronted RoyaleAPI proxy `cocproxy.royaleapi.dev` — note `45.79.218.79` is the *key-allowlist* IP for the CoC portal, not the connect target; deny cross-namespace ingress) — protects co-tenants (Aarogya do-not-touch). **RBAC/ServiceAccounts scoped to `clasher-*`**; enable k3s **secrets encryption-at-rest**.
- **Ingress:** Traefik, host `clasher.skpodduturi.dev` (frontend `/`, API `/api`), HTTPS-redirect middleware.
- **DNS (no shared edits):** Clasher runs its **own scoped DDNS updater** (CronJob/external-dns in a clasher namespace, own Cloudflare-token Secret) maintaining only `clasher.skpodduturi.dev`. **Does not touch the shared `cloudflare-ddns` configmap** (NFR-4).
- **TLS:** cert-manager `letsencrypt-cloudflare` (DNS-01), secret `clasher-skpodduturi-dev-tls`.
- **Storage/backups:** `local-path` PVC for Postgres; **pg_dump to off-node/offsite, encrypted, retained**, + WAL/more-frequent dumps to cut RPO; **restore drill in the pilot**. Pre-migration off-node dump; **expand/contract reversible migrations** only.
- **Secrets:** GitHub repo secrets → k8s Secrets via `--from-env-file` (masked; not on argv); inventory = CoC key, Google client secret, `AUTH_SECRET`, DB creds, Cloudflare token, Tailscale auth, GHCR pull. In-repo **bootstrap runbook** lists provisioning order (NFR-2).
- **CI/CD:** Actions → GHCR (`ghcr.io/skrx7392/clasher-*:<sha>`, private + pull secret) → Tailscale (**ephemeral tagged** key, ACL-scoped) → `ssh sk@quasar` → `kubectl` via a **deploy ServiceAccount scoped to `clasher-*` (not cluster-admin)`; migrations gate before SHA-pinned image roll. **Actions pinned to commit SHAs, minimal `permissions:`, deploy job behind a GitHub Environment with reviewer.**
- **Egress:** coc-gateway → RoyaleAPI proxy (whitelist `45.79.218.79` on the prod key); ClashKing direct.

---

## 10. Security, privacy, compliance
- **Authorization (default-deny):** mandatory guard resolves `:tag`→active `clan_registration` owned by caller (or `admin`), and `:id`→`giveaway.clan_tag`→owned; **UUID** ids (no enumeration). Admin = superset (explicit policy). Role never self-settable; admin seeded out-of-band.
- **Secrets:** official key only in the separate `coc-gateway` pod (real process isolation), NetworkPolicy-restricted egress; never client-side; **treat the key as visible to RoyaleAPI** → rotation plan + anomaly/quota alerts + self-egress migration tracked. `clashofclans.js` pinned + lockfile + Dependabot (or thin first-party wrapper for the ~5 endpoints).
- **verifytoken:** never persisted; **redacted** from logs/traces/error capture (asserted by test).
- **Web:** CSRF protection (SameSite=Strict + origin checks / double-submit) on all unsafe methods; Auth.js cookies HttpOnly+Secure+SameSite.
- **Input/abuse:** tag allowlist regex (§4); giveaway param bounds; per-user rate limits on official-key-backed lookups + verify; single-shot draw (anti-grind).
- **Privacy/PII:** store minimal Google fields (`sub`; email only if needed); **privacy notice + retention + erasure/export path** for the user identity; deregistration data fate documented; encrypted backups (contain PII).
- **Compliance:** Supercell **Fan Content Policy** — UI **"not affiliated with Supercell" disclaimer + attribution**, no prohibited monetization; **credit ClashKing** (data) + **cwlranking.vercel.app** (ranking); confirm ClashKing API ToS + RoyaleAPI proxy AUP permit this use.
- **Reliability:** per-source **runtime kill-switch** (instant, DB/Redis flag) with defined degraded UX; **fail-loud alerting** (Alertmanager rules + target) for quarantine, 403-invalidIp, circuit-open, kill-switch, capture-gap; fail-loud on misconfig, degrade-gracefully on transient upstream (NFR-6).
- **Reproducibility:** everything in-repo (kustomize, migrations, CI/CD) + bootstrap runbook ⇒ rebuildable on a fresh host (NFR-2).
- **Supply-chain integrity:** strict TLS to `api.clashk.ing`; provenance (`source`) surfaced on giveaway pools; SHA-pinned images (optionally cosign-signed + scanned).

---

## 11. Milestones (pilot — Option A)
- **M0 Foundation:** monorepo, NestJS+Next.js, **separate coc-gateway**, split Redis, Postgres + **off-node backups & restore drill**, namespaces + **NetworkPolicies/RBAC**, scoped DDNS updater, ingress+TLS, CI/CD (pinned, scoped), Google OAuth + roles.
- **M1 Identity & registration:** verifytoken (redacted), role-gated registration, deregistration, re-validation (role + private-log), roster.
- **M2 Data plane:** clashking-client + ingest-and-own (backfill + settled sync), coc-gateway live war/CWL, first-party safety-net capture, coverage-gap detector, `member_war_attacks`/`member_war_stats` derivation.
- **M3 Giveaways:** entity-universe resolution, rule engine (tri-state absence rules, clamped missed, person all/any), scope-vs-coverage gating, freeze→single-shot draw→audit, winners history.
- **M4 CWL ranking:** configurable weights, TH-delta/defense/miss/normalization, breakdown UI + cwlranking + Supercell disclaimer.
- **M5 Hardening:** own official forward poller (Posture B) + full reconciliation gate, self-hosted fixed-IP egress, observability polish.

---

## 12. Open items — all resolved (2026-06-26)
- ⟦D-1⟧ ✅ **New dedicated Google Cloud project** (user creates; will provide client ID/secret). Consent screen External + publish (`openid email profile` → no verification review); verify `skpodduturi.dev` in Search Console (DNS-TXT). *Prereq for the auth slice of M1; not for M0 scaffold.*
- ⟦D-2⟧ ✅ Conservative off-peak periodic-sync cadence honoring the 300s floor; tune in M2.
- ⟦D-3⟧ ✅ Person-mode is an explicit per-giveaway choice (no implicit default).
- ⟦D-4⟧ ✅ `ghcr.io/skrx7392/clasher-*`, **private images + pull secret** (allpets convention).
- ⟦D-5⟧ ✅ Local nightly `pg_dump` **+ push dumps off-box to the MacBook** (free; covers the irreplaceable first-party slice — registrations, giveaway seeds/results, safety-net captures). Most war/CWL history is re-derivable from ClashKing on a rebuild, so RPO ~24h is acceptable for the pilot. No paid cloud.
- ⟦D-6⟧ ✅ Commit-reveal/beacon **deferred post-pilot**; pilot uses server-side CSPRNG seed + frozen pool + replayable audit.
- ⟦D-7⟧ ✅ **ClashKing**: cache-and-reserve permitted **with visible attribution** (don't imply independent collection) + Supercell FCP compliance; no extra commercial/redistribution restriction. **RoyaleAPI proxy**: formal AUP not retrievable (docs 403); proceed under norms (own key, identifying UA + contact, no abuse, no SLA) with the self-hosted fixed-IP egress migration retained (M5) as the de-risk.
