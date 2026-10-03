# shellcheck shell=bash disable=SC2034
# Shared by deploy/backup/backup.sh, deploy/backup/restore.sh and deploy/docker/migrate.sh
# (sourced, not run). PostgreSQL client programs come from PATH, or from PG_BIN when set (for
# example PG_BIN=/usr/lib/postgresql/17/bin next to an older default client).

PSQL="${PG_BIN:+$PG_BIN/}psql"
PG_DUMP="${PG_BIN:+$PG_BIN/}pg_dump"

# The tables that record applied migrations: the Supabase CLI's (`supabase db push`, hosted and
# board-hosted), and the lite stack's locally (tools/lite-stack). A version in either counts.
MIGRATION_TABLES="'supabase_migrations.schema_migrations','lite_stack.schema_migrations'"

log() { printf '%s: %s\n' "${LOG_NAME:-lynx}" "$*" >&2; }
die() {
  log "$*"
  exit 1
}

# One value or rows from a query: unaligned, tuples only, no psqlrc, stop on error.
sql() { # url, psql arguments…
  local url="$1"
  shift
  "$PSQL" --dbname="$url" -X -A -t -q -v ON_ERROR_STOP=1 "$@"
}

# The migration versions (14 digits) shipped in a directory, one per line, in order.
shipped_versions() { # directory
  local f
  for f in "$1"/*.sql; do
    f="$(basename "$f")"
    if [[ "$f" =~ ^[0-9]{14}_ ]]; then printf '%s\n' "${f:0:14}"; fi
  done | sort -u
}

# The migration versions a database recorded (14 digits), one per line, in order; nothing for a
# database that was never migrated.
applied_versions() { # url
  local union
  union="$(sql "$1" -c "select string_agg(format('select left(version::text, 14) as v from %s', t), ' union ')
    from unnest(array[$MIGRATION_TABLES]) as t where to_regclass(t) is not null")"
  if [[ -n "$union" ]]; then sql "$1" -c "select distinct v from ($union) as m order by v"; fi
}

# Supabase Auth's own migrations, one per line, in order (nothing before Auth first started).
auth_versions() { # url
  if [[ "$(sql "$1" -c "select to_regclass('auth.schema_migrations') is not null")" == t ]]; then
    sql "$1" -c "select version::text from auth.schema_migrations order by 1"
  fi
}

# Whether the database holds an install's data (a board exists).
has_data() { # url
  [[ "$(sql "$1" -c "select to_regclass('public.boards') is not null")" == t ]] &&
    [[ "$(sql "$1" -c "select exists (select 1 from public.boards)")" == t ]]
}

# Lines to a JSON array of strings.
json_lines() { jq -R -s -c 'split("\n") | map(select(length > 0))'; }

# Where backup.sh puts a backup's copy (D-115): Amazon S3 by default (the bucket's own address in
# the region), or any S3-compatible storage at BACKUP_S3_ENDPOINT, path-style. Fails (status 1) on
# an endpoint that is not a bare http(s) address. The key is the prefix and the file's name.
s3_object_url() { # endpoint (may be empty), bucket, region, key
  local endpoint="$1" bucket="$2" region="$3" key="$4"
  if [[ -z "$endpoint" ]]; then
    printf 'https://%s.s3.%s.amazonaws.com/%s\n' "$bucket" "$region" "$key"
    return 0
  fi
  [[ "$endpoint" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?/?$ ]] || return 1
  printf '%s/%s/%s\n' "${endpoint%/}" "$bucket" "$key"
}

# HMAC-SHA256 of standard input with a 32-byte key given as 64 hex digits (DECISIONS D-115:
# backups are signed with BACKUP_SIGNING_KEY). Bash and sha256sum only: the key never appears on
# a command line, where other users of the machine could read it. Prints the MAC in hex.
hmac_sha256_hex() { # hex key
  local key="$1" ipad="" opad="" inner="" inner_bytes="" i byte
  [[ "$key" =~ ^[0-9a-fA-F]{64}$ ]] || return 1
  key="${key}$(printf '%0128d' 0)"
  key="${key:0:128}"
  for ((i = 0; i < 128; i += 2)); do
    byte=$((16#${key:i:2}))
    ipad+="$(printf '\\x%02x' $((byte ^ 0x36)))"
    opad+="$(printf '\\x%02x' $((byte ^ 0x5c)))"
  done
  inner="$({
    printf '%b' "$ipad"
    cat
  } | sha256sum | cut -d' ' -f1)"
  for ((i = 0; i < 64; i += 2)); do inner_bytes+="\\x${inner:i:2}"; done
  {
    printf '%b' "$opad"
    printf '%b' "$inner_bytes"
  } | sha256sum | cut -d' ' -f1
}

# What a backup's signature covers: its two encrypted files, by their SHA-256.
backup_signed_text() { # directory holding manifest.json.age and dump.sql.gz.age
  printf 'lynx-backup-signature:v1\nmanifest.json.age %s\ndump.sql.gz.age %s\n' \
    "$(sha256sum "$1/manifest.json.age" | cut -d' ' -f1)" \
    "$(sha256sum "$1/dump.sql.gz.age" | cut -d' ' -f1)"
}

# The signing key from a file (a line of 64 hex digits, or BACKUP_SIGNING_KEY=…), or nothing.
read_signing_key() { # file
  sed -n -E 's/^(BACKUP_SIGNING_KEY=)?([0-9a-fA-F]{64})[[:space:]]*$/\2/p' "$1" | head -n 1
}
