# Clasher secrets — bootstrap runbook

How every Clasher secret is provisioned, where it lives, and in what order — so the
whole system is rebuildable from this repo on a fresh host (**NFR-2**). No secret
_value_ is ever committed; this file documents only **names, namespaces, keys, sources,
and order** (DESIGN §9, §10; NFR-3).

> **Scope boundary.** This runbook covers the **out-of-band bootstrap** an admin performs
> once per cluster. It is distinct from the CD pipeline (#13): `clasher-deployer` (the CD
> identity) has **no access to Secrets by design** (see `README.md` → _Bootstrap vs deploy_),
> so it never creates or reads the Secrets below. CD only rolls per-release workloads that
> _consume_ them. The handful of secrets the pipeline needs **for itself** (Tailscale, scoped
> kubeconfig, GHCR push) are GitHub-side and listed separately in
> [§5](#5-github-side-secrets-cd-pipeline--13).

## 1. Principles (do not regress)

- **Out-of-band, never committed, never client-side.** Secrets are injected at deploy time
  into k8s Secrets; they never appear in the repo, in browser-reachable code, or in CI logs
  (DESIGN §9/§10; NFR-3).
- **No value ever on argv.** Provisioning uses `kubectl create secret … --from-env-file`/
  `--from-file`, so kubectl reads values straight from a file. Values never become shell
  variables and never show in `ps`/argv/logs. Use [`scripts/make-secrets.sh`](scripts/make-secrets.sh),
  which enforces this (see [§6](#6-the-make-secrets-helper)).
- **Namespace-local.** Kubernetes Secrets do not cross namespaces. A value needed in two
  namespaces is provisioned **twice** (e.g. the Postgres password exists as
  `postgres-credentials` in `clasher-database` **and** `backup-postgres-credentials` in
  `clasher-backend`).
- **Official-key isolation.** The Clash of Clans key (`COC_API_KEY`) exists **only** in
  `clasher-backend` for the `coc-gateway` pod — never in `clasher-frontend`, never client-side
  (DESIGN §10). Treat it as visible to RoyaleAPI → rotation plan + alerts tracked in M5.
- **`verifytoken` is never here.** The in-game ownership token is never persisted and is
  redacted from logs (NFR-11); it is not a provisioned secret and never enters this flow.
- **Encryption at rest.** Enable k3s Secret encryption-at-rest on quasar (DESIGN §9) so these
  Secrets are not stored in plaintext in etcd. Verify with `kubectl get secrets -A` succeeding
  while the on-disk etcd payload is encrypted (operator step on the host).

## 2. Injection flow

```
 source of record                bootstrap (admin, out-of-band)            cluster (quasar / k3s)
 ─────────────────                ─────────────────────────────            ──────────────────────
 GitHub Environment secret   ┐
   or operator-generated     ├─►  env-file / key-file on the admin    ──►  k8s Secret (encrypted
   value (openssl rand, …)   │    workstation (gitignored, chmod 600)       at rest), namespace-local
 Cloudflare / Google / CoC   ┘            │                                        │
 portal credential                        ▼                                        ▼
                              scripts/make-secrets.sh                     workload reads it via
                              → kubectl create secret … --from-env-file   envFrom / secretKeyRef
                                --dry-run=client -o yaml | kubectl apply    (never on argv, never
                                (values only ever travel through the pipe)   client-side)
```

The TLS Secret is the one exception — it is **issued by cert-manager**, not provisioned by
hand (see the table note).

## 3. Secret inventory

### 3a. In-cluster k8s Secrets (admin-provisioned, out-of-band)

| Secret                        | Namespace                                    | Keys                                                      | Type                             | Source of value                                                                               | Consumed by                                    | Origin issue                      |
| ----------------------------- | -------------------------------------------- | --------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------- |
| `postgres-credentials`        | `clasher-database`                           | `username`, `password`, `dbname`                          | Opaque                           | operator-generated (CSPRNG password)                                                          | `postgres` StatefulSet                         | #7                                |
| `redis-credentials`           | `clasher-database`                           | `password`                                                | Opaque                           | operator-generated (CSPRNG)                                                                   | `redis-queue`, `redis-cache`                   | #7                                |
| `cloudflare-api-token`        | `clasher-frontend`                           | `api-token`                                               | Opaque                           | Cloudflare token, scopes `Zone:DNS:Edit` **+** `Zone:Zone:Read` on the `skpodduturi.dev` zone | cert-manager `Issuer` `letsencrypt-cloudflare` | #8                                |
| `cloudflare-ddns-token`       | `clasher-frontend`                           | `api-token`                                               | Opaque                           | **separate** Cloudflare token, same scopes as above                                           | `cloudflare-ddns` CronJob                      | #9                                |
| `backup-postgres-credentials` | `clasher-backend`                            | `username`, `password`, `dbname`                          | Opaque                           | **same values** as `postgres-credentials` (namespace-local copy)                              | `pg-backup` CronJob                            | #10                               |
| `backup-ssh`                  | `clasher-backend`                            | `id`, `known_hosts`                                       | Opaque                           | operator: SSH private key for the off-box backup host + its `known_hosts` line                | `pg-backup` CronJob                            | #10                               |
| `coc-gateway-secret`          | `clasher-backend`                            | `COC_API_KEY`                                             | Opaque                           | Clash of Clans developer portal key (allowlisted to RoyaleAPI's outbound IP `45.79.218.79`)   | `coc-gateway` Deployment                       | #11 convention; consumed M2       |
| `web-auth`                    | `clasher-frontend`                           | `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Opaque                           | `openssl rand -base64 32` + Google Cloud OAuth 2.0 client                                     | `web` Deployment                               | #11 convention; consumed M1 (#15) |
| `api-credentials`             | `clasher-backend`                            | `DATABASE_URL`, `REDIS_QUEUE_URL`, `REDIS_CACHE_URL`      | Opaque                           | composed from the data-tier creds + in-cluster service DNS (see note)                         | `api` Deployment                               | #11 convention; consumed M2       |
| `ghcr-pull`                   | `clasher-frontend` **and** `clasher-backend` | `.dockerconfigjson`                                       | `kubernetes.io/dockerconfigjson` | GitHub PAT with `read:packages` for `ghcr.io/skrx7392/clasher-*`                              | every workload pod (`imagePullSecrets`)        | #13                               |
| `clasher-skpodduturi-dev-tls` | `clasher-frontend`                           | `tls.crt`, `tls.key`                                      | `kubernetes.io/tls`              | **cert-manager — auto-issued, do NOT provision by hand**                                      | Traefik `IngressRoute`                         | #8                                |

> **`api-credentials` composition.** The api/worker (M2) read `DATABASE_URL`,
> `REDIS_QUEUE_URL`, `REDIS_CACHE_URL`. Build the URLs from the data-tier creds and the
> in-cluster service DNS — e.g.
> `postgresql://<username>:<password>@postgres.clasher-database.svc.cluster.local:5432/<dbname>`,
> `redis://:<password>@redis-queue.clasher-database.svc.cluster.local:6379`,
> `redis://:<password>@redis-cache.clasher-database.svc.cluster.local:6379`. Namespace-local
> copy because Secrets don't cross namespaces (same reason `backup-postgres-credentials` is
> duplicated). Names marked _“#11 convention”_ are established here so the bootstrap is
> complete; the consuming Deployment lands in its milestone.

### 3b. ConfigMap (non-secret, but a bootstrap prerequisite)

| Object                              | Namespace         | Key             | Source                                                                           | Consumed by                                  | Issue |
| ----------------------------------- | ----------------- | --------------- | -------------------------------------------------------------------------------- | -------------------------------------------- | ----- |
| `backup-recipient-cert` (ConfigMap) | `clasher-backend` | `recipient.crt` | **public** cert of the off-box recipient; the private key lives **off-box only** | `pg-backup` CronJob (`openssl cms -encrypt`) | #10   |

It is public-key material (safe in a ConfigMap), but it must exist before the backup
CronJob runs, so it is bootstrapped here alongside the Secrets.

## 4. Provisioning order

Namespaces are created by the #6 base, and Secrets are namespace-scoped, so the base must
be applied first. Then provision each Secret **before** the workload that consumes it rolls.

1. **Foundation (#6).** `kubectl apply -k deploy/k8s/base` for namespaces, RBAC,
   NetworkPolicies, ResourceQuotas/LimitRanges. (Cluster-scoped + security objects are
   admin-applied out-of-band — see `README.md`.)
2. **Enable k3s Secret encryption-at-rest (host step) — _before any Secret is written_.**
   If Secrets already exist, they were persisted to etcd in plaintext; re-encrypt with
   `kubectl get secrets -A -o json | kubectl replace -f -` after enabling. Do this first so
   every Secret below lands encrypted.
3. **Registry pull (#13):** `ghcr-pull` in **both** `clasher-frontend` and `clasher-backend`
   → required before any private `ghcr.io/skrx7392/clasher-*` image is pulled (the
   `pg-backup` CronJob in step 5 runs the private `clasher-backup` image, so its namespace's
   `ghcr-pull` must exist first).
4. **Data tier:** `postgres-credentials`, `redis-credentials` → then the `clasher-database`
   StatefulSets/Deployment can start. (Postgres/Redis use public upstream images, so they
   need no pull secret themselves.)
5. **Backup (#10):** `backup-postgres-credentials`, `backup-ssh`, and the
   `backup-recipient-cert` ConfigMap → then the `pg-backup` CronJob can run (it also needs
   `ghcr-pull` from step 3 for its private image).
6. **TLS (#8):** `cloudflare-api-token` → cert-manager `Issuer`/`Certificate` issue
   `clasher-skpodduturi-dev-tls` automatically. **Do not create the TLS Secret yourself.**
7. **DDNS (#9):** `cloudflare-ddns-token` → the `cloudflare-ddns` CronJob.
8. **App secrets (consumed in their milestone):** `coc-gateway-secret` (M2),
   `api-credentials` (M2), `web-auth` (M1/#15).
9. **First admin seed (out-of-band, M1/#15):** after the DB and api/web are up, promote the
   first admin via the seed script — **not** through any API path (role is never
   self-settable; DESIGN §10). Tracked in #15; recorded here so the bootstrap chain is
   complete.

## 5. GitHub-side secrets (CD pipeline — #13)

These are **GitHub Actions / Environment** secrets used by the deploy job itself. They are
**not** k8s Secrets and are **not** provisioned with `make-secrets.sh`; set them under the
repo's `production` Environment (with a required reviewer).

| GitHub secret                                           | Used for                                        | Notes                                                                                                                                                     |
| ------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TAILSCALE_AUTHKEY` (or TS OAuth client)                | join the runner to the tailnet to reach quasar  | **ephemeral, ACL-tagged** key (DESIGN §9)                                                                                                                 |
| `KUBECONFIG` (or `clasher-deployer` SA token + API URL) | scoped `kubectl` as `clasher-deployer`          | **namespaced** Role only — never cluster-admin                                                                                                            |
| `DATABASE_URL`                                          | the migration-gate job (runs before image roll) | same Postgres connection string as `api-credentials`                                                                                                      |
| GHCR push                                               | `GITHUB_TOKEN` (built-in) pushes images         | the separate `read:packages` PAT for the in-cluster `ghcr-pull` Secret is provisioned per [§3a](#3a-in-cluster-k8s-secrets-admin-provisioned-out-of-band) |

## 6. The make-secrets helper

[`scripts/make-secrets.sh`](scripts/make-secrets.sh) creates a Secret from a local
env-file/key-file without leaking values on argv (`set -euo pipefail`; refuses
git-tracked or world-readable material; idempotent create-or-apply via
`--dry-run=client -o yaml | kubectl apply -f -`). Keep all env-files in a **gitignored**
scratch dir (`deploy/k8s/secrets/`, ignored — see `.gitignore`) at mode `600`.

The recipes below reference source values as `$CF_CERT_TOKEN`, `$COC_API_KEY`,
`$GOOGLE_CLIENT_SECRET`, `$GHCR_PAT`, etc. **Do not `export` these** — that leaks them into
shell history and the process environment. Read each one straight into its env-file with
`read -rs`, then `unset` it. For example, for the CoC key:

```sh
read -rs COC_API_KEY   # paste; not echoed, not in history
printf 'COC_API_KEY=%s\n' "$COC_API_KEY" > deploy/k8s/secrets/coc-gateway-secret.secret.env
chmod 600 deploy/k8s/secrets/coc-gateway-secret.secret.env && unset COC_API_KEY
```

In CI/CD these same values come from the GitHub Environment secret store, never a manual
shell. Then run the recipes:

```sh
# 1) Postgres creds (clasher-database). Generate a strong password offline:
mkdir -p deploy/k8s/secrets && chmod 700 deploy/k8s/secrets
cat > deploy/k8s/secrets/postgres-credentials.secret.env <<EOF
username=clasher
password=$(openssl rand -base64 24)
dbname=clasher
EOF
chmod 600 deploy/k8s/secrets/postgres-credentials.secret.env

deploy/k8s/scripts/make-secrets.sh \
  --name postgres-credentials --namespace clasher-database \
  --env-file deploy/k8s/secrets/postgres-credentials.secret.env --context quasar

# 2) Redis password (clasher-database)
printf 'password=%s\n' "$(openssl rand -base64 24)" \
  > deploy/k8s/secrets/redis-credentials.secret.env && chmod 600 deploy/k8s/secrets/redis-credentials.secret.env
deploy/k8s/scripts/make-secrets.sh --name redis-credentials --namespace clasher-database \
  --env-file deploy/k8s/secrets/redis-credentials.secret.env --context quasar

# 3) Backup creds — SAME values as Postgres, but in clasher-backend (namespace-local copy)
deploy/k8s/scripts/make-secrets.sh --name backup-postgres-credentials --namespace clasher-backend \
  --env-file deploy/k8s/secrets/postgres-credentials.secret.env --context quasar

# 4) Backup SSH (key-file material, not env)
deploy/k8s/scripts/make-secrets.sh --name backup-ssh --namespace clasher-backend \
  --from-file id=deploy/k8s/secrets/backup_id_ed25519 \
  --from-file known_hosts=deploy/k8s/secrets/backup_known_hosts --context quasar

# 5) Cloudflare tokens (clasher-frontend) — TWO separate tokens, key 'api-token'
printf 'api-token=%s\n' "$CF_CERT_TOKEN" > deploy/k8s/secrets/cloudflare-api-token.secret.env
deploy/k8s/scripts/make-secrets.sh --name cloudflare-api-token --namespace clasher-frontend \
  --env-file deploy/k8s/secrets/cloudflare-api-token.secret.env --context quasar
printf 'api-token=%s\n' "$CF_DDNS_TOKEN" > deploy/k8s/secrets/cloudflare-ddns-token.secret.env
deploy/k8s/scripts/make-secrets.sh --name cloudflare-ddns-token --namespace clasher-frontend \
  --env-file deploy/k8s/secrets/cloudflare-ddns-token.secret.env --context quasar

# 6) CoC official key (clasher-backend ONLY)
printf 'COC_API_KEY=%s\n' "$COC_API_KEY" > deploy/k8s/secrets/coc-gateway-secret.secret.env
deploy/k8s/scripts/make-secrets.sh --name coc-gateway-secret --namespace clasher-backend \
  --env-file deploy/k8s/secrets/coc-gateway-secret.secret.env --context quasar

# 7) Web auth (clasher-frontend) — AUTH_SECRET + Google OAuth client (M1/#15)
cat > deploy/k8s/secrets/web-auth.secret.env <<EOF
AUTH_SECRET=$(openssl rand -base64 32)
GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET
EOF
deploy/k8s/scripts/make-secrets.sh --name web-auth --namespace clasher-frontend \
  --env-file deploy/k8s/secrets/web-auth.secret.env --context quasar

# 8) GHCR image pull — type=dockerconfigjson, in BOTH namespaces.
#    Put the read:packages PAT in a gitignored file, then fold it into the dockerconfig.
#    The PAT only ever travels through a pipe (stdin) — it never reaches an external
#    process' argv. `tr -d '\n'` keeps the base64 single-line on both macOS and GNU.
read -rs GHCR_PAT
printf '%s' "$GHCR_PAT" > deploy/k8s/secrets/ghcr_pat.txt && chmod 600 deploy/k8s/secrets/ghcr_pat.txt && unset GHCR_PAT
auth="$(printf 'skrx7392:%s' "$(<deploy/k8s/secrets/ghcr_pat.txt)" | base64 | tr -d '\n')"
printf '{"auths":{"ghcr.io":{"auth":"%s"}}}\n' "$auth" \
  > deploy/k8s/secrets/ghcr-dockerconfig.json && chmod 600 deploy/k8s/secrets/ghcr-dockerconfig.json
unset auth
for ns in clasher-frontend clasher-backend; do
  deploy/k8s/scripts/make-secrets.sh --name ghcr-pull --namespace "$ns" \
    --type kubernetes.io/dockerconfigjson \
    --from-file .dockerconfigjson=deploy/k8s/secrets/ghcr-dockerconfig.json --context quasar
done

# 9) backup-recipient-cert is a ConfigMap (public cert), not a Secret:
kubectl --context quasar -n clasher-backend create configmap backup-recipient-cert \
  --from-file=recipient.crt=deploy/k8s/secrets/recipient.crt \
  --dry-run=client -o yaml | kubectl --context quasar apply -f -
```

> The only secret in step 8 is the PAT: it is written to `ghcr_pat.txt` (mode 600), folded
> into `ghcr-dockerconfig.json` (mode 600), and loaded into the Secret via `--from-file` — it
> never appears on any command line. Both files are gitignored. (`skrx7392` and `ghcr.io` in
> the dockerconfig are non-secret.)

## 7. Verifying the no-leak property (AC)

The acceptance criterion is "creates Secrets from an env-file without leaking values on argv
(verified by dry-run/log inspection)". To verify:

```sh
# (a) Preview keys only — values are never rendered:
deploy/k8s/scripts/make-secrets.sh --name postgres-credentials --namespace clasher-database \
  --env-file deploy/k8s/secrets/postgres-credentials.secret.env --dry-run
#  → prints: Keys: - username / - password / - dbname   (no values)

# (b) Prove no value appears on any argv while it runs (separate shell):
#     while the script runs, `ps -eo args | grep -i password` shows nothing —
#     kubectl receives only `--from-env-file <path>`, never the values.

# (c) Confirm the applied Secret exposes the right keys (still no values):
kubectl --context quasar -n clasher-database get secret postgres-credentials \
  -o go-template='{{range $k,$_ := .data}}{{$k}}{{"\n"}}{{end}}'
```

After bootstrap, scrub the local material: `rm -rf deploy/k8s/secrets` (it is gitignored, but
do not leave plaintext on disk longer than needed).

## 8. Rotation

- **CoC key (`coc-gateway-secret`).** Treated as visible to RoyaleAPI (DESIGN §10). Rotate by
  re-running step 6 with a new portal key, then `kubectl -n clasher-backend rollout restart
deploy/coc-gateway`. M5 adds anomaly/quota alerts + self-egress migration.
- **Any Secret.** Re-running the matching `make-secrets.sh` command applies the new value
  idempotently; restart the consuming workload to pick it up. Cloudflare/Google/GHCR
  credentials rotate at their source first, then re-provision here.
