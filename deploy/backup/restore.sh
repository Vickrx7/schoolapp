#!/usr/bin/env bash
# Restores a backup made by deploy/backup/backup.sh (DECISIONS D-115).
#
#   deploy/backup/restore.sh <lynx-backup-….tar> --identity <age key file> --db-url <url> [--yes] [--force]
#
# Run it from a workstation that holds the age private key (never the server), into a database
# that is already migrated to the backup's migrations (`migrate`, or tools/lite-stack/stack.sh
# fresh for a drill) with web and worker stopped. It:
#   1. refuses unless the target's migrations equal the backup's, and its Auth migrations include
#      the backup's (a newer Auth is fine);
#   2. refuses a target that already holds a board, unless --force (which replaces everything);
#   3. asks for confirmation, unless --yes;
#   4. in one transaction: empties the backed-up tables (and Auth's sessions), loads the dump, bans
#      again every person whose access was removed (an Auth ban can lag behind the database's),
#      checks every table's row count against the manifest, and hands the events of the hour
#      before the backup back to the worker's idempotent handlers (queued jobs are not backed up);
#   5. prints what is left to do by hand.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_NAME=restore
# shellcheck source=deploy/backup/common.sh
. "$HERE/common.sh"

# Event types whose every handler is idempotent and only reads the current state (worker
# src/handlers.ts): handed back to the worker after a restore. Not `absence.published` (it would
# issue a door credential again once integrations are real). Checked by a unit test.
REDISPATCH_EVENTS=(
  ai.job_requested
  absence.sources_changed
  library_bulk_run.started
  library_bulk_run.cancel_requested
  staff_invitation.created
  staff.access_changed
)
# Auth's sessions and sign-in flows are not in a backup: emptied, so everyone signs in again.
AUTH_SESSION_TABLES=(auth.sessions auth.refresh_tokens auth.mfa_amr_claims auth.flow_state auth.one_time_tokens)

usage() {
  sed -n '4p' "${BASH_SOURCE[0]}" | sed 's/^# *//' >&2
  exit 2
}

file="" identity="" url="" yes=no force=no
while [[ $# -gt 0 ]]; do
  case "$1" in
    --identity) identity="${2:-}"; shift 2 ;;
    --db-url) url="${2:-}"; shift 2 ;;
    --yes) yes=yes; shift ;;
    --force) force=yes; shift ;;
    -h | --help) usage ;;
    -*) log "unknown option $1"; usage ;;
    *) [[ -z "$file" ]] || usage; file="$1"; shift ;;
  esac
done
[[ -n "$file" && -n "$identity" && -n "$url" ]] || usage
[[ -f "$file" ]] || die "no such backup: $file"
[[ -f "$identity" ]] || die "no such age identity file: $identity"

umask 077
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

tar -xf "$file" -C "$work" manifest.json.age dump.sql.gz.age ||
  die "$file is not a backup made by backup.sh"
age -d -i "$identity" -o "$work/manifest.json" "$work/manifest.json.age" ||
  die "cannot decrypt the backup with $identity"
manifest="$work/manifest.json"
[[ "$(jq -r '.format' "$manifest")" == 1 ]] || die "unknown backup format"
[[ "$(sha256sum "$work/dump.sql.gz.age" | cut -d' ' -f1)" == "$(jq -r '.dump.sha256' "$manifest")" ]] ||
  die "the dump does not match its manifest (damaged or altered file)"

created_at="$(jq -r '.createdAt' "$manifest")"
[[ "$created_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] ||
  die "the manifest's time is not a UTC time"
jq -e '.counts | keys | all(test("^(public|auth)\\.[a-z0-9_]+$"))' "$manifest" > /dev/null ||
  die "the manifest names a table outside public and auth"
log "backup of $created_at (release $(jq -r '.release' "$manifest"), $(jq -r '.serverVersion' "$manifest"))"

# 1. Migrations: equal; Auth's: a superset.
jq -r '.migrations[]' "$manifest" > "$work/backup-migrations"
applied_versions "$url" > "$work/target-migrations"
if ! diff -q "$work/backup-migrations" "$work/target-migrations" > /dev/null; then
  log "the target's migrations differ from the backup's (< only in the backup, > only in the target):"
  diff "$work/backup-migrations" "$work/target-migrations" | grep '^[<>]' >&2 || true
  die "migrate the target to exactly the backup's migrations first (check out its release, run migrate)"
fi
jq -r '.authMigrations[]' "$manifest" | sort > "$work/backup-auth"
auth_versions "$url" | sort > "$work/target-auth"
missing_auth="$(comm -23 "$work/backup-auth" "$work/target-auth")"
[[ -z "$missing_auth" ]] ||
  die "the target's Auth is older than the backup's (missing Auth migrations: $(tr '\n' ' ' <<< "$missing_auth"))"

# 2. An empty target, unless --force.
if has_data "$url"; then
  [[ "$force" == yes ]] || die "the target already holds data (a board exists): use --force to replace it all"
  log "--force: everything in the target will be replaced"
fi

# 3. Confirmation.
target="$(sql "$url" -c "select current_user || '@' || coalesce(host(inet_server_addr()), 'local') || '/' || current_database()")"
log "restoring $(jq -r '[.counts[]] | add' "$manifest") rows in $(jq -r '.counts | length' "$manifest") tables into $target"
if [[ "$yes" != yes ]]; then
  read -r -p "Type « restore » to continue: " answer || die "cancelled (no answer; --yes skips the question)"
  [[ "$answer" == restore ]] || die "cancelled"
fi

# 4. One transaction.
tables="$(jq -r '.counts | keys[]' "$manifest")"
for table in "${AUTH_SESSION_TABLES[@]}"; do
  if [[ "$(sql "$url" -c "select to_regclass('$table') is not null")" == t ]]; then tables+=$'\n'"$table"; fi
done
truncate_list="$(printf '%s\n' "$tables" | awk -F. 'NF == 2 { printf "%s\"%s\".\"%s\"", sep, $1, $2; sep = ", " }')"
expected="$(jq -r --arg q "'" '.counts | to_entries
  | map("(" + $q + .key + $q + ", " + (.value | tostring) + ")") | join(",\n  ")' "$manifest")"
events="$(printf "'%s'," "${REDISPATCH_EVENTS[@]}")"
events="${events%,}"

cat > "$work/pre.sql" <<SQL
begin;
set session_replication_role = replica;
truncate table $truncate_list;
SQL

cat > "$work/post.sql" <<SQL
set session_replication_role = replica;

-- Everyone whose access was removed is banned again (D-107, D-115).
with banned as (
  update auth.users as a set banned_until = now() + interval '100 years'
  from public.users as u
  where u.id = a.id and u.deactivated_at is not null
  returning 1
)
select count(*) as banned from banned \gset

-- Every table holds exactly what the backup counted.
create temporary table restore_expected (tbl text primary key, n bigint not null) on commit drop;
insert into restore_expected values
  $expected;
do \$\$
declare
  r record;
  actual bigint;
  wrong text := '';
begin
  for r in select tbl, n from restore_expected order by tbl loop
    execute format('select count(*) from %I.%I', split_part(r.tbl, '.', 1), split_part(r.tbl, '.', 2))
      into actual;
    if actual <> r.n then
      wrong := wrong || format(' %s (%s, expected %s)', r.tbl, actual, r.n);
    end if;
  end loop;
  if wrong <> '' then
    raise exception 'row counts differ from the manifest:%', wrong;
  end if;
end
\$\$;

-- Queued jobs are not in the backup: recent events go back to the idempotent handlers.
with handed_back as (
  update public.event_outbox set dispatched_at = null
  where dispatched_at >= timestamptz '$created_at' - interval '1 hour'
    and event_type in ($events)
  returning 1
)
select count(*) as redispatched from handed_back \gset

commit;
\echo restore: loaded; :banned deactivated people banned again; :redispatched recent events handed back to the worker
SQL

# A dump made by pg_dump 17 sets transaction_timeout, which an older server does not know (the
# monthly drill can run on the lite stack's Postgres 16): that one header line is dropped there.
server_num="$(sql "$url" -c 'show server_version_num')"
log "loading (one transaction)"
{
  cat "$work/pre.sql"
  age -d -i "$identity" "$work/dump.sql.gz.age" | gunzip -c |
    awk -v old="$([[ "$server_num" -lt 170000 ]] && echo 1 || echo 0)" '
      /^COPY / { copying = 1 }
      old && !copying && /^SET transaction_timeout = / { next }
      { print }
    '
  cat "$work/post.sql"
} | "$PSQL" --dbname="$url" -X -q -o /dev/null -v ON_ERROR_STOP=1 -f - ||
  die "the restore failed and was rolled back: the target is as it was"

# 5. What is left to do by hand.
cat >&2 <<TEXT
restore: done. Every table's row count matches the backup's manifest.

What is left to do (DEPLOYMENT.md § Backups and restore):
  1. Access removed or roles changed after $created_at are not in this backup: apply them again
     (« Conseil » or pnpm admin deactivate), from the board's and the operator's records.
  2. Sessions are not restored: everyone signs in again with an e-mailed code. Tell the staff.
  3. Start web and worker, then check /api/health/ready and « État du système ».
  4. Record the restore: pnpm admin log-operator-access --board <slug> --reason restore
TEXT
