#!/usr/bin/env bash
# Docker-free local stack: Postgres + Supabase Auth + PostgREST + Mailpit + a tiny gateway.
# Mirrors the ports of `supabase start` so the same .env works with either.
# For sandboxes and machines without Docker. The Supabase CLI remains the default path.
set -euo pipefail
shopt -s nullglob

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
DATA="$HERE/.data"
BIN="$HERE/.bin"

AUTH_VERSION="${AUTH_VERSION:-v2.177.0}"
POSTGREST_VERSION="${POSTGREST_VERSION:-v12.2.12}"
MAILPIT_VERSION="${MAILPIT_VERSION:-v1.27.7}"

PG_BIN="${PG_BIN:-$(pg_config --bindir 2>/dev/null || echo /usr/lib/postgresql/16/bin)}"
PG_PORT=54322
API_PORT=54321
AUTH_PORT=9999
REST_PORT=54330
MAIL_HTTP_PORT=54324
MAIL_SMTP_PORT=54325
JWT_SECRET="super-secret-jwt-token-with-at-least-32-characters-long"
SITE_URL="${SITE_URL:-http://localhost:3000}"
DB_URL="postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/postgres"

log() { printf '\033[1;34m[lite-stack]\033[0m %s\n' "$*"; }

psql_db() { PGPASSWORD=postgres "$PG_BIN/psql" -v ON_ERROR_STOP=1 -q -h 127.0.0.1 -p "$PG_PORT" -U postgres -d postgres "$@"; }

wait_for() { # url, name
  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null "$1" 2>/dev/null; then return 0; fi
    sleep 0.5
  done
  log "timed out waiting for $2 ($1)"; return 1
}

cmd_install() {
  mkdir -p "$BIN"
  if [[ ! -x "$BIN/auth" ]]; then
    log "downloading Supabase Auth $AUTH_VERSION"
    curl -fsSL "https://github.com/supabase/auth/releases/download/$AUTH_VERSION/auth-$AUTH_VERSION-x86.tar.gz" | tar -xz -C "$BIN"
  fi
  if [[ ! -x "$BIN/postgrest" ]]; then
    log "downloading PostgREST $POSTGREST_VERSION"
    curl -fsSL "https://github.com/PostgREST/postgrest/releases/download/$POSTGREST_VERSION/postgrest-$POSTGREST_VERSION-linux-static-x86-64.tar.xz" | tar -xJ -C "$BIN"
  fi
  if [[ ! -x "$BIN/mailpit" ]]; then
    log "downloading Mailpit $MAILPIT_VERSION"
    curl -fsSL "https://github.com/axllent/mailpit/releases/download/$MAILPIT_VERSION/mailpit-linux-amd64.tar.gz" | tar -xz -C "$BIN" mailpit
  fi
}

start_postgres() {
  mkdir -p "$DATA"
  if [[ ! -f "$DATA/pg/PG_VERSION" ]]; then
    log "initializing Postgres cluster"
    local pwfile; pwfile="$(mktemp)"; echo postgres > "$pwfile"
    # initdb refuses to run as root; use the postgres OS user when we are root.
    if [[ "$(id -u)" == "0" ]]; then
      mkdir -p "$DATA/pg"; chown -R postgres "$DATA"; chmod 644 "$pwfile"
      su postgres -c "$PG_BIN/initdb -D '$DATA/pg' -U postgres --pwfile='$pwfile' -A scram-sha-256 --locale=C.UTF-8 -E UTF8" >/dev/null
    else
      "$PG_BIN/initdb" -D "$DATA/pg" -U postgres --pwfile="$pwfile" -A scram-sha-256 --locale=C.UTF-8 -E UTF8 >/dev/null
    fi
    rm -f "$pwfile"
  fi
  if ! PGPASSWORD=postgres "$PG_BIN/pg_isready" -q -h 127.0.0.1 -p "$PG_PORT"; then
    log "starting Postgres on :$PG_PORT"
    local opts="-p $PG_PORT -k /tmp -c listen_addresses=127.0.0.1"
    if [[ "$(id -u)" == "0" ]]; then
      su postgres -c "$PG_BIN/pg_ctl -D '$DATA/pg' -l '$DATA/postgres.log' -o '$opts' -w start" >/dev/null
    else
      "$PG_BIN/pg_ctl" -D "$DATA/pg" -l "$DATA/postgres.log" -o "$opts" -w start >/dev/null
    fi
  fi
  psql_db -f "$HERE/bootstrap.sql"
}

start_bg() { # name, logfile, command...
  local name="$1" logfile="$2"; shift 2
  if [[ -f "$DATA/$name.pid" ]] && kill -0 "$(cat "$DATA/$name.pid")" 2>/dev/null; then return 0; fi
  nohup "$@" >"$logfile" 2>&1 &
  echo $! > "$DATA/$name.pid"
}

# Reads `key = value` from a section of supabase/config.toml.
toml_value() { # section key
  awk -v section="[$1]" -v key="$2" '
    $0 == section { inside = 1; next }
    /^\[/ { inside = 0 }
    inside && $1 == key && $2 == "=" { print $3; exit }
  ' "$ROOT/supabase/config.toml"
}

start_services() {
  # Same mapping as the Supabase CLI: [auth] enable_signup allows new accounts, while
  # [auth.email] enable_signup turns the whole email provider (codes and links) on or off.
  local signup email_provider
  signup="$(toml_value auth enable_signup)"
  email_provider="$(toml_value auth.email enable_signup)"

  start_bg mailpit "$DATA/mailpit.log" "$BIN/mailpit" --listen "127.0.0.1:$MAIL_HTTP_PORT" --smtp "127.0.0.1:$MAIL_SMTP_PORT" --smtp-auth-accept-any --smtp-auth-allow-insecure

  start_bg gateway "$DATA/gateway.log" node "$HERE/proxy.mjs"
  wait_for "http://127.0.0.1:$API_PORT/templates/magic_link.html" gateway

  start_bg auth "$DATA/auth.log" env \
    API_EXTERNAL_URL="http://127.0.0.1:$API_PORT/auth/v1" \
    GOTRUE_API_HOST=127.0.0.1 PORT="$AUTH_PORT" \
    GOTRUE_DB_DRIVER=postgres \
    GOTRUE_DB_DATABASE_URL="postgresql://supabase_auth_admin:postgres@127.0.0.1:$PG_PORT/postgres" \
    GOTRUE_DB_MIGRATIONS_PATH="$BIN/migrations" \
    GOTRUE_SITE_URL="$SITE_URL" \
    GOTRUE_URI_ALLOW_LIST="$SITE_URL/**,http://127.0.0.1:3000/**" \
    GOTRUE_DISABLE_SIGNUP="$([[ "$signup" == true ]] && echo false || echo true)" \
    GOTRUE_JWT_SECRET="$JWT_SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated \
    GOTRUE_JWT_ADMIN_ROLES=service_role \
    GOTRUE_EXTERNAL_EMAIL_ENABLED="${email_provider:-true}" GOTRUE_MAILER_AUTOCONFIRM=false \
    GOTRUE_MAILER_OTP_EXP=3600 GOTRUE_MAILER_OTP_LENGTH=6 \
    GOTRUE_SMTP_HOST=127.0.0.1 GOTRUE_SMTP_PORT="$MAIL_SMTP_PORT" GOTRUE_SMTP_USER=local GOTRUE_SMTP_PASS=local \
    GOTRUE_SMTP_ADMIN_EMAIL="no-reply@lynx-ecole.local" GOTRUE_SMTP_SENDER_NAME="Lynx École" \
    GOTRUE_SMTP_MAX_FREQUENCY=1s GOTRUE_RATE_LIMIT_EMAIL_SENT=1000 GOTRUE_RATE_LIMIT_VERIFY=1000 GOTRUE_RATE_LIMIT_OTP=1000 \
    GOTRUE_MAILER_SUBJECTS_MAGIC_LINK="Votre code de connexion" \
    GOTRUE_MAILER_TEMPLATES_MAGIC_LINK="http://127.0.0.1:$API_PORT/templates/magic_link.html" \
    GOTRUE_LOG_LEVEL=info \
    "$BIN/auth"
  wait_for "http://127.0.0.1:$AUTH_PORT/health" auth

  start_bg rest "$DATA/rest.log" env \
    PGRST_DB_URI="postgresql://authenticator:postgres@127.0.0.1:$PG_PORT/postgres" \
    PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$JWT_SECRET" \
    PGRST_DB_EXTRA_SEARCH_PATH="public,extensions" PGRST_SERVER_PORT="$REST_PORT" PGRST_SERVER_HOST=127.0.0.1 \
    PGRST_DB_CHANNEL_ENABLED=true \
    "$BIN/postgrest"
  wait_for "http://127.0.0.1:$REST_PORT/" rest
}

cmd_migrate() {
  local f version
  for f in "$ROOT"/supabase/migrations/*.sql; do
    version="$(basename "$f" .sql)"
    if [[ "$(psql_db -tAc "select 1 from lite_stack.schema_migrations where version = '$version'")" != "1" ]]; then
      log "applying $version"
      psql_db --single-transaction -f "$f"
      psql_db -c "insert into lite_stack.schema_migrations (version) values ('$version')"
    fi
  done
  psql_db -c "notify pgrst, 'reload schema'" || true
}

# Same files and order as `sql_paths` in supabase/config.toml: seed.sql, then seeds/*.sql by name
# (the curriculum sample, then the demo library that links to it, both generated by
# `pnpm library:seed`, then the library's links to the demo planning). The glob sorts by name.
cmd_seed() {
  local f
  log "loading supabase/seed.sql"
  psql_db --single-transaction -f "$ROOT/supabase/seed.sql"
  for f in "$ROOT"/supabase/seeds/*.sql; do
    log "loading supabase/seeds/$(basename "$f")"
    psql_db --single-transaction -f "$f"
  done
}

cmd_start() {
  cmd_install
  start_postgres
  start_services
  cmd_migrate
  cmd_status
}

cmd_stop() {
  local name
  for name in rest auth gateway mailpit; do
    if [[ -f "$DATA/$name.pid" ]]; then kill "$(cat "$DATA/$name.pid")" 2>/dev/null || true; rm -f "$DATA/$name.pid"; fi
  done
  if [[ -f "$DATA/pg/postmaster.pid" ]]; then
    if [[ "$(id -u)" == "0" ]]; then su postgres -c "$PG_BIN/pg_ctl -D '$DATA/pg' -m fast stop" >/dev/null || true
    else "$PG_BIN/pg_ctl" -D "$DATA/pg" -m fast stop >/dev/null || true; fi
  fi
  log "stopped"
}

cmd_reset() {
  # Recreate the database from scratch: auth schema, migrations and seed.
  cmd_install
  start_postgres
  local name
  for name in rest auth; do
    if [[ -f "$DATA/$name.pid" ]]; then kill "$(cat "$DATA/$name.pid")" 2>/dev/null || true; rm -f "$DATA/$name.pid"; fi
  done
  log "dropping and recreating database"
  PGPASSWORD=postgres "$PG_BIN/psql" -q -h 127.0.0.1 -p "$PG_PORT" -U postgres -d template1 -v ON_ERROR_STOP=1 \
    -c "drop database if exists postgres with (force)" -c "create database postgres"
  psql_db -f "$HERE/bootstrap.sql"
  start_services
  cmd_migrate
  cmd_seed
  psql_db -c "notify pgrst, 'reload schema'" || true
  cmd_status
}

cmd_test() {
  log "running pgTAP tests"
  PGPASSWORD=postgres pg_prove -h 127.0.0.1 -p "$PG_PORT" -U postgres -d postgres --ext .sql "$ROOT"/supabase/tests/*.sql
}

cmd_status() {
  cat <<INFO
         API URL: http://127.0.0.1:$API_PORT
          DB URL: $DB_URL
      Mailpit UI: http://127.0.0.1:$MAIL_HTTP_PORT
INFO
  (cd "$HERE" && JWT_SECRET="$JWT_SECRET" node keys.mjs --env)
}

cmd_psql() { psql_db "$@"; }

case "${1:-}" in
  install) cmd_install ;;
  start) cmd_start ;;
  stop) cmd_stop ;;
  reset) cmd_reset ;;
  migrate) cmd_migrate ;;
  seed) cmd_seed ;;
  test) cmd_test ;;
  status) cmd_status ;;
  psql) shift; cmd_psql "$@" ;;
  *) echo "usage: $0 {install|start|stop|reset|migrate|seed|test|status|psql}"; exit 1 ;;
esac
