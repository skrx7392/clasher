# Backup image: pg_dump (version-matched to the Postgres 18 server) + the tools the backup
# script needs (openssl for CMS encryption, openssh-client + rsync for off-box transfer).
# Built by CI (#13) as ghcr.io/skrx7392/clasher-backup:<sha>; CD pins by digest.
FROM postgres:18-alpine

# hadolint ignore=DL3018
RUN apk add --no-cache openssl openssh-client rsync

# The script is delivered via a ConfigMap mount at runtime (so it can change without a rebuild);
# this image only provides the toolchain. Runs as the image's non-root postgres user (uid 70).
USER 70:70
ENTRYPOINT ["/bin/sh"]
