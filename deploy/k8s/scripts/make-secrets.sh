#!/usr/bin/env bash
#
# make-secrets.sh — provision a Clasher Kubernetes Secret from out-of-band material
# WITHOUT ever putting secret values on a command line (argv) or in logs.
#
# Why this exists (DESIGN §9, §10; NFR-3):
#   The official approach is "GitHub repo/Environment secret -> k8s Secret via
#   --from-env-file (masked; not on argv)". This script is that mechanism. kubectl
#   reads the secret VALUES directly from the file you pass; the values never become
#   shell variables, never appear in `ps`/argv, and never reach a terminal or log.
#   The rendered manifest (base64 values) is piped straight into `kubectl apply`,
#   so it is never displayed either.
#
# What you CAN see (by design, safe):
#   - the Secret name, namespace, type, and the KEY names (never the values).
#
# Usage:
#   make-secrets.sh --name NAME --namespace NS --env-file FILE [opts]
#   make-secrets.sh --name NAME --namespace NS --from-file KEY=PATH [--from-file K2=P2 ...] [opts]
#
# Required:
#   --name NAME            Secret name (RFC 1123, e.g. postgres-credentials)
#   --namespace NS         target namespace (e.g. clasher-database)
#   one source, exactly one of:
#     --env-file FILE       a KEY=VALUE env-file; each line becomes a Secret key
#     --from-file KEY=PATH  a single key whose value is a file's contents (repeatable)
#
# Options:
#   --type TYPE           Secret type (default Opaque). e.g. kubernetes.io/dockerconfigjson
#   --context CTX         kube context to target (default: current-context)
#   --dry-run             render & validate only; print the keys, apply NOTHING
#   --yes                 skip the "apply to <context>?" confirmation
#   -h, --help            this help
#
# Examples (see deploy/k8s/SECRETS.md for the full runbook + per-secret recipes):
#   make-secrets.sh --name postgres-credentials --namespace clasher-database \
#       --env-file ./secrets/postgres-credentials.secret.env
#   make-secrets.sh --name backup-ssh --namespace clasher-backend \
#       --from-file id=./secrets/backup_id_ed25519 --from-file known_hosts=./secrets/known_hosts
#   make-secrets.sh --name ghcr-pull --namespace clasher-backend \
#       --type kubernetes.io/dockerconfigjson --from-file .dockerconfigjson=./secrets/ghcr-dockerconfig.json
#
set -euo pipefail

PROG="$(basename "$0")"

die() { printf '%s: error: %s\n' "$PROG" "$*" >&2; exit 1; }
# Print the header comment block (everything between the shebang and `set -euo`),
# stripping the leading '# '. Uses awk for BSD/GNU portability.
usage() {
  awk 'NR==1 { next } /^set -euo pipefail/ { exit } { line=$0; sub(/^#( |$)/, "", line); print line }' "$0"
}

command -v kubectl >/dev/null 2>&1 || die "kubectl not found on PATH"

NAME=""
NAMESPACE=""
ENV_FILE=""
SECRET_TYPE="Opaque"
CONTEXT=""
DRY_RUN=0
ASSUME_YES=0
FROM_FILE_ARGS=()   # accumulates: --from-file KEY=PATH

while [ $# -gt 0 ]; do
  case "$1" in
    --name)       NAME="${2:-}"; shift 2 ;;
    --namespace)  NAMESPACE="${2:-}"; shift 2 ;;
    --env-file)   ENV_FILE="${2:-}"; shift 2 ;;
    --from-file)  FROM_FILE_ARGS+=("${2:-}"); shift 2 ;;
    --type)       SECRET_TYPE="${2:-}"; shift 2 ;;
    --context)    CONTEXT="${2:-}"; shift 2 ;;
    --dry-run)    DRY_RUN=1; shift ;;
    --yes|-y)     ASSUME_YES=1; shift ;;
    -h|--help)    usage; exit 0 ;;
    *)            die "unknown argument: $1 (try --help)" ;;
  esac
done

# ---- validate inputs -------------------------------------------------------
[ -n "$NAME" ]      || die "--name is required"
[ -n "$NAMESPACE" ] || die "--namespace is required"

# RFC 1123 subdomain (k8s Secret name).
printf '%s' "$NAME" | grep -Eq '^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$' \
  || die "invalid --name '$NAME' (must be a lowercase RFC 1123 name)"

# Blast-radius guard: Clasher Secrets only ever live in clasher-* namespaces (NFR-4).
case "$NAMESPACE" in
  clasher-*) : ;;
  *) die "refusing: --namespace '$NAMESPACE' is not a clasher-* namespace (NFR-4 blast-radius)" ;;
esac

# Exactly one source.
if [ -n "$ENV_FILE" ] && [ "${#FROM_FILE_ARGS[@]}" -gt 0 ]; then
  die "use either --env-file OR --from-file, not both"
fi
if [ -z "$ENV_FILE" ] && [ "${#FROM_FILE_ARGS[@]}" -eq 0 ]; then
  die "one source required: --env-file FILE or --from-file KEY=PATH"
fi

# Reject world-readable or git-tracked secret material before we touch it.
assert_secret_file() {
  local f="$1"
  [ -f "$f" ] || die "file not found: $f"
  [ -r "$f" ] || die "file not readable: $f"
  # Refuse group- or world-readable material: on the shared quasar host a 0640/0644
  # plaintext credential is a concrete read path for a co-tenant (NFR-4). chmod 600 first.
  if [ -n "$(find "$f" -perm -g+r 2>/dev/null)" ] || [ -n "$(find "$f" -perm -o+r 2>/dev/null)" ]; then
    die "secret material '$f' is group- or world-readable; chmod 600 it first"
  fi
  # If it sits inside a git work tree and is tracked, refuse — values must never be committed.
  if git -C "$(cd "$(dirname "$f")" && pwd)" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    if git -C "$(cd "$(dirname "$f")" && pwd)" ls-files --error-unmatch "$f" >/dev/null 2>&1; then
      die "refusing: '$f' is tracked by git (secret material must never be committed)"
    fi
  fi
}

# Build the `kubectl create secret generic` argument array. Secret VALUES enter
# only as file paths that kubectl reads itself — never as argv values here.
CREATE_ARGS=(create secret generic "$NAME" --namespace "$NAMESPACE" --type "$SECRET_TYPE")

if [ -n "$ENV_FILE" ]; then
  assert_secret_file "$ENV_FILE"
  # Sanity-check the env-file is KEY=VALUE (ignore blanks/comments); never print values.
  # The key may be any valid k8s Secret data key [-._a-zA-Z0-9] (e.g. `api-token`), which
  # is broader than a shell identifier — kubectl --from-env-file accepts these.
  if grep -Ev '^[[:space:]]*(#|$)' "$ENV_FILE" | grep -Evq '^[A-Za-z0-9_][A-Za-z0-9_.-]*='; then
    die "env-file '$ENV_FILE' has lines that are not KEY=VALUE"
  fi
  CREATE_ARGS+=(--from-env-file "$ENV_FILE")
else
  for spec in "${FROM_FILE_ARGS[@]}"; do
    case "$spec" in
      *=*) : ;;
      *) die "--from-file must be KEY=PATH (got '$spec')" ;;
    esac
    path="${spec#*=}"
    assert_secret_file "$path"
    CREATE_ARGS+=(--from-file "$spec")
  done
fi

CTX_ARGS=()
[ -n "$CONTEXT" ] && CTX_ARGS=(--context "$CONTEXT")

# Resolve the effective context for the confirmation prompt. `kubectl config
# current-context` ignores the global --context override, so when --context is given
# it is the cluster we actually write to — show that, not the kubeconfig default.
if [ -n "$CONTEXT" ]; then
  EFFECTIVE_CTX="$CONTEXT"
else
  EFFECTIVE_CTX="$(kubectl config current-context 2>/dev/null || echo '<none>')"
fi

# go-template that prints only the KEY names of the rendered Secret — never values.
KEYS_TMPL='{{range $k, $_ := .data}}{{$k}}{{"\n"}}{{end}}'

echo "Secret:    $NAME"
echo "Namespace: $NAMESPACE"
echo "Type:      $SECRET_TYPE"
echo "Context:   $EFFECTIVE_CTX"
echo "Keys:"
kubectl ${CTX_ARGS[@]+"${CTX_ARGS[@]}"} "${CREATE_ARGS[@]}" --dry-run=client -o go-template="$KEYS_TMPL" \
  | sed 's/^/  - /'

if [ "$DRY_RUN" -eq 1 ]; then
  echo "(--dry-run) nothing applied."
  exit 0
fi

# Verify the namespace exists so we fail loud rather than create an orphan later.
kubectl ${CTX_ARGS[@]+"${CTX_ARGS[@]}"} get namespace "$NAMESPACE" >/dev/null 2>&1 \
  || die "namespace '$NAMESPACE' not found in context '$EFFECTIVE_CTX' (apply the #6 base first)"

if [ "$ASSUME_YES" -ne 1 ]; then
  printf 'Apply Secret "%s" to namespace "%s" on context "%s"? [y/N] ' \
    "$NAME" "$NAMESPACE" "$EFFECTIVE_CTX"
  read -r reply
  case "$reply" in
    y|Y|yes|YES) : ;;
    *) die "aborted by operator" ;;
  esac
fi

# Idempotent create-or-update. The rendered manifest (base64 values) flows ONLY
# through this pipe into apply — it is never echoed to a terminal or a log.
kubectl ${CTX_ARGS[@]+"${CTX_ARGS[@]}"} "${CREATE_ARGS[@]}" --dry-run=client -o yaml \
  | kubectl ${CTX_ARGS[@]+"${CTX_ARGS[@]}"} apply -f -

echo "Applied. Confirmed keys in cluster:"
kubectl ${CTX_ARGS[@]+"${CTX_ARGS[@]}"} -n "$NAMESPACE" get secret "$NAME" -o go-template="$KEYS_TMPL" \
  | sed 's/^/  - /'
