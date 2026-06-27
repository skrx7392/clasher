# deploy/backup — off-box encrypted Postgres backup + restore drill

Backs up the irreplaceable first-party data (registrations, giveaway seeds/results, safety-net
captures — DESIGN §9/§10, NFR-7, D-5). War/CWL history is re-derivable from ClashKing, so RPO
~24h is acceptable; no paid cloud (NFR-1). Backups contain PII and are **encrypted at rest**.

```
deploy/backup/
  Dockerfile          # backup image: postgres:18 client + openssl + openssh-client + rsync (CI builds it)
  restore-drill.sh    # OFF-BOX: decrypt + restore into a throwaway PG + verify (the drill)
  README.md           # this runbook
deploy/k8s/base/backup/
  backup.sh           # IN-CLUSTER: pg_dump -> CMS-encrypt -> rsync off-box -> prune (ConfigMap source)
  pg-backup-cronjob.yaml
deploy/k8s/base/networkpolicies/backup.yaml   # off-box SSH egress (operator sets the target /32)
```

## How it works

A nightly CronJob (`pg-backup`, clasher-backend, 03:17 UTC) streams `pg_dump -Fc` **straight
into** `openssl cms -encrypt` (so plaintext never touches disk), producing
`clasher-<timestamp>.pgc.cms`, then `rsync`s it off-box over SSH and prunes remotes older than
`RETENTION_DAYS`. Encryption is **asymmetric**: the cluster holds only the recipient **public**
cert, so a compromised backup pod **cannot decrypt its own backups** — decryption needs the
private key, which lives ONLY off-box.

## One-time operator setup (out-of-band, #11)

1. **Recipient keypair** (private key stays off-box; only the cert goes in-cluster):

   ```sh
   openssl req -x509 -newkey rsa:4096 -nodes -days 3650 \
     -keyout clasher-backup.key -out clasher-backup.crt -subj "/CN=clasher-backup"
   # Keep clasher-backup.key OFF-BOX (e.g. in a password manager / the MacBook). Never in-cluster.
   kubectl -n clasher-backend create configmap backup-recipient-cert \
     --from-file=recipient.crt=clasher-backup.crt
   ```

2. **Off-box SSH target** (e.g. the MacBook over Tailscale). Create a restricted SSH keypair, add
   its public key to the target's `authorized_keys`, then:

   ```sh
   ssh-keygen -t ed25519 -N '' -f clasher-backup-ssh        # in-cluster gets the PRIVATE key
   ssh-keyscan <target-host> > known_hosts                  # pin the host key
   kubectl -n clasher-backend create secret generic backup-ssh \
     --from-file=id=clasher-backup-ssh --from-file=known_hosts=known_hosts
   ```

3. **Target + retention**: set `BACKUP_TARGET`, `BACKUP_SSH_HOST`, `BACKUP_REMOTE_DIR`,
   `RETENTION_DAYS` in `pg-backup-cronjob.yaml` (replace the `REPLACE_ME_*` placeholders), and set
   the real off-box host `/32` in `networkpolicies/backup.yaml`. `BACKUP_TARGET`'s host must be (or
   resolve to) that exact `/32` — the standard egress policies `except` Tailscale/RFC1918, so the
   target is reachable only via that explicit allow.

4. **DB credentials in clasher-backend** — Secrets are namespace-local, so the backup pod (in
   clasher-backend) needs its OWN copy; it cannot reference the #7 `postgres-credentials` Secret
   that lives in clasher-database. Create a backend-namespace Secret (ideally for a read-capable
   dump role, or reuse the app credential values):

   ```sh
   kubectl -n clasher-backend create secret generic backup-postgres-credentials \
     --from-literal=username=<dump-user> \
     --from-literal=password=<dump-password> \
     --from-literal=dbname=<clasher-db>
   ```

## Pre-migration hook

Before any schema migration (CD #13 runs migrations behind a gate), trigger a one-shot off-box
dump first, so a known-good backup precedes the change:

```sh
kubectl -n clasher-backend create job --from=cronjob/pg-backup pg-backup-premigration-$(date +%s)
```

CD should run this and wait for success **before** applying migrations.

## Restore drill (NFR-7 — run periodically in the pilot)

`restore-drill.sh` decrypts a real encrypted dump with the off-box private key, restores it into a
throwaway Postgres (docker), and verifies the irreplaceable tables. Run it where the private key
and docker live (the MacBook):

```sh
./restore-drill.sh clasher-20260627T031700Z.pgc.cms clasher-backup.key
# ... [drill] PASS: encrypted dump decrypted and restored; all irreplaceable tables present
```

This exact flow is validated in CI/dev against the live §3 schema (dump → CMS encrypt → decrypt →
`pg_restore` → row-count verification) using `postgres:18-alpine`.
