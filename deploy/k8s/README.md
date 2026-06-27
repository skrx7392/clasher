# deploy/k8s — placeholder

Kubernetes manifests for the self-hosted k3s cluster (`quasar`): namespaces,
NetworkPolicies, RBAC, Postgres, Redis, ingress + TLS, DDNS, backups.

Populated across M0 infra issues **#6–#10** and the CD pipeline **#13**.
Everything must be in-repo and rebuildable on a fresh host (NFR-2).
