# Clasher — Requirements Specification

> Numbered, testable requirements for the Clash of Clans integration ("Clasher"), to be deployed at `clasher.skpodduturi.dev`.
> Solution-agnostic by design: **technology, architecture, and milestones are deliberately excluded** — they belong in a later design/plan document (see `ANALYSIS.md` for feasibility and the eventual `DESIGN.md` for architecture).
> Status: **DRAFT v0.2** — open items resolved (§9); ready for review.

---

## 1. Purpose & overview
Clasher lets Clash of Clans clan leaders manage their clans, view war / CWL activity, run rule-based random giveaways over their members, and rank players for Clan War League. The system is built on Supercell's official, **poll-only, history-less** API, which makes continuous data capture a foundational behaviour (see §4).

## 2. Glossary
- **Account** — a single CoC player profile, identified by a player **tag** (e.g. `#ABC123`).
- **Person** — one human, who may control multiple Accounts.
- **Entity** — the unit a giveaway draws over: either an Account or a Person (chosen per giveaway, FR-21).
- **Clan** — a CoC clan, identified by a clan tag.
- **Role** — a member's clan rank: Leader, Co-Leader, Elder (API `admin`), Member.
- **Regular War** — a standard clan war (preparation → battle → ended).
- **CWL** — Clan War League: a monthly season of 7 rounds.
- **Round** — one war within a CWL season.
- **Lineup / fielded** — the members actually placed on the map for a given war (subset of the eligible roster).
- **Missed attack** — an allowed attack a fielded member did not use.
- **Snapshot** — a captured, persisted point-in-time copy of war/CWL data.
- **Tracking window** — the span for which Snapshots exist for a clan; the earliest is the **tracking-since date**.
- **Rule** — a predicate over an Entity's tracked stats that, if satisfied, grants entries.
- **Weight** — the number of entries a Rule contributes.
- **Entry** — one chance in a giveaway draw.
- **Draw** — the act of randomly selecting winner(s).

## 3. Roles & actors
- **Platform Admin** — operates Clasher; superset of all permissions; performs account→person linking in the pilot.
- **Clan Manager** — a verified Leader/Co-Leader who registers clans and runs giveaways/rankings for them.
- **Resolved:** Clan Managers self-onboard (register their own clans after verification); the Platform Admin retains oversight and performs account-linking.

## 4. Assumptions & external constraints
These bound the system and are not negotiable design choices; they originate in the Supercell API (verified — see `ANALYSIS.md`).
- **C-1** The official API is **poll-only**; there are **no webhooks/push/pub-sub**. Any "event" (war started/ending, member joined/left) is derived by polling.
- **C-2** The API **does not retain per-member war history**: regular-war per-member attacks vanish when the next war starts; CWL round data is only listed during the active season. ⇒ The system must capture data **while it is live**; there is **no backfill** of history predating tracking.
- **C-3** War/CWL data is only readable when the clan's **war log is Public**.
- **C-4** API access is **IP-restricted** and **rate-limited**; the deployment host has a **dynamic public IP**.
- **C-5** A person can prove Account ownership only via the **in-game API token** (one-time, expiring).
- **C-6** Use is subject to Supercell's **Fan Content Policy** (attribution required; monetization restricted).

---

## 5. Functional requirements

### 5.1 Identity & access
- **FR-1** The system shall authenticate users via **Google OAuth** (OpenID Connect; `openid email profile` scopes) before granting access to clan-management features.
- **FR-2** The system shall support the Platform Admin and Clan Manager roles, with the Admin able to perform all Clan Manager actions.
- **FR-3** The system shall let a user prove ownership of an Account by submitting that account's in-game API token, validating it against the official verification mechanism (C-5).
- **FR-4** The system shall not persist a submitted in-game token beyond the one-time verification (NFR-11).

### 5.2 Clan registration & leadership
- **FR-5** A Clan Manager shall be able to register one or more clans.
- **FR-6** The system shall permit registering a clan **only if** the registrant has proven ownership (FR-3) of an Account whose current Role in that clan is **Leader or Co-Leader**, verified server-side at registration.
- **FR-7** The system shall periodically re-validate that each registrant still holds Leader/Co-Leader; on loss it shall flag the clan and block creation of new giveaways/rankings while retaining already-captured data.
- **FR-8** The system shall detect when a registered clan's war log is **Private** and surface an actionable message (data cannot be tracked until made Public) (C-3).
- **FR-9** A Clan Manager shall be able to deregister a clan they own.

### 5.3 Roster / players
- **FR-10** The system shall list the current members of a registered clan, including tag, name, Role, and town-hall level.
- **FR-11** The system shall identify members by **player tag** (stable across name changes).

### 5.4 Account linking (pilot — admin-driven)
- **FR-12** A Platform Admin shall be able to link multiple Accounts into a single Person entity.
- **FR-13** A Platform Admin shall be able to view, edit, and unlink Person↔Account mappings.
- **FR-14** The system shall treat unlinked Accounts as standalone Person entities of one Account for entity-level operations.

### 5.5 War & CWL viewing
- **FR-15** The system shall display a registered clan's **current regular-war** status: state, lineup, per-member attacks used vs allowed, stars, destruction, and war timing.
- **FR-16** The system shall display a registered clan's **regular-war log** (historical results available from the API: outcome, stars, destruction, dates).
- **FR-17** The system shall display a registered clan's **current CWL** status: season, group, rounds, and each round's war detail.

### 5.6 Data capture (tracking)
- **FR-18** The system shall capture and persist regular-war and CWL data while it is available, building durable per-Account history (consequence of C-2). *(Capability requirement; mechanism is design.)*
- **FR-19** The system shall record and display, per clan, the **tracking-since date** and which wars/rounds have been captured.
- **FR-20** From captured data the system shall compute, per Account per war/round: attacks made vs allowed (and missed), stars earned, opponent town-hall level, and stars conceded on defense.

### 5.7 Giveaways
- **FR-21** A Clan Manager shall be able to create a giveaway scoped to one of their registered clans.
- **FR-22** The creator shall be able to scope eligibility by **(a)** a selected CWL season **and/or (b)** a date range of regular wars.
- **FR-23** The creator shall be able to choose the **entity granularity**: per Account or per Person.
- **FR-23a** When granularity is per Person, the creator shall be able to choose the rule-aggregation mode per giveaway: **all** linked accounts must qualify (strict) or **any** linked account qualifies (lenient).
- **FR-24** The creator shall be able to select one or more Rules and assign each a configurable **Weight** (entries granted).
- **FR-25** Entries shall be **additive**: an Entity's total entries = the sum of Weights of every Rule it satisfies.
- **FR-26** The system shall display the computed entrant pool and each Entity's entry count before drawing.
- **FR-27** The system shall draw a configurable number of winner(s) (default 1), selected randomly with probability proportional to entries, using a fair RNG.
- **FR-28** The system shall persist each giveaway's configuration, entrant pool, per-entity entries, RNG seed, and outcome for audit and repeatability.
- **FR-29** The system shall store and display the history of previous giveaway winners.
- **FR-30** ⟦OPEN-4⟧ The system *may* offer an option to exclude recent past winners for a configurable period (candidate future Rule).

### 5.8 Giveaway rules (launch set)
Each Rule, if satisfied by an Entity over the giveaway's scope (FR-22), grants its configured Weight in entries. For a Person entity, satisfaction aggregates across the linked Accounts per the mode chosen in FR-23a (all / any).
- **FR-31 (8a)** *Base entry* — granted to every eligible Entity.
- **FR-32 (8b)** *No missed regular-war attacks* — Entity missed zero attacks across the regular wars in scope.
- **FR-33 (8c)** *Participated in CWL* — Entity was fielded in ≥1 round of the selected CWL season.
- **FR-34 (8d)** *No missed CWL attacks* — Entity missed zero attacks in the rounds it was fielded (selected season).
- **FR-35 (8e)** *Maximum CWL stars* — Entity earned 3 stars on every fielded attack in the selected season.
- **FR-36** The rule framework shall be extensible so new Rules can be added without redesign.
- **FR-37** Rules requiring tracked data shall only evaluate over the tracking window; Entities with incomplete coverage shall still be evaluated over available data, with partial coverage flagged in the UI (warn-but-evaluate).

### 5.9 CWL ranking
- **FR-38** The system shall produce a ranking of players for a selected CWL season of a registered clan.
- **FR-39** The ranking shall support **configurable weights** for at least: stars gained, attacking a higher town hall (town-hall delta), and defense (stars conceded on defense).
- **FR-40** The ranking shall apply a configurable **missed-attack penalty**.
- **FR-41** The ranking shall optionally **normalize each war/round** so every war contributes equally (configurable).
- **FR-42** Weights shall be configurable per clan/season; changing them shall recompute the ranking.
- **FR-43** The ranking view shall show a **per-component breakdown** for transparency.
- **FR-44** The CWL ranking UI shall **visibly credit `cwlranking.vercel.app`**.
- **FR-45** *(Optional)* The same ranking engine may also rank regular wars over a date range.

---

## 6. Non-functional requirements
- **NFR-1 Cost** — The system shall run entirely on existing self-hosted infrastructure with no recurring paid cloud services; any third-party dependency must be free.
- **NFR-2 Reproducibility** — The full system shall be rebuildable from the repository alone on a fresh host (manifests, pipelines, schema migrations all in-repo).
- **NFR-3 Secret safety** — The official API credential shall never reach clients; all Supercell calls shall be server-side. Secrets shall be kept out-of-band (not committed) and injected at deploy.
- **NFR-4 Isolation & blast radius** — The system shall be namespace-isolated and resource-limited so it cannot degrade co-tenant workloads; no shared/cluster-wide resources shall be modified.
- **NFR-5 Rate-limit compliance** — The system shall respect the API's throttling limits and response cache lifetimes, and back off on throttle responses.
- **NFR-6 Resilience** — The system shall degrade gracefully on upstream private-log (403), throttle (429), and maintenance (503) conditions, and fail loudly on misconfiguration rather than silently.
- **NFR-7 Data durability** — Captured Snapshots are irreplaceable (C-2); the system shall back them up and survive process restarts without data loss.
- **NFR-8 Dynamic-IP tolerance** — Loss/rotation of the host's public IP shall not break Supercell access (C-4).
- **NFR-9 Observability** — The system shall expose logs/metrics for poll jobs, snapshot coverage/gaps, and draw audits.
- **NFR-10 Compliance & attribution** — The system shall comply with Supercell's Fan Content Policy (attribution; no prohibited monetization) and credit `cwlranking.vercel.app` (FR-44).
- **NFR-11 Privacy** — The system shall store only public game data plus minimal user-identity data; it shall not retain in-game verification tokens (FR-4).
- **NFR-12 Correctness** — The system shall correctly parse the API's compact UTC timestamps and treat all war timing as UTC.

---

## 7. Scope
**In scope (launch):** user auth; account-ownership verification; clan registration with leadership verification; roster view; war + CWL viewing; data-capture/tracking engine; admin-driven account linking; account- and person-level entities; giveaways with the five launch Rules, additive weights, and season/date scoping; winners history; configurable CWL ranking with credit.

**Out of scope (later):** self-service multi-account linking & self-claim; derived push/notifications for in-game events; exclude-recent-winners and other extended Rules; regular-war ranking (optional stretch); any monetization; native mobile app; localization.

---

## 8. Acceptance criteria (representative, testable)
- **AC-1** Attempting to register a clan with an Account that is Member/Elder is rejected; with Leader/Co-Leader it succeeds (FR-6).
- **AC-2** A clan with a Private war log shows the actionable "make war log public" state and is not marked trackable (FR-8).
- **AC-3** After a tracked war ends, each fielded Account's missed-attack count and stars match the war's actual data (FR-20).
- **AC-4** A giveaway with rules 8a(weight 1)+8b(weight 1) gives an Account that missed no attacks 2 entries and one that missed an attack 1 entry (FR-25, FR-31/32).
- **AC-5** Re-running a completed draw from its stored seed and pool reproduces the same winner(s) (FR-28).
- **AC-6** Changing a CWL ranking weight re-orders the table consistently with the new weight, and the breakdown columns reconcile to the total (FR-39, FR-42, FR-43).
- **AC-7** The CWL ranking page shows visible credit to `cwlranking.vercel.app` (FR-44).
- **AC-8** The clan dashboard shows a tracking-since date and never claims data for wars before it (FR-19, C-2).

---

## 9. Open items
**Resolved:** OPEN-1 self-onboard + admin oversight (§3) · OPEN-2 Google OAuth (FR-1) · OPEN-3 flag + block new giveaways, retain data (FR-7) · OPEN-5 per-giveaway all/any aggregation mode (FR-23a) · OPEN-6 warn-but-evaluate (FR-37) · OPEN-7 configurable, default 1 (FR-27).
**Deferred:** OPEN-4 exclude-recent-winners → post-launch Rule (FR-30).
**None blocking sign-off.**
