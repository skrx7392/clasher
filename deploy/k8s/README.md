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
  overlays/
    quasar/                     # production overlay (workloads land here in #8–#10, #13)
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

| From                                        | To                                            | Port       | Why                      |
| ------------------------------------------- | --------------------------------------------- | ---------- | ------------------------ |
| `clasher-frontend` (web)                    | `clasher-backend` (api)                       | 3000/tcp   | SSR → API                |
| `clasher-backend` (api/worker)              | `clasher-database` (postgres)                 | 5432/tcp   | DB access                |
| `clasher-backend` (api/worker)              | `clasher-database` (redis-queue, redis-cache) | 6379/tcp   | queue + cache            |
| `clasher-backend` (coc-gateway)             | public internet (excl. private/cluster CIDRs) | 443/tcp    | RoyaleAPI proxy **only** |
| `clasher-frontend` + `clasher-backend` pods | `kube-system` CoreDNS                         | 53/udp+tcp | DNS                      |

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
(added by the issue that needs them): Traefik ingress-controller ingress (#8), api →
coc-gateway intra-namespace (M2), api → `api.clashk.ing` egress (M2), web → Google OAuth
egress (#15), database backup egress (#10).

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
bootstrap (runbook in #11): Namespaces (cluster-scoped), NetworkPolicies, RBAC, Secrets,
LimitRanges/ResourceQuotas, and later Ingress/TLS. CD (`clasher-deployer`) only rolls the
per-release workloads. This is why the deploy Role excludes those foundation resources.

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

## Validation

```sh
kubectl kustomize deploy/k8s/base | kubeconform -strict -summary \
  -schema-location default
```

`kubectl apply` to quasar is an **operator step** (Tailscale + scoped kubectl) — not done
from CI. Populated across M0 infra issues **#6–#10** and CD **#13**.
