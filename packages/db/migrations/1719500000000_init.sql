-- Initial schema — DESIGN §3 (system of record). Expand/contract reversible.
-- gen_random_uuid() is built into Postgres 13+ (no extension needed).

-- Up Migration

-- Identity -----------------------------------------------------------------
CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub  text UNIQUE NOT NULL,
  email       text,
  name        text,
  -- role is NOT self-settable; admin is seeded out-of-band (DESIGN §3/§10).
  role        text NOT NULL DEFAULT 'none' CHECK (role IN ('none', 'manager', 'admin')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Proof of account ownership. NO token column ever (DESIGN §3/§5, NFR-11).
CREATE TABLE account_ownership (
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  player_tag       text NOT NULL,
  verified_at      timestamptz NOT NULL DEFAULT now(),
  revalidate_after timestamptz,
  PRIMARY KEY (user_id, player_tag)
);

CREATE TABLE accounts (
  player_tag     text PRIMARY KEY,
  name           text,
  th_level       int,
  last_synced_at timestamptz,
  raw_json       jsonb
);

CREATE TABLE persons (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL
);

-- An account belongs to at most one person (partition) — UNIQUE(player_tag).
CREATE TABLE person_accounts (
  person_id  uuid NOT NULL REFERENCES persons (id) ON DELETE CASCADE,
  player_tag text NOT NULL,
  PRIMARY KEY (person_id, player_tag),
  UNIQUE (player_tag)
);

-- Clans --------------------------------------------------------------------
CREATE TABLE clans (
  clan_tag       text PRIMARY KEY,
  name           text,
  war_log_public boolean,
  trackable      boolean,
  war_league     text,
  status         text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'flagged', 'deregistered')),
  last_synced_at timestamptz,
  raw_json       jsonb
);

CREATE TABLE clan_registrations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clan_tag            text NOT NULL REFERENCES clans (clan_tag) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  verified_player_tag text,
  role_at_registration text,
  status              text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'role_lost', 'revoked')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_revalidated_at timestamptz
);

-- Raw capture (multi-source, reconcilable) ---------------------------------
CREATE TABLE war_snapshots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  war_identity   text NOT NULL,
  source         text NOT NULL CHECK (source IN ('clashking', 'official', 'first_party')),
  clan_tag       text NOT NULL,
  war_type       text NOT NULL CHECK (war_type IN ('regular', 'cwl')),
  season         text,
  round_index    int,
  war_tag        text,
  state          text,
  end_time       timestamptz,
  fetched_at     timestamptz NOT NULL DEFAULT now(),
  schema_version int NOT NULL DEFAULT 1,
  raw_json       jsonb NOT NULL,
  -- Keep BOTH sources' raw for reconciliation (DESIGN §3/§6).
  UNIQUE (war_identity, source)
);

CREATE TABLE cwl_seasons (
  clan_tag   text NOT NULL,
  season     text NOT NULL,
  group_json jsonb,
  state      text,
  source     text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clan_tag, season)
);

CREATE TABLE warlog_entries (
  clan_tag     text NOT NULL,
  war_identity text,
  end_time     timestamptz NOT NULL,
  result       text,
  stars        int,
  destruction  numeric,
  opponent_tag text,
  war_type     text,
  source       text,
  PRIMARY KEY (clan_tag, end_time)
);

CREATE TABLE tracking_coverage (
  clan_tag          text NOT NULL,
  source            text NOT NULL,
  war_type          text NOT NULL,
  earliest_observed timestamptz,
  PRIMARY KEY (clan_tag, source, war_type)
);

-- Derived analytics (read model) -------------------------------------------
-- PER-ATTACK (regular war = up to 2 per attacker); order preserved for new-stars.
CREATE TABLE member_war_attacks (
  war_identity text NOT NULL,
  source       text NOT NULL,
  attacker_tag text NOT NULL,
  attack_order int NOT NULL,
  defender_tag text,
  defender_th  int,
  stars        int,
  new_stars    int,
  destruction  numeric,
  PRIMARY KEY (war_identity, source, attacker_tag, attack_order)
);

CREATE TABLE member_war_stats (
  clan_tag       text NOT NULL,
  player_tag     text NOT NULL,
  war_type       text NOT NULL,
  season         text,
  war_identity   text NOT NULL,
  end_time       timestamptz,
  th_level       int,
  fielded        boolean,
  attacks_made   int,
  attacks_allowed int,
  missed         int,
  stars          int,
  gained_stars   int,
  stars_conceded int,
  partial        boolean,
  PRIMARY KEY (war_identity, player_tag)
);

CREATE INDEX member_war_stats_clan_type_end_idx ON member_war_stats (clan_tag, war_type, end_time);
CREATE INDEX member_war_stats_clan_season_idx ON member_war_stats (clan_tag, season);
CREATE INDEX member_war_stats_player_idx ON member_war_stats (player_tag);
CREATE INDEX war_snapshots_clan_type_end_idx ON war_snapshots (clan_tag, war_type, end_time);

-- Giveaways ----------------------------------------------------------------
CREATE TABLE giveaways (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clan_tag         text NOT NULL REFERENCES clans (clan_tag) ON DELETE CASCADE,
  created_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  entity_granularity text NOT NULL,
  person_mode      text,
  scope_cwl_season text,
  scope_war_start  timestamptz,
  scope_war_end    timestamptz,
  num_winners      int NOT NULL CHECK (num_winners >= 1),
  status           text NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'frozen', 'drawn')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE giveaway_rules (
  giveaway_id uuid NOT NULL REFERENCES giveaways (id) ON DELETE CASCADE,
  rule_code   text NOT NULL,
  weight      int NOT NULL CHECK (weight >= 0),
  PRIMARY KEY (giveaway_id, rule_code)
);

CREATE TABLE giveaway_entries (
  giveaway_id      uuid NOT NULL REFERENCES giveaways (id) ON DELETE CASCADE,
  entity_key       text NOT NULL,
  entity_type      text NOT NULL,
  entries          int NOT NULL DEFAULT 0,
  breakdown_json   jsonb,
  evaluable_json   jsonb,
  partial_coverage boolean,
  covered_span_json jsonb,
  PRIMARY KEY (giveaway_id, entity_key, entity_type)
);

-- Single-shot: one draw per giveaway (giveaway_id is the PK).
CREATE TABLE giveaway_draws (
  giveaway_id         uuid PRIMARY KEY REFERENCES giveaways (id) ON DELETE CASCADE,
  seed                text,
  prng                text,
  prng_version        text,
  canonical_order     text,
  drawn_at            timestamptz NOT NULL DEFAULT now(),
  winners_json        jsonb,
  dataset_fingerprint text
);

CREATE TABLE giveaway_winners (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  giveaway_id uuid NOT NULL REFERENCES giveaways (id) ON DELETE CASCADE,
  clan_tag    text NOT NULL,
  entity_key  text NOT NULL,
  entity_type text NOT NULL,
  drawn_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ranking_configs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clan_tag     text NOT NULL REFERENCES clans (clan_tag) ON DELETE CASCADE,
  name         text,
  weights_json jsonb
);

-- Down Migration
DROP TABLE IF EXISTS ranking_configs;
DROP TABLE IF EXISTS giveaway_winners;
DROP TABLE IF EXISTS giveaway_draws;
DROP TABLE IF EXISTS giveaway_entries;
DROP TABLE IF EXISTS giveaway_rules;
DROP TABLE IF EXISTS giveaways;
DROP TABLE IF EXISTS member_war_stats;
DROP TABLE IF EXISTS member_war_attacks;
DROP TABLE IF EXISTS tracking_coverage;
DROP TABLE IF EXISTS warlog_entries;
DROP TABLE IF EXISTS cwl_seasons;
DROP TABLE IF EXISTS war_snapshots;
DROP TABLE IF EXISTS clan_registrations;
DROP TABLE IF EXISTS clans;
DROP TABLE IF EXISTS person_accounts;
DROP TABLE IF EXISTS persons;
DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS account_ownership;
DROP TABLE IF EXISTS users;
