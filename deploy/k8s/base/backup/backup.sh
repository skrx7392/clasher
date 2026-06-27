#!/bin/sh
# Clasher off-box encrypted Postgres backup (DESIGN §9/§10, NFR-7). Runs in-cluster nightly.
# Streams `pg_dump -Fc` STRAIGHT INTO openssl CMS encryption (recipient public cert) so the
# plaintext dump never touches disk, then rsyncs the encrypted blob off-box over SSH and prunes
# old remotes. Decryption needs the PRIVATE key, which lives ONLY off-box — this pod cannot read
# its own backups. Fail-loud: any error aborts non-zero so the Kubernetes Job is marked failed.
set -eu
# Enable pipefail when the shell supports it (busybox ash does) so a pg_dump failure in the
# `pg_dump | openssl` pipe aborts instead of producing a truncated "successful" ciphertext.
# shellcheck disable=SC3040  # pipefail is supported by the busybox ash runtime; guarded anyway
if (set -o pipefail) 2>/dev/null; then set -o pipefail; fi

: "${PGHOST:?PGHOST required}"
: "${PGUSER:?PGUSER required}"
: "${PGDATABASE:?PGDATABASE required}"
: "${PGPASSWORD:?PGPASSWORD required}"
: "${BACKUP_TARGET:?BACKUP_TARGET required (rsync dest, e.g. user@host:/srv/clasher-backups)}"
: "${BACKUP_SSH_HOST:?BACKUP_SSH_HOST required (ssh dest for prune, e.g. user@host)}"
: "${BACKUP_REMOTE_DIR:?BACKUP_REMOTE_DIR required (remote dir for retention prune)}"
: "${RETENTION_DAYS:?RETENTION_DAYS required}"
RECIPIENT_CERT="${RECIPIENT_CERT:-/certs/recipient.crt}"
SSH_KEY="${SSH_KEY:-/ssh/id}"
KNOWN_HOSTS="${KNOWN_HOSTS:-/ssh/known_hosts}"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="/work/clasher-${TS}.pgc.cms"
# SSH refuses a private key that is group/world-readable; the mounted Secret is group-readable
# (so our non-root uid can read it), so stage an owner-only (0400) copy for ssh to use.
cp "${SSH_KEY}" /work/id
chmod 400 /work/id
SSH_KEY=/work/id
# Reject a non-numeric/zero retention before it reaches the remote find command.
case "${RETENTION_DAYS}" in
'' | *[!0-9]*)
  echo "[backup] FATAL: RETENTION_DAYS must be a positive integer, got '${RETENTION_DAYS}'"
  exit 1
  ;;
esac
[ "${RETENTION_DAYS}" -ge 1 ] || {
  echo "[backup] FATAL: RETENTION_DAYS must be >= 1"
  exit 1
}

# UpdateHostKeys=no: don't attempt to write learned keys back to the read-only known_hosts mount.
SSH_OPTS="-i ${SSH_KEY} -o UserKnownHostsFile=${KNOWN_HOSTS} -o StrictHostKeyChecking=yes -o BatchMode=yes -o UpdateHostKeys=no"
NAME="$(basename "${OUT}")"

echo "[backup] dumping ${PGDATABASE}@${PGHOST} and encrypting -> ${NAME}"
pg_dump -Fc | openssl cms -encrypt -binary -aes-256-cbc -outform DER -out "${OUT}" "${RECIPIENT_CERT}"
test -s "${OUT}" || {
  echo "[backup] FATAL: encrypted dump is empty"
  exit 1
}

# Upload to a ".inprogress" name (outside the clasher-*.pgc.cms prune glob), then atomically
# rename on the remote — so an interrupted transfer never leaves a truncated file under the final
# name that the restore drill might pick up.
echo "[backup] pushing off-box -> ${BACKUP_TARGET}/${NAME}"
# shellcheck disable=SC2086  # SSH_OPTS is intentionally word-split into rsync's -e argument
rsync -e "ssh ${SSH_OPTS}" --checksum "${OUT}" "${BACKUP_TARGET}/${NAME}.inprogress"
# shellcheck disable=SC2029,SC2086  # mv runs remotely; SSH_OPTS word-splitting is intentional
ssh ${SSH_OPTS} "${BACKUP_SSH_HOST}" \
  "mv -f '${BACKUP_REMOTE_DIR}/${NAME}.inprogress' '${BACKUP_REMOTE_DIR}/${NAME}'"

# Retention: -mtime +N keeps roughly the last N+1 days (errs toward keeping one extra day, which
# is the safe direction for backups).
echo "[backup] pruning remotes older than ${RETENTION_DAYS}d in ${BACKUP_REMOTE_DIR}"
# shellcheck disable=SC2029,SC2086  # find runs remotely; SSH_OPTS word-splitting is intentional
ssh ${SSH_OPTS} "${BACKUP_SSH_HOST}" \
  "find '${BACKUP_REMOTE_DIR}' -maxdepth 1 -name 'clasher-*.pgc.cms' -mtime +${RETENTION_DAYS} -delete"

echo "[backup] done: ${NAME}"
