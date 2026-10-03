#!/usr/bin/env bash
# The web app reads its settings on the server at run time (DECISIONS D-113): no NEXT_PUBLIC_ name
# in apps/web/src, where Next would build the value into the app. The ESLint rule says the same
# for code; this also catches comments and files ESLint skips. Unit tests may name it.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

if grep -rn 'NEXT_PUBLIC_' apps/web/src --exclude='*.test.ts' --exclude='*.test.tsx'; then
  echo "NEXT_PUBLIC_ in apps/web/src: read settings with serverEnv() instead (D-113)" >&2
  exit 1
fi
echo "no NEXT_PUBLIC_ in apps/web/src"
