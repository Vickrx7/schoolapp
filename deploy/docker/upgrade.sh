#!/usr/bin/env bash
# Upgrades this install to a tagged release (DECISIONS D-114; DEPLOYMENT.md § Upgrades):
#
#   deploy/docker/upgrade.sh v0.6.1
#
# 1. checks out the tag; 2. builds both images (APP_RELEASE from the tag); 3. stops web and worker;
# 4. takes a backup of the install as it stands, the previous release's (UPGRADE_WITHOUT_BACKUP=yes
# skips it); 5. starts everything again: `migrate` runs first and takes a backup when migrations
# are pending; 6. checks that the web server is ready. Evenings and weekends only, never
# 05:30–09:00 on a school day. Rolling back means the previous tag plus a restore of the backup of
# step 4. Not migrate's: board-hosted, step 5 starts the release's Auth first, which applies its
# own migrations, and restore.sh refuses that backup on the previous release's older Auth.
set -euo pipefail

# Read whole before running: the checkout below may change this very file.
main() {
  local tag="${1:?usage: upgrade.sh <tag>}"
  cd "$(dirname "${BASH_SOURCE[0]}")"

  local previous
  previous="$(git describe --tags --always)"
  git fetch --tags --quiet origin
  git checkout --quiet --detach "$tag"
  APP_RELEASE="${APP_RELEASE:-$(git describe --tags --always)}"
  export APP_RELEASE
  echo "upgrade: building $APP_RELEASE"
  docker compose build

  echo "upgrade: stopping web and worker"
  docker compose stop web worker

  # The backup a rollback restores. The database and Auth still run the previous release's images
  # (--no-deps: the running ones, never new ones); the manifest names that release.
  if [[ "${UPGRADE_WITHOUT_BACKUP:-}" == yes ]]; then
    echo "upgrade: UPGRADE_WITHOUT_BACKUP=yes: no backup of $previous first"
  else
    echo "upgrade: a backup of $previous first (the one to restore if you roll back)"
    if ! docker compose run --rm --no-deps -e APP_RELEASE="$previous" backup; then
      echo "upgrade: the backup failed; web and worker stay stopped. Fix it and run upgrade.sh again" >&2
      echo "upgrade: (or with UPGRADE_WITHOUT_BACKUP=yes, once you hold a recent backup). To run" >&2
      echo "upgrade: $previous again meanwhile: docker compose start web worker." >&2
      exit 1
    fi
  fi

  if ! docker compose up -d --wait; then
    echo "upgrade: the install did not start (see: docker compose logs migrate web worker)." >&2
    echo "upgrade: web and worker stay stopped until it does; to go back, check out $previous," >&2
    echo "upgrade: restore the backup taken above (DEPLOYMENT.md § 7) and run docker compose up -d." >&2
    exit 1
  fi

  docker compose exec -T web node -e \
    "fetch('http://127.0.0.1:3000/api/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" ||
    { echo "upgrade: the web server is up but not ready (/api/health/ready)" >&2; exit 1; }
  echo "upgrade: $APP_RELEASE is running"
}

main "$@"
exit
