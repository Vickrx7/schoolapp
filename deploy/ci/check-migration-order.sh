#!/usr/bin/env bash
# Migration names (DECISIONS D-114; DEPLOYMENT.md § Migrations naming):
#   - no two migrations share a version (always);
#   - given a base branch (pull requests), every migration this branch adds sorts after the newest
#     one on the base branch: once production exists, `supabase db push` refuses one that sorts
#     before a migration already applied.
#
#   deploy/ci/check-migration-order.sh [<base branch>]
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

dupes="$(find supabase/migrations -maxdepth 1 -name '*.sql' -printf '%f\n' | cut -c1-14 | sort | uniq -d)"
if [[ -n "$dupes" ]]; then
  echo "several migrations share a version: $dupes" >&2
  exit 1
fi
echo "every migration has its own version"

base="${1:-}"
if [[ -z "$base" ]]; then
  echo "no base branch: the order of added migrations is not checked"
  exit 0
fi

git fetch --quiet --no-tags --depth=1 origin "$base"
newest="$(git ls-tree --name-only FETCH_HEAD supabase/migrations/ | sed 's|.*/||' | grep -E '^[0-9]{14}_.*\.sql$' | sort | tail -n 1)"
late=()
while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  name="$(basename "$file")"
  [[ "$name" > "$newest" ]] || late+=("$name")
done < <(git diff --name-only --diff-filter=A FETCH_HEAD HEAD -- supabase/migrations/)

if [[ ${#late[@]} -gt 0 ]]; then
  echo "these new migrations sort before $newest, the newest on $base; rename them with a later time:" >&2
  printf '  %s\n' "${late[@]}" >&2
  exit 1
fi
echo "every migration added since $base sorts after $newest"
