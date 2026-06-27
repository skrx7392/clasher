# Clasher — Clash of Clans Integration: Feasibility & API Analysis

> Scope: feasibility of the stated requirements against the **official Supercell Clash of Clans API**, the API's hard constraints, whether any pub/sub exists, the CWL ranking model, and a recommended architecture for `clasher.skpodduturi.dev`.
>
> Status: **All requirements are feasible** with the official API — but three non-obvious constraints reshape the design. Read §1 first; it determines everything else.

---

## 1. The three constraints that shape the whole product

Before features, three facts about the CoC API drive the architecture. Each was independently verified against live sources and adversarially re-checked.

### 1.1 API tokens are IP-bound → you need a fixed egress IP

Every API key created at `developer.clashofclans.com` has the allowed IP address(es)/CIDR ranges **signed into the JWT** and enforced server-side. A request from any other IP returns **HTTP 403 `accessDenied` (invalidIp)**.

- Serverless / autoscaling hosts (Vercel functions, Netlify, AWS Lambda, Cloud Run, Heroku) have **rotating egress IPs and will break**.
- A key can list **multiple** IPs/CIDRs; an account is capped at **~10 keys**.
- **Fix (recommended):** route all Supercell calls through one backend with a **static egress IP** (VPS, or AWS NAT Gateway + Elastic IP / GCP Cloud NAT + reserved IP) and whitelist that IP.
- **Fix (MVP/fallback):** RoyaleAPI's free proxy — whitelist `45.79.218.79` on the key and call `https://cocproxy.royaleapi.dev/v1/...` instead of `https://api.clashofclans.com/v1/...`. Third-party, no SLA; fine for prototyping, not a sole production dependency.
- **Anti-pattern:** dynamic key rotation via the portal login API. Works for a single long-lived worker only; races on the 10-key cap and risks abuse flags under multi-instance/serverless.

> **Implication:** all CoC traffic funnels through one fixed-IP backend service. The web frontend on the subdomain never calls Supercell directly.

### 1.2 No webhooks / pub-sub → everything is poll-and-diff

The official API is **100% poll-only REST**. There are **no webhooks, push notifications, SSE, websockets, or subscriptions** of any kind. Confirmed by maintainers directly: ClashPerk's FAQ ("no push/webhook system"); `clashofclans.js` deprecated its own poller telling users to "implement your own custom polling system."

- "War started", "war ending soon", "war ended", "member joined/left" are **derived client-side** by polling and comparing snapshots (war via the explicit `state` field; "ending soon" via arithmetic on `endTime`).
- In-game mobile push (APNs/FCM) is internal to Supercell and **not exposed**.
- Inherent limitation to accept: short-lived changes that revert between polls (leave-then-rejoin) can be missed; events can lag by one poll cycle.

> **Implication:** the product needs a **scheduler + polling workers + a snapshot store** as first-class components, not an afterthought.

### 1.3 War attack history is ephemeral → snapshotting _is_ the product

This is the single most important design fact.

- `GET /clans/{tag}/warlog` returns **clan-level summaries only** — no per-member attack data. You **cannot** tell whether a specific player missed attacks from the war log.
- Per-member attacks exist **only** in `GET /clans/{tag}/currentwar` (and the CWL per-round war), and **only** while `state` is `inWar` or `warEnded`. **Once the next war's preparation begins, the previous war's per-member detail is gone forever** — there is no historical endpoint.
- CWL nuance (verified correction): individual round wars at `/clanwarleagues/wars/{warTag}` remain fetchable for a window **if you saved the war tags**, but the `leaguegroup` listing that _gives_ you those tags only exists **during the active CWL**, and war tags are recycled across seasons. Net effect is the same: **you must capture it live.**

> **Implication:** rules 8b–8e and the CWL ranking can only be computed over the window during which **Clasher has been actively snapshotting** that clan. There is **no backfill** of history that pre-dates onboarding. This must be surfaced in the UX ("tracking since <date>").

---

## 2. Official API — reference summary

| Aspect     | Detail                                                                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base URL   | `https://api.clashofclans.com/v1`                                                                                                                                                      |
| Auth       | `Authorization: Bearer <JWT>` (long-lived key from `developer.clashofclans.com`)                                                                                                       |
| Tags       | `#` must be URL-encoded as `%23` (alphabet `0289PYLQGRJCUV`)                                                                                                                           |
| Rate limit | Per-token throttle, **HTTP 429 `requestThrottled`**. No official number; treat **~10 req/s/token** as safe. Scale by cycling multiple keys.                                            |
| Caching    | Responses carry `Cache-Control: max-age` (~minutes). Polling faster wastes quota.                                                                                                      |
| Errors     | 400 bad params · 403 access denied (bad token / **wrong IP** / **private war log**) · 404 not found · 429 throttled · 503 **game maintenance (whole API down)**                        |
| ToS        | Fan Content Policy: ads/donations only, no selling API-derived access, must attribute Supercell, access revocable. **Monetization of a paid product is a gray/at-risk area — see §7.** |

**Endpoints we use:**

| Need                                        | Endpoint                                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- | -------- |
| Clan info + member list & roles             | `GET /clans/{clanTag}` (embeds `memberList`) / `GET /clans/{clanTag}/members`            |
| Player profile + role + current clan        | `GET /players/{playerTag}`                                                               |
| **Prove account ownership**                 | `POST /players/{playerTag}/verifytoken` body `{"token":"<in-game token>"}` → `status: ok | invalid` |
| Regular war (per-member attacks)            | `GET /clans/{clanTag}/currentwar`                                                        |
| War history (summary only)                  | `GET /clans/{clanTag}/warlog`                                                            |
| CWL group (season, rosters, round war tags) | `GET /clans/{clanTag}/currentwar/leaguegroup`                                            |
| CWL individual round war                    | `GET /clanwarleagues/wars/{warTag}`                                                      |

Role enum (raw API): `leader`, `coLeader`, `admin` (= in-game **Elder**), `member`, `notMember`. **Check `role ∈ {leader, coLeader}` against raw values.**

---

## 3. Requirement-by-requirement feasibility

| #   | Requirement                                         | Verdict                | How / caveats                                                                                                                                                                                                                                                                                    |
| --- | --------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Register clans, only where user is leader/co-leader | ✅ Feasible            | `verifytoken` proves the user owns a player account → `GET /players/{tag}` gives `role` + `clan.tag`. Require `role ∈ {leader,coLeader}` **and** `clan.tag == clanBeingRegistered`. Always re-fetch server-side; never trust client values. Re-validate periodically (roles change; no webhook). |
| 2   | List players in their clans                         | ✅ Feasible            | `GET /clans/{tag}/members` (or `memberList`). Identify members by **tag**, not name (names change).                                                                                                                                                                                              |
| 3   | Link multiple profiles as one person                | ✅ Feasible (app-side) | No API support. Same human runs `verifytoken` for each player tag; store all verified tags under one user record. You confirmed this is **phase 2**.                                                                                                                                             |
| 4   | War log + current war (incl. CWL)                   | ✅ Feasible            | `currentwar` + `warlog` for regular; `leaguegroup` + `clanwarleagues/wars/{warTag}` for CWL. **Requires the clan's war log set to Public** (else 403). Per-member detail requires our snapshots (§1.3).                                                                                          |
| 5   | Create a random giveaway                            | ✅ Feasible            | Pure app logic over the eligible-entity pool. Use a CSPRNG; persist the random seed + entrant list for auditability/repeatability.                                                                                                                                                               |
| 6   | Store previous giveaway winners                     | ✅ Feasible            | App database. Optionally support "exclude past winners for N days" as a future rule.                                                                                                                                                                                                             |
| 7   | Select rules for a giveaway                         | ✅ Feasible            | Rules engine; each rule = a predicate/weight over an entity's tracked stats (see §4).                                                                                                                                                                                                            |
| 8   | The five launch rules                               | ✅ Feasible\*          | \*Conditioned on §1.3: only computable over the tracked window. See §4.                                                                                                                                                                                                                          |
| 9   | Account mgmt / profile linking later                | ✅ Planned             | Phase 2; verifytoken is the primitive.                                                                                                                                                                                                                                                           |
| 10  | **CWL ranking, configurable weights** (new)         | ✅ Feasible            | All inputs (stars, attacker/defender TH, defense stars conceded, misses) are in the CWL round snapshots. See §5.                                                                                                                                                                                 |

---

## 4. Giveaway rules — data sources & caveats

"Entity" = a person (requires linking, phase 2) **or** a single account. For person-level, aggregate the linked accounts' stats first.

| Rule                                         | Data source                                                                                                   | Caveats                                                                                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **8a** 1 entry per entity                    | roster / linked accounts                                                                                      | Person-level needs req #3. Account-level works at launch.                                                                                                                           |
| **8b** No missed **regular-war** attacks     | `currentwar` snapshots: `missed = attacksPerMember − (member.attacks?.length ?? 0)` summed over wars in scope | **Only over the tracked window.** Must define the **scope** (current season? last N wars? a date range?). A war the system didn't snapshot can't be judged. War log must be public. |
| **8c** Participated in CWL (≥1 round lineup) | CWL round wars: tag appears in `war.clan.members` for ≥1 round                                                | Use the **per-round fielded lineup**, not the season-eligible roster in `leaguegroup`.                                                                                              |
| **8d** No missed CWL attacks                 | CWL snapshots: for each **fielded** round, expected 1, `made = member.attacks?.length ?? 0`                   | Only count rounds the player was **fielded** (don't penalize benching). Skip `#0`/prep rounds.                                                                                      |
| **8e** Max stars from rounds participated    | CWL snapshots: `starsEarned == 3 × roundsFielded`                                                             | "Max from rounds participated" = 3★ every fielded attack.                                                                                                                           |

**Cross-cutting product decisions for rules (need your input):**

1. **Scope window** for 8b/8d/8e — a named CWL season? a calendar range? "since tracking began"? This is the biggest open question.
2. **Entity granularity at launch** — account-level only (since linking is phase 2)? Recommended: yes.
3. **Rule combination** — are rules **filters** (must pass all → 1 entry) or **weights** (each satisfied rule adds entries, raising odds)? The wording "1 entry for each…" reads as **additive weighting** (an entity can accumulate multiple entries). Confirm.

---

## 5. CWL Ranking system (new requirement)

Modeled on **[cwlranking.vercel.app](https://cwlranking.vercel.app)** (whose [FAQ](https://cwlranking.vercel.app/faqs) and open-source [precursor repo](https://github.com/matmannion/clashofclans-cwlranking) we studied). **Per your instruction, the UI must visibly credit cwlranking.vercel.app.**

### 5.1 What the reference does (extracted)

- **Attack weight 1.0, defense weight 0.3** (configurable) — attacks matter more, being "more within the player's control."
- **Missed attack penalty:** star count reduced by 1.
- **Not attacked on defense:** counts as a 0-star defense (i.e., a good thing).
- **Per-war normalization:** several normalization stages so **each war weighs equally**, regardless of opponent strength.
- From the open-source precursor, the richer mechanics it used:
  - **"Gained" (new) stars** — stars _added_ beyond what previous attacks already scored on that base (rewards real contribution, not cleanup of an already-3★ base).
  - **Position/TH weighting** — bonus for hitting harder targets. The repo used a troop/hero **`offensiveWeight`** strength proxy and a position-based `clashCaller` term; **your requirement uses the simpler, directly-available TH difference**, which we adopt.
  - **Net stars** — attack stars minus stars conceded on defense.

### 5.2 Proposed configurable formula

Every `W_*` is a clan-configurable weight (defaults shown). Inputs come straight from CWL round snapshots (`townhallLevel`, `stars`, `bestOpponentAttack.stars`, `attacks`).

For each round _r_ a player _p_ was **fielded**:

```
attack_r   =  Σ over p's attacks [ W_star · stars
                                 + W_thUp · max(0, defenderTH − attackerTH)     // hitting up
                                 − W_thDown · max(0, attackerTH − defenderTH)   // optional: hitting down
                                 + W_dest · (destruction% / 100) ]             // optional tiebreak-ish
defense_r  =  − W_def · (stars conceded on p's base)        // 0–3; lower is better
miss_r     =  − W_miss · (1 − attacksMade)                  // CWL: 1 expected per fielded round
raw_r      =  attack_r + defense_r + miss_r
norm_r     =  normalize(raw_r across all players in round r)   // per-war equal weighting
score(p)   =  Σ_r norm_r      // only rounds p was fielded
```

Defaults that reproduce the reference: `W_star=1`, `W_def=0.3`, `W_miss≈1` (penalty), star mode = **gained/new stars**, per-war normalization **on**. Your three explicitly-requested knobs map cleanly:

- **stars gained** → `W_star` (+ raw-vs-gained toggle)
- **attacking a higher TH** → `W_thUp` (× TH delta)
- **defense wins / stars conceded** → `W_def`

Notes:

- **"Defense win"** in CWL = your base wasn't fully 3-starred; model it as conceding fewer stars (or add a discrete `W_hold` bonus when `conceded < 3` / `== 0`).
- Normalization choice (divide-by-round-max vs z-score) should be configurable; default to a simple, explainable min-max so clans trust the numbers.
- The **same engine also produces a regular-war ranking** for free (identical data shape) — a low-cost bonus feature.
- Present per-component breakdowns (stars, TH bonus, defense, misses) so the ranking is transparent and auditable.

---

## 6. Recommended architecture (`clasher.skpodduturi.dev`)

```
                 ┌────────────────────────────────────────────┐
  Browser ─────► │  Frontend (clasher.skpodduturi.dev)        │
                 │  Next.js / SPA — no direct Supercell calls │
                 └───────────────┬────────────────────────────┘
                                 │ HTTPS (own API)
                 ┌───────────────▼────────────────────────────┐
                 │  Backend API + Worker  ── FIXED EGRESS IP   │◄── whitelisted on CoC key
                 │  • Auth, clan registration, giveaways, rank │
                 │  • CoC client (token pool, throttle, cache) │──► api.clashofclans.com
                 │  • Scheduler → polling jobs (war/CWL/roster)│
                 └───────────────┬────────────────────────────┘
                                 │
                 ┌───────────────▼───────────────┐   ┌──────────────────────┐
                 │  Postgres (snapshots, users,   │   │ Redis (cache, queue, │
                 │  clans, war/CWL history, rules,│   │ rate-limit buckets)  │
                 │  giveaways, winners)           │   └──────────────────────┘
                 └────────────────────────────────┘
```

- **Static egress is mandatory** (§1.1). Easiest: one small fixed-IP VPS/container for the backend+worker; or cloud with NAT-gateway egress. Frontend can live anywhere (the subdomain).
- **Snapshot engine** (§1.3) is the core: adaptive polling — slow during prep, **fast near `endTime`** to reliably capture `warEnded` before rotation; during CWL week (~1st–10th) poll `leaguegroup`, enumerate war tags, snapshot each round war on completion. Persist **raw war JSON** keyed by war/round identity; everything else (rules, ranking) computes from the store.
- **CoC client**: token pool (round-robin up to ~10 keys), per-token ≤10 req/s limiter, respect `Cache-Control`, exponential backoff on 429, circuit-breaker on 503 maintenance, explicit alert on 403 `invalidIp`.
- **Suggested stack** (fast turnaround, mature libs): TypeScript backend with **`clashofclans.js`**, or Python with **`coc.py`** (both implement the poll/diff + token handling we'd otherwise rebuild). Postgres + Redis. Pick per your comfort; both are first-class for this API.

---

## 7. Risks & open decisions

**Risks**

- **No history backfill** (§1.3) — rules 8b/8d/8e and ranking only see data since onboarding. Set expectations in UX.
- **War log must be Public** — private clans return 403; we can't track them. Detect and prompt the leader to flip it.
- **ToS / monetization** — Supercell's Fan Content Policy restricts paid products built on the API; keep it ad/donation-funded, attribute Supercell, don't imply endorsement, and review the developer terms before charging.
- **Proxy dependency** — if MVP uses RoyaleAPI proxy, plan migration to a self-owned static IP.
- **Rate limits at scale** — many clans × endpoints × poll frequency; budget against ~10 req/s/token and cache hard.
- **Maintenance windows** — entire API 503s during game maintenance; degrade gracefully.

**Open product decisions (your call — these gate the build):**

1. Rule **scope window** for 8b/8d/8e (season / range / since-tracking).
2. Rules as **filters** (pass-all → 1 entry) vs **additive weights** (more odds).
3. **Entity granularity** at launch (account-level only until linking ships?).
4. **Deployment** of the fixed-IP backend (VPS vs cloud-NAT) and **MVP via proxy** yes/no.
5. **Stack** (TypeScript/`clashofclans.js` vs Python/`coc.py`).

---

## 8. Suggested phasing (quick turnaround)

1. **Foundation:** fixed-IP backend + CoC client (token pool, throttle, cache) + Postgres schema. Verify auth end-to-end.
2. **Clan onboarding:** `verifytoken` → role check → register clan (req 1–2). Detect private war log.
3. **Snapshot engine:** scheduler + polling for `currentwar` and CWL rounds; persist raw snapshots (req 4). _This unlocks everything downstream._
4. **Stats + giveaways:** compute per-entity rule stats; rules engine; random draw + winners store (req 5–8, account-level).
5. **CWL ranking:** configurable-weight ranking with cwlranking credit on the UI (req 10).
6. **Phase 2:** profile linking / account management (req 3, 9), person-level entities, regular-war ranking, derived "events" (war ending soon, joined/left) via poll-diff.

---

_Sources: official portal `developer.clashofclans.com`; libraries `coc.py` & `clashofclans.js`; ClashPerk FAQ; RoyaleAPI proxy docs; cwlranking.vercel.app (FAQ) + its open-source precursor `matmannion/clashofclans-cwlranking`. All six architecture-critical claims were adversarially verified; the only correction was the CWL-retention nuance noted in §1.3._
