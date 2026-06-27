# deploy/k8s

Kubernetes manifests for the self-hosted k3s cluster (`quasar`). Everything is in-repo
and rebuildable on a fresh host (NFR-2). Layout is a Kustomize base + per-cluster overlay:

```
deploy/k8s/
  base/                         # the shared substrate (this issue, #6)
    namespaces.yaml             # clasher-frontend|backend|database + Pod Security labels
    networkpolicies/            # default-deny + explicit allows, per namespace
      frontend.yaml
      backend.yaml
      database.yaml
      traefik.yaml              # ingress-controller -> web/api (#8)
      ddns.yaml                 # DDNS CronJob -> Cloudflare 443 (#9)
      backup.yaml               # pg-backup -> off-box SSH 22 (#10)
    rbac/
      serviceaccounts.yaml      # per-workload SAs, token automount disabled
      deployer-rbac.yaml        # scoped deploy SA + namespaced Roles/RoleBindings
    resource-management/
      limitranges.yaml          # default requests/limits per namespace
      resourcequotas.yaml       # namespace total caps (co-tenant blast-radius guard)
    data/                       # data tier (#7)
      postgres.yaml             # StatefulSet + headless Service + durable PVC
      redis-queue.yaml          # durable: noeviction + AOF + PVC (StatefulSet)
      redis-cache.yaml          # ephemeral: allkeys-lru, no PVC (Deployment)
    ingress/                    # ingress + TLS (#8)
      issuer.yaml               # cert-manager namespaced Issuer (DNS-01 Cloudflare)
      certificate.yaml          # Certificate -> clasher-skpodduturi-dev-tls
      routes.yaml               # Traefik IngressRoutes (/ -> web, /api -> api) + redirect
    dns/                        # DDNS (#9)
      ddns-cronjob.yaml         # Cloudflare DDNS CronJob (own token, only clasher record)
    backup/                     # off-box encrypted backup (#10)
      backup.sh                 # in-cluster: pg_dump -> CMS-encrypt -> rsync off-box (ConfigMap src)
      pg-backup-cronjob.yaml    # nightly CronJob (see deploy/backup/ for restore drill + runbook)
  overlays/
    quasar/                     # production overlay (CD/workload patches land here, #13)
```

Build (renders without a cluster):

```sh
kubectl kustomize deploy/k8s/base
kubectl kustomize deploy/k8s/overlays/quasar
```

## Network model (default-deny)

NetworkPolicies are additive allow-lists. Each namespace has a `default-deny-all`
(ingress **and** egress); every other policy re-opens exactly one path. The only allowed
flows are:

| From                                        | To                                            | Port       | Why                            |
| ------------------------------------------- | --------------------------------------------- | ---------- | ------------------------------ |
| `clasher-frontend` (web)                    | `clasher-backend` (api)                       | 3000/tcp   | SSR → API                      |
| `clasher-backend` (api/worker)              | `clasher-database` (postgres)                 | 5432/tcp   | DB access                      |
| `clasher-backend` (api/worker)              | `clasher-database` (redis-queue, redis-cache) | 6379/tcp   | queue + cache                  |
| `clasher-backend` (coc-gateway)             | public internet (excl. private/cluster CIDRs) | 443/tcp    | RoyaleAPI proxy **only**       |
| Traefik (`kube-system`)                     | `clasher-frontend` (web)                      | 3000/tcp   | ingress `/` → web (#8)         |
| Traefik (`kube-system`)                     | `clasher-backend` (api)                       | 3000/tcp   | ingress `/api` → api (#8)      |
| `clasher-frontend` (cloudflare-ddns)        | public internet (excl. private/cluster CIDRs) | 443/tcp    | Cloudflare DDNS (#9)           |
| `clasher-backend` (pg-backup)               | `clasher-database` (postgres)                 | 5432/tcp   | backup dump source (#10)       |
| `clasher-backend` (pg-backup)               | off-box host `/32` (operator-set)             | 22/tcp     | encrypted backup off-box (#10) |
| `clasher-frontend` + `clasher-backend` pods | `kube-system` CoreDNS                         | 53/udp+tcp | DNS                            |

- The **coc-gateway** is the _only_ pod with any external egress, restricted to 443
  (DESIGN §10 official-key isolation). It has no other egress besides DNS.
  - ⚠️ **`45.79.218.79` is NOT the proxy's connect address.** It is RoyaleAPI's _outbound_
    IP — the one registered in the Clash of Clans developer portal as the allowlisted source
    for the official key (a runbook step in #11, not a NetworkPolicy peer). The gateway
    actually dials `cocproxy.royaleapi.dev`, which is Cloudflare-fronted with rotating IPs,
    so the egress allow targets public 443 with the private/cluster ranges (incl. the k3s
    10.42/10.43 pod & service CIDRs) `except`-ed out — preventing any in-cluster/other-tenant
    pivot while letting the proxy resolve to any address. NetworkPolicy can't match a
    hostname/SNI, so "key only ever leaves toward the proxy" is enforced by the gateway
    **application layer**, not this rule. (To harden the external surface further, the
    `except`-based allow can be swapped for Cloudflare's published IP ranges — tighter but
    fragile to Cloudflare IP rotation.)
- The **database** tier has **no egress at all** (not even DNS) — it never initiates
  outbound connections.
- **Workload label contract** (later issues must apply these for policies to match):
  - web → `app.kubernetes.io/name: web`, `…/component: frontend`
  - api → `name: api`, `component: backend`
  - worker (future) → `name: worker`, `component: backend`
  - coc-gateway → `name: coc-gateway`, `component: gateway`
  - postgres → `name: postgres`, `component: database`
  - redis → `name: redis-queue` / `redis-cache`, `component: queue` / `cache`
  - Plus the built-in `kubernetes.io/metadata.name` namespace label, used for
    namespaceSelectors. The `web→api` and `coc-gateway` egress paths key off `name`
    (tightest); the `backend→database` paths key off `component: backend` so api **and**
    a future worker qualify while the gateway does not.

Intentionally **deferred** to keep the base minimal and the allow-list reviewable
(added by the issue that needs them): api → coc-gateway intra-namespace (M2), api →
`api.clashk.ing` egress (M2), web → Google OAuth egress (#15). (The #10 backup egresses from
clasher-backend, so the database tier stays egress-free.)

## RBAC

- **Workload ServiceAccounts** (`clasher-web`, `clasher-api`, `clasher-coc-gateway`,
  `clasher-postgres`, `clasher-redis`): no API permissions, token automount disabled.
- **`clasher-deployer`**: the CD identity (#13). Only **namespaced** Roles/RoleBindings,
  one per clasher namespace — **no ClusterRole/ClusterRoleBinding anywhere**. It can roll
  per-release workloads (Deployments, StatefulSets, Services, ConfigMaps, PVCs, Jobs,
  CronJobs) but has **no access to Secrets** and cannot touch cluster-scoped or
  other-tenant resources.

## Bootstrap vs deploy

Security/foundation objects are applied **once, out-of-band, by an admin** during
bootstrap: Namespaces (cluster-scoped), NetworkPolicies, RBAC, Secrets,
LimitRanges/ResourceQuotas, and later Ingress/TLS. CD (`clasher-deployer`) only rolls the
per-release workloads. This is why the deploy Role excludes those foundation resources.
The full secret inventory, provisioning order, and the no-leak injection flow are in
[`SECRETS.md`](SECRETS.md); the [`scripts/make-secrets.sh`](scripts/make-secrets.sh) helper
creates each Secret from a local env-file without leaking values on argv.

## Data tier (#7)

Three workloads in `clasher-database`, reachable only from backend (the #6 policies):

| Workload      | Kind        | Persistence                        | Eviction                 | Service (DNS)                 |
| ------------- | ----------- | ---------------------------------- | ------------------------ | ----------------------------- |
| `postgres`    | StatefulSet | 10Gi `local-path` PVC              | n/a (system of record)   | `postgres` (headless) :5432   |
| `redis-queue` | StatefulSet | 5Gi `local-path` PVC, AOF everysec | `noeviction` (fail-loud) | `redis-queue` (headless):6379 |
| `redis-cache` | Deployment  | none (emptyDir scratch)            | `allkeys-lru`, 512mb cap | `redis-cache` :6379           |

The two Redis roles are **split** so cache LRU eviction can never drop capture/ingest jobs
on the durable queue (DESIGN §2). All three run non-root (Postgres as uid/gid 70, the alpine
image's postgres user; both Redis roles as uid 999, the redis image's user), drop all
capabilities, RuntimeDefault seccomp (PSA-restricted-clean). PVC totals (15Gi / 2 claims) fit the
`clasher-database` ResourceQuota (30Gi / 5). `gateway → cache` is intentionally NOT allowed
(the gateway stays maximally isolated); add an allow only if a gateway caching need emerges.

**Required Secrets** (bootstrapped out-of-band per #11 — never in-repo):

- `postgres-credentials` (clasher-database) — keys `username`, `password`, `dbname`.
- `redis-credentials` (clasher-database) — key `password` (both Redis roles AUTH with it).

Images (`postgres:18-alpine`, `redis:7-alpine`) are tag-pinned here; CD (#13) should pin by
digest.

### Postgres restart / durability drill (AC)

Run on quasar after apply (operator step) to prove data survives a restart. The
credentials live in the container env (from the Secret), so each command resolves them
inside the pod (`sh -c`), not in the operator's local shell:

```sh
kubectl -n clasher-database exec postgres-0 -- sh -ceu \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "create table drill(t text); insert into drill values('"'"'ok'"'"');"'
kubectl -n clasher-database delete pod postgres-0          # StatefulSet recreates it
kubectl -n clasher-database rollout status statefulset/postgres
kubectl -n clasher-database exec postgres-0 -- sh -ceu \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select t from drill;"'   # expect: ok (PVC rebound)
```

Redis-queue durability (AUTH via container env):

```sh
kubectl -n clasher-database exec redis-queue-0 -- sh -ceu \
  'redis-cli --no-auth-warning -a "$REDIS_PASSWORD" set drill ok'
kubectl -n clasher-database delete pod redis-queue-0
kubectl -n clasher-database rollout status statefulset/redis-queue
kubectl -n clasher-database exec redis-queue-0 -- sh -ceu \
  'redis-cli --no-auth-warning -a "$REDIS_PASSWORD" get drill'   # expect: ok (AOF replay)
```

Redis-cache has no such guarantee by design (ephemeral).

## Ingress & TLS (#8)

`https://clasher.skpodduturi.dev` via Traefik, TLS from cert-manager (DESIGN §8/§9):

- **Routing**: `/` → web (clasher-frontend), `/api` → api (clasher-backend). Two Traefik
  `IngressRoute`s (one per namespace, since Traefik routes only to same-namespace Services by
  default — enabling cross-namespace would be a shared-config change, off-limits per NFR-4).
  The frontend route carries the TLS Secret; the backend `/api` route serves the same host's
  cert via Traefik's SNI **certificate store** (so the Secret isn't copied into the backend).
  An HTTP `IngressRoute` + `redirect-https` Middleware sends all `:80` traffic for the host
  to HTTPS (308).
- **TLS**: a **namespaced** cert-manager `Issuer` `letsencrypt-cloudflare` (NOT a shared
  `ClusterIssuer`) solves ACME DNS-01 via Cloudflare using Clasher's **own** scoped token; the
  `Certificate` writes the keypair to Secret **`clasher-skpodduturi-dev-tls`**. It does not
  touch any shared issuer or the shared `cloudflare-ddns` resources.

**Required Secret** (out-of-band, #11): `cloudflare-api-token` (clasher-frontend), key
`api-token` — a Cloudflare token with **both** `Zone:DNS:Edit` **and** `Zone:Zone:Read`,
scoped to the `skpodduturi.dev` zone. (cert-manager lists zones to resolve the zone ID; a
`DNS:Edit`-only token fails zone lookup and the cert never issues.) #9's DDNS updater uses its
own separate token Secret.

**Prerequisites / operator notes** (verify before apply): cert-manager and Traefik are
admin-installed shared components on quasar. The manifests assume **Traefik v3**
(`traefik.io/v1alpha1`) with the k3s-default `web`/`websecure` entryPoints and Traefik pods
in `kube-system` labeled `app.kubernetes.io/name: traefik`. If quasar differs (Traefik v2 →
`traefik.containo.us/v1alpha1`; different ingress namespace/labels), adjust `routes.yaml` and
`networkpolicies/traefik.yaml` accordingly. The Cloudflare A record for the host is #9.

## DDNS (#9)

The quasar host has a dynamic public IP (NFR-8), and the design removed Clasher's edits to the
shared `cloudflare-ddns` configmap in favour of a Clasher-scoped updater (DESIGN §0/§9, NFR-4).
A `*/5` **CronJob** (`cloudflare-ddns`, clasher-frontend) runs a dependency-free Node script
(in-repo, in a ConfigMap; Node's global `fetch`, no npm install) that:

1. reads the host's public IP from `https://cloudflare.com/cdn-cgi/trace`,
2. resolves the zone and the **single** `clasher.skpodduturi.dev` A record, and
3. idempotently upserts it (no-op when unchanged; **refuses** to act if >1 A record exists).

It touches **only** that record via Clasher's **own** token — never the shared `cloudflare-ddns`
object or any other zone/record. Fail-loud: any API error exits non-zero so the Job shows
failed. Scoped RBAC = a dedicated ServiceAccount with no API permissions, token automount off;
non-root, PSA-restricted-clean; egress limited to public 443 (Cloudflare) by `ddns.yaml`.

**Required Secret** (out-of-band, #11): `cloudflare-ddns-token` (clasher-frontend), key
`api-token` — its **own** Cloudflare token (separate from the cert-manager one) with
`Zone:Zone:Read` + `Zone:DNS:Edit`, scoped to the `skpodduturi.dev` zone. The zone/record names
and TTL are non-secret env in the CronJob (`skpodduturi.dev`, `clasher.skpodduturi.dev`, 300,
proxied=false / DNS-only so the node is reachable directly).

Operator assumptions: the node has a routable **IPv4** public IP and its **outbound** NAT
address equals the **inbound** (port-forwarded) address — the updater publishes the node's
egress IPv4 (from `cdn-cgi/trace`, forced to IPv4) as the A record, so DNS-only reachability
breaks behind CGNAT or asymmetric NAT. The operator (or a one-time run) seeds the initial record;
the script then upserts it and refuses to act if more than one A record exists for the name.

## Backups (#10)

Nightly off-box **encrypted** `pg_dump` of the irreplaceable first-party data + a restore drill
(DESIGN §9/§10, NFR-7, D-5). A CronJob (`pg-backup`, clasher-backend) streams `pg_dump -Fc` into
`openssl cms -encrypt` (recipient public cert; private key off-box only) and rsyncs the ciphertext
off-box over SSH, pruning by `RETENTION_DAYS`. Full setup, the pre-migration hook, and the restore
drill (`restore-drill.sh`) are documented in [`deploy/backup/README.md`](../backup/README.md).

**Required (out-of-band, #11)**: ConfigMap `backup-recipient-cert` (key `recipient.crt`), Secret
`backup-ssh` (keys `id`, `known_hosts`), a **clasher-backend** Secret
`backup-postgres-credentials` (keys `username`/`password`/`dbname` — Secrets are namespace-local,
so the #7 `postgres-credentials` in clasher-database cannot be reused here), the `BACKUP_*` env +
the off-box `/32` in `backup.yaml`, and the backup image `ghcr.io/skrx7392/clasher-backup` (CI
builds it from `deploy/backup/Dockerfile`).

## Validation

CRD-aware (cert-manager + Traefik) validation uses the CRDs-catalog schema location:

```sh
kubectl kustomize deploy/k8s/base | kubeconform -strict -summary \
  -schema-location default \
  -schema-location 'https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json'
```

`kubectl apply` to quasar is an **operator step** (Tailscale + scoped kubectl) — not done
from CI. Populated across M0 infra issues **#6–#10** and CD **#13**.
