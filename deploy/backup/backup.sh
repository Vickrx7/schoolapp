#!/usr/bin/env bash
# Nightly backup (DECISIONS D-115): a logical dump of the data of `public` and `auth`, encrypted
# with age, with a manifest, kept BACKUP_KEEP_DAYS days and optionally copied to S3.
#
#   BACKUP_DATABASE_URL=postgresql://… BACKUP_AGE_RECIPIENT=age1… deploy/backup/backup.sh
#   docker compose run --rm backup            # the same, in the app image (deploy/docker)
#
# Settings (environment):
#   BACKUP_DATABASE_URL     the database, as its owner (`postgres`); a session connection
#   BACKUP_AGE_RECIPIENT    one or more age public keys (age1…, separated by spaces or commas).
#                           Only public keys: the private key never goes on the server.
#   BACKUP_SIGNING_KEY      32 random bytes as 64 hex digits (generate-secrets.mjs makes it): signs
#                           each backup, so restore.sh refuses a file someone else made or changed
#                           (the age public key alone lets anyone make one). The operator keeps a
#                           copy with the age identity; it is never stored with the backups.
#   BACKUP_DIR              where backups are written (default ./backups; /backups in the image)
#   BACKUP_KEEP_DAYS        local backups older than this are deleted (default 30)
#   BACKUP_S3_BUCKET, BACKUP_S3_REGION (default ca-central-1), BACKUP_S3_ACCESS_KEY_ID,
#   BACKUP_S3_SECRET_ACCESS_KEY, BACKUP_S3_PREFIX
#                           optional copy to S3 with a put-only key (versioning and lifecycle
#                           rules on the bucket: DEPLOYMENT.md)
#   BACKUP_S3_ENDPOINT      empty: Amazon S3 in BACKUP_S3_REGION. Otherwise the address of any
#                           S3-compatible storage (MinIO, Ceph, a NAS: https://s3.conseil.ca), used
#                           with path-style addresses (<endpoint>/<bucket>/<key>) and the same
#                           signature (BACKUP_S3_REGION is the region it expects, often us-east-1)
#   HEARTBEAT_URL_BACKUP    optional monitor pinged after a successful backup (it gets no data)
#   APP_RELEASE             recorded in the manifest and the heartbeat
#
# The result is BACKUP_DIR/lynx-backup-<UTC time>.tar holding two files, each encrypted to the
# recipients: dump.sql.gz.age (the dump, streamed from pg_dump to age, never on disk in clear) and
# manifest.json.age (release, migration and Auth migration versions, pg_dump and server versions,
# and each table's row count, counted in the dump itself so they match its snapshot), and
# `signature`: an HMAC-SHA256, with BACKUP_SIGNING_KEY, of both files' SHA-256 (D-115).
# deploy/backup/restore.sh checks it before decrypting anything, then reads the backup back.
set -euo pipefail
shopt -s nullglob

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_NAME=backup
# shellcheck source=deploy/backup/common.sh
. "$HERE/common.sh"

: "${BACKUP_DATABASE_URL:?set BACKUP_DATABASE_URL (the database to back up)}"
: "${BACKUP_AGE_RECIPIENT:?set BACKUP_AGE_RECIPIENT (an age public key, age1…)}"
: "${BACKUP_SIGNING_KEY:?set BACKUP_SIGNING_KEY (64 hex digits; generate-secrets.mjs makes one)}"
[[ "$BACKUP_SIGNING_KEY" =~ ^[0-9a-fA-F]{64}$ ]] ||
  die "BACKUP_SIGNING_KEY must be 64 hex digits (32 random bytes): openssl rand -hex 32"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
APP_RELEASE="${APP_RELEASE:-dev}"
[[ "$BACKUP_KEEP_DAYS" =~ ^[0-9]+$ ]] || die "BACKUP_KEEP_DAYS must be a number of days"
BAD_S3_ENDPOINT="BACKUP_S3_ENDPOINT must be an address such as https://s3.conseil.ca (no path, no query)"
if [[ -n "${BACKUP_S3_BUCKET:-}" ]]; then
  s3_object_url "${BACKUP_S3_ENDPOINT:-}" "$BACKUP_S3_BUCKET" x y > /dev/null || die "$BAD_S3_ENDPOINT"
fi

# Sessions, sign-in flows and Auth's own log are left out (D-115): everyone signs in again after
# a restore, and Auth's log (e-mail and IP addresses) is never copied off the database.
EXCLUDED_TABLES=(
  auth.schema_migrations
  auth.sessions
  auth.refresh_tokens
  auth.mfa_amr_claims
  auth.flow_state
  auth.one_time_tokens
  auth.audit_log_entries
)

recipients=()
for key in ${BACKUP_AGE_RECIPIENT//,/ }; do
  [[ "$key" == age1* ]] || die "BACKUP_AGE_RECIPIENT holds something that is not an age public key"
  recipients+=(-r "$key")
done

umask 077
mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="lynx-backup-$stamp"
work="$(mktemp -d "$BACKUP_DIR/.$name.XXXXXX")"
trap 'rm -rf "$work"' EXIT

log "dumping the database"
created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
excludes=()
for table in "${EXCLUDED_TABLES[@]}"; do excludes+=("--exclude-table=$table"); done

# The dump is counted on its way to age: every COPY block's rows, by table.
{
  echo 'SET session_replication_role = replica;'
  "$PG_DUMP" --dbname="$BACKUP_DATABASE_URL" --data-only --quote-all-identifiers \
    --no-owner --no-privileges --schema=public --schema=auth "${excludes[@]}"
} | awk -v counts="$work/counts.tsv" '
    { print }
    inblock && $0 == "\\." { printf "%s\t%d\n", table, rows > counts; inblock = 0; next }
    inblock { rows++; next }
    /^COPY / { table = $2; gsub(/"/, "", table); rows = 0; inblock = 1 }
    END { close(counts) }
  ' | gzip -c | age "${recipients[@]}" -o "$work/dump.sql.gz.age"

[[ -s "$work/counts.tsv" ]] || die "the dump holds no table: is this the right database?"

dump_bytes="$(wc -c < "$work/dump.sql.gz.age" | tr -d ' ')"
dump_sha="$(sha256sum "$work/dump.sql.gz.age" | cut -d' ' -f1)"
counts="$(jq -R -s -c 'split("\n") | map(select(length > 0) | split("\t") | {(.[0]): (.[1] | tonumber)}) | add // {}' < "$work/counts.tsv")"

jq -n \
  --arg createdAt "$created_at" \
  --arg release "$APP_RELEASE" \
  --arg pgDump "$("$PG_DUMP" --version)" \
  --arg serverVersion "$(sql "$BACKUP_DATABASE_URL" -c 'show server_version')" \
  --argjson migrations "$(applied_versions "$BACKUP_DATABASE_URL" | json_lines)" \
  --argjson authMigrations "$(auth_versions "$BACKUP_DATABASE_URL" | json_lines)" \
  --argjson excluded "$(printf '%s\n' "${EXCLUDED_TABLES[@]}" | json_lines)" \
  --argjson counts "$counts" \
  --argjson bytes "$dump_bytes" \
  --arg sha256 "$dump_sha" \
  '{format: 1, createdAt: $createdAt, release: $release, pgDump: $pgDump,
    serverVersion: $serverVersion, migrations: $migrations, authMigrations: $authMigrations,
    excludedTables: $excluded, counts: $counts,
    dump: {file: "dump.sql.gz.age", bytes: $bytes, sha256: $sha256}}' |
  age "${recipients[@]}" -o "$work/manifest.json.age"

# The signature: only the holder of BACKUP_SIGNING_KEY can make one that restore.sh accepts.
printf 'hmac-sha256:v1 %s\n' \
  "$(backup_signed_text "$work" | hmac_sha256_hex "$BACKUP_SIGNING_KEY")" > "$work/signature"

file="$BACKUP_DIR/$name.tar"
tar -C "$work" -cf "$work/$name.tar" signature manifest.json.age dump.sql.gz.age
mv "$work/$name.tar" "$file"
bytes="$(wc -c < "$file" | tr -d ' ')"
log "wrote $file ($bytes bytes, $(jq -r 'length' <<< "$counts") tables, $(jq -r '[.[]] | add' <<< "$counts") rows)"

if [[ -n "${BACKUP_S3_BUCKET:-}" ]]; then
  region="${BACKUP_S3_REGION:-ca-central-1}"
  : "${BACKUP_S3_ACCESS_KEY_ID:?set BACKUP_S3_ACCESS_KEY_ID for the S3 copy}"
  : "${BACKUP_S3_SECRET_ACCESS_KEY:?set BACKUP_S3_SECRET_ACCESS_KEY for the S3 copy}"
  url="$(s3_object_url "${BACKUP_S3_ENDPOINT:-}" "$BACKUP_S3_BUCKET" "$region" "${BACKUP_S3_PREFIX:-}$name.tar")" ||
    die "$BAD_S3_ENDPOINT"
  log "copying to s3://$BACKUP_S3_BUCKET/${BACKUP_S3_PREFIX:-}$name.tar${BACKUP_S3_ENDPOINT:+ at $BACKUP_S3_ENDPOINT}"
  # The key goes to curl on its standard input, never on a command line.
  printf 'user = "%s:%s"\n' "$BACKUP_S3_ACCESS_KEY_ID" "$BACKUP_S3_SECRET_ACCESS_KEY" |
    curl --config - -fsS --retry 3 --aws-sigv4 "aws:amz:$region:s3" \
      -H "x-amz-content-sha256: $(sha256sum "$file" | cut -d' ' -f1)" \
      -T "$file" "$url" -o /dev/null
fi

# The heartbeat « État du système » and `pnpm admin status` read (D-112), then the monitor.
if [[ "$(sql "$BACKUP_DATABASE_URL" -c "select to_regprocedure('app.record_heartbeat(text, text, jsonb)') is not null")" == t ]]; then
  sql "$BACKUP_DATABASE_URL" -v release="${APP_RELEASE:0:40}" -v bytes="$bytes" > /dev/null <<'SQL'
select app.record_heartbeat('backup', :'release', jsonb_build_object('bytes', :'bytes'::bigint));
SQL
fi
if [[ -n "${HEARTBEAT_URL_BACKUP:-}" ]]; then
  curl -fsS -m 10 --retry 2 -o /dev/null "$HEARTBEAT_URL_BACKUP" ||
    log "the monitor did not answer (the backup itself succeeded)"
fi

# Local copies older than BACKUP_KEEP_DAYS days.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'lynx-backup-*.tar' \
  -mmin +$((BACKUP_KEEP_DAYS * 1440)) -print -delete | sed 's/^/backup: deleted /' >&2
log "done"
