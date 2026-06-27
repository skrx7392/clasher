#!/bin/sh
# Clasher restore drill (DESIGN §9, NFR-7). Proves an off-box encrypted dump is recoverable:
# decrypts it with the PRIVATE key, restores into a throwaway Postgres (docker), and verifies the
# irreplaceable tables are present with their row counts. Run OFF-BOX (where the private key lives).
#
# Usage: restore-drill.sh <encrypted-dump.pgc.cms> <private-key.pem>
# Env:   PG_IMAGE (default postgres:18-alpine) — must match the source server major version.
set -eu

DUMP="${1:?usage: restore-drill.sh <dump.pgc.cms> <private-key.pem>}"
KEY="${2:?usage: restore-drill.sh <dump.pgc.cms> <private-key.pem>}"
IMAGE="${PG_IMAGE:-postgres:18-alpine}"
CTR="clasher-restore-drill-$$"
WORK="$(mktemp -d)"
cleanup() {
  rm -rf "${WORK}"
  docker rm -f "${CTR}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[drill] decrypting ${DUMP}"
openssl cms -decrypt -inform DER -in "${DUMP}" -inkey "${KEY}" -out "${WORK}/dump.pgc"
test -s "${WORK}/dump.pgc"

echo "[drill] starting throwaway Postgres (${IMAGE})"
docker run -d --name "${CTR}" \
  -e POSTGRES_PASSWORD=drill -e POSTGRES_USER=drill -e POSTGRES_DB=scratch "${IMAGE}" >/dev/null
ready=0
for _ in $(seq 1 60); do
  if docker exec "${CTR}" pg_isready -U drill -d scratch >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[ "${ready}" = 1 ] || {
  echo "[drill] FATAL: scratch Postgres never became ready"
  exit 1
}

echo "[drill] restoring (--exit-on-error so a partial restore fails; --no-owner/--no-acl: scratch user differs)"
docker cp "${WORK}/dump.pgc" "${CTR}:/tmp/dump.pgc"
docker exec "${CTR}" pg_restore -U drill -d scratch --no-owner --no-acl --exit-on-error /tmp/dump.pgc

echo "[drill] row counts on the irreplaceable + safety-net tables (NFR-7):"
fail=0
for t in users account_ownership clan_registrations giveaways giveaway_draws giveaway_winners war_snapshots cwl_seasons member_war_stats; do
  n="$(docker exec "${CTR}" psql -U drill -d scratch -tAc "select count(*) from ${t}" 2>/dev/null || echo MISSING)"
  echo "  ${t}: ${n}"
  [ "${n}" = MISSING ] && fail=1
done
[ "${fail}" = 0 ] || {
  echo "[drill] FAIL: one or more expected tables were missing after restore"
  exit 1
}
echo "[drill] PASS: encrypted dump decrypted and restored; all irreplaceable tables present"
