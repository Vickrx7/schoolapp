#!/usr/bin/env bash
# What restore.sh refuses (DECISIONS D-115), checked on copies of a real backup: a backup that is
# not signed, signed with another key, or changed after signing (the manifest), and backups that
# are correctly signed (someone holding the key) but whose manifest or dump holds more than data:
# a count that is not a number, a psql command on its own line or after a statement, a statement
# pg_dump does not write. Each must be refused before the target is touched, for that reason;
# the untouched backup must pass every check (it then stops at the target holding data, unless
# the target is empty, which this script never uses).
#
#   deploy/ci/restore-refusals.sh <lynx-backup-….tar> <age identity> <signing key file> <db url>
#
# Run by the backup-restore CI job and by hand in the local drill (docs/HANDOFF.md).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESTORE="$HERE/../backup/restore.sh"
# shellcheck source=deploy/backup/common.sh
. "$HERE/../backup/common.sh"

backup="$1" identity="$2" key_file="$3" url="$4"
key="$(read_signing_key "$key_file")"
recipient="$(age-keygen -y "$identity")"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
marker="$work/pwned"
failures=0

unpack() { # directory
  mkdir -p "$1"
  tar -xf "$backup" -C "$1"
}
sign() { # directory
  printf 'hmac-sha256:v1 %s\n' "$(backup_signed_text "$1" | hmac_sha256_hex "$key")" > "$1/signature"
}
pack() { # directory, files… -> tar path on stdout
  local dir="$1"
  shift
  tar -C "$dir" -cf "$dir.tar" "$@"
  printf '%s' "$dir.tar"
}
# Rewrites the manifest with a jq filter, keeping the dump's hash right.
edit_manifest() { # directory, jq filter
  age -d -i "$identity" "$1/manifest.json.age" | jq -c "$2" | age -r "$recipient" -o "$1/m.age"
  mv "$1/m.age" "$1/manifest.json.age"
}
# Rewrites the dump with a command reading it on stdin, and the manifest's hash of it.
edit_dump() { # directory, command
  age -d -i "$identity" "$1/dump.sql.gz.age" | gunzip -c | bash -c "$2" | gzip -c |
    age -r "$recipient" -o "$1/d.age"
  mv "$1/d.age" "$1/dump.sql.gz.age"
  edit_manifest "$1" ".dump.sha256 = \"$(sha256sum "$1/dump.sql.gz.age" | cut -d' ' -f1)\""
}
expect_refusal() { # name, tar, expected message part, [signing key file]
  local name="$1" tar="$2" expected="$3" keyfile="${4:-$key_file}" out
  if out="$("$RESTORE" "$tar" --identity "$identity" --signing-key "$keyfile" --db-url "$url" --yes 2>&1)"; then
    echo "FAIL $name: restore.sh accepted it" >&2
    failures=$((failures + 1))
  elif ! grep -qF -- "$expected" <<< "$out"; then
    echo "FAIL $name: refused for another reason:" >&2
    echo "$out" >&2
    failures=$((failures + 1))
  elif [[ -e "$marker" ]]; then
    echo "FAIL $name: a command from the backup ran" >&2
    failures=$((failures + 1))
  else
    echo "ok   $name"
  fi
}

# The untouched backup passes every check of the backup itself.
expect_refusal "an untouched backup reaches the target checks" "$backup" "the target already holds data"

d="$work/unsigned" && unpack "$d"
expect_refusal "an unsigned backup" "$(pack "$d" manifest.json.age dump.sql.gz.age)" "is not signed"

printf '%s\n' "$(openssl rand -hex 32 2> /dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" > "$work/other.key"
expect_refusal "a backup checked with another key" "$backup" "signature is wrong" "$work/other.key"

d="$work/manifest" && unpack "$d"
edit_manifest "$d" '.counts["public.boards"] += 1'
expect_refusal "a manifest changed after signing" \
  "$(pack "$d" signature manifest.json.age dump.sql.gz.age)" "signature is wrong"

d="$work/count" && unpack "$d"
edit_manifest "$d" '.counts["public.boards"] = "1); select pg_sleep(0); --"'
sign "$d"
expect_refusal "a signed manifest whose count is SQL" \
  "$(pack "$d" signature manifest.json.age dump.sql.gz.age)" "whole numbers of rows"

d="$work/table" && unpack "$d"
edit_manifest "$d" '.counts["public.boards\"; drop table x; --"] = 1'
sign "$d"
expect_refusal "a signed manifest whose table name is SQL" \
  "$(pack "$d" signature manifest.json.age dump.sql.gz.age)" "whole numbers of rows"

d="$work/shell" && unpack "$d"
edit_dump "$d" "awk -v m='$marker' 'NR == 3 { print \"\\\\! touch \" m } { print }'"
sign "$d"
expect_refusal "a signed dump with a psql shell command" \
  "$(pack "$d" signature manifest.json.age dump.sql.gz.age)" "does not write"

d="$work/inline" && unpack "$d"
edit_dump "$d" "awk -v m='$marker' 'NR == 3 { print \"SELECT 1; \\\\! touch \" m } { print }'"
sign "$d"
expect_refusal "a signed dump with a psql command after a statement" \
  "$(pack "$d" signature manifest.json.age dump.sql.gz.age)" "does not write"

d="$work/statement" && unpack "$d"
edit_dump "$d" "awk 'NR == 3 { print \"DROP TABLE public.boards CASCADE;\" } { print }'"
sign "$d"
expect_refusal "a signed dump with a statement pg_dump does not write" \
  "$(pack "$d" signature manifest.json.age dump.sql.gz.age)" "does not write"

d="$work/string" && unpack "$d"
edit_dump "$d" "awk -v m='$marker' 'NR == 3 { print \"SELECT '\\''\"; print \"COPY x FROM stdin;\"; print \"'\\'';\"; print \"\\\\! touch \" m } { print }'"
sign "$d"
expect_refusal "a signed dump hiding a command after a quoted COPY line" \
  "$(pack "$d" signature manifest.json.age dump.sql.gz.age)" "does not write"

if [[ "$failures" -gt 0 ]]; then
  echo "restore-refusals: $failures check(s) failed" >&2
  exit 1
fi
echo "restore-refusals: every altered backup was refused"
