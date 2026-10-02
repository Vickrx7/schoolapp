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
