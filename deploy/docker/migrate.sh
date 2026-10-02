#!/usr/bin/env bash
# Brings the database to this release (DECISIONS D-114). The `migrate` service of compose.yml runs
# it (app image) before web and worker start; they start only if it succeeds.
#   1. waits for the database;
#   2. lists the migrations it does not have yet (supabase/migrations against
#      supabase_migrations.schema_migrations);
#   3. when there are some and the database holds data (a board), takes a backup first
#      (deploy/backup/backup.sh), and refuses without BACKUP_AGE_RECIPIENT unless
#      MIGRATE_WITHOUT_BACKUP=yes;
#   4. applies them with `supabase db push`;
#   5. sets the portal roles' logins from SUB_PORTAL_PASSWORD and CLASS_PORTAL_PASSWORD (empty:
#      unchanged), as SCRAM verifiers (portal-passwords.mjs);
#   6. asks PostgREST to reload its schema.
#
# Settings: MIGRATIONS_DATABASE_URL (the database owner, `postgres`, in session mode), the BACKUP_*
# settings of backup.sh (BACKUP_DATABASE_URL defaults to MIGRATIONS_DATABASE_URL),
# MIGRATE_WITHOUT_BACKUP, SUB_PORTAL_PASSWORD, CLASS_PORTAL_PASSWORD.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
LOG_NAME=migrate
# shellcheck source=deploy/backup/common.sh
. "$ROOT/deploy/backup/common.sh"

: "${MIGRATIONS_DATABASE_URL:?set MIGRATIONS_DATABASE_URL (the database, as its owner)}"
SUPABASE_BIN="${SUPABASE_BIN:-$ROOT/node_modules/.bin/supabase}"
# The directory holding supabase/ (migrations and config.toml): the checkout, or a copy in tests.
MIGRATIONS_WORKDIR="${MIGRATIONS_WORKDIR:-$ROOT}"
# The Supabase CLI calls nothing but the database here: no telemetry, no update check.
export DO_NOT_TRACK=1 SUPABASE_TELEMETRY_DISABLED=1 SUPABASE_NO_UPDATE_NOTIFIER=1

# 1. The database (two minutes at most: a first start of the self-hosted one takes a while).
for attempt in $(seq 1 60); do
  if sql "$MIGRATIONS_DATABASE_URL" -c 'select 1' > /dev/null 2>&1; then break; fi
  [[ "$attempt" -lt 60 ]] || die "the database did not answer within 2 minutes"
  sleep 2
done

# 2. What is missing.
pending="$(comm -23 \
  <(shipped_versions "$MIGRATIONS_WORKDIR/supabase/migrations" | sort) \
  <(applied_versions "$MIGRATIONS_DATABASE_URL" | sort))"

if [[ -z "$pending" ]]; then
  log "the database has every migration of this release"
else
  log "$(wc -l <<< "$pending" | tr -d ' ') migrations to apply (the newest: $(tail -n 1 <<< "$pending"))"

  # 3. A backup first, when there is something to lose.
  if has_data "$MIGRATIONS_DATABASE_URL"; then
    if [[ -n "${BACKUP_AGE_RECIPIENT:-}" ]]; then
      log "taking a backup first"
      BACKUP_DATABASE_URL="${BACKUP_DATABASE_URL:-$MIGRATIONS_DATABASE_URL}" "$ROOT/deploy/backup/backup.sh"
    elif [[ "${MIGRATE_WITHOUT_BACKUP:-}" == yes ]]; then
      log "MIGRATE_WITHOUT_BACKUP=yes: applying them without a backup"
    else
      die "refusing to migrate a database that holds data without a backup first: set BACKUP_AGE_RECIPIENT (or MIGRATE_WITHOUT_BACKUP=yes, once you hold a recent backup)"
    fi
  fi

  # 4. The migrations, each in its own transaction, recorded in supabase_migrations.
  "$SUPABASE_BIN" db push --workdir "$MIGRATIONS_WORKDIR" --db-url "$MIGRATIONS_DATABASE_URL" \
    --yes --skip-vault
fi

# 5. The portal roles' logins.
node "$HERE/portal-passwords.mjs" | sql "$MIGRATIONS_DATABASE_URL" > /dev/null

# 6. PostgREST serves the new schema.
sql "$MIGRATIONS_DATABASE_URL" -c "notify pgrst, 'reload schema'" > /dev/null
log "done"
