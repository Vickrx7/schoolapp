# syntax=docker/dockerfile:1
# Lynx École's two images, built from a tagged checkout and configured at run time through the
# environment (DECISIONS D-114): no setting and no secret is built in.
#
#   web  the Next.js server (standalone build)
#   app  the whole workspace, run with tsx: the worker (default), the admin CLI, `migrate` and
#        `backup` (with the PostgreSQL 17 client, age, jq and curl)
#
# Built by deploy/docker/compose.yml (`docker compose build`, from deploy/docker), with the
# repository root as context. APP_RELEASE names the release (footer, /api/health, logs).

# ---------------------------------------------------------------------------------------------
# Node 22 on Debian 12, pinned by digest (Dependabot proposes newer Node 22 versions monthly);
# nothing reports usage anywhere (D-111).
FROM node:22.23.3-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS runtime
ENV NEXT_TELEMETRY_DISABLED=1 \
    DO_NOT_TRACK=1 \
    SUPABASE_TELEMETRY_DISABLED=1 \
    SUPABASE_NO_UPDATE_NOTIFIER=1 \
    npm_config_update_notifier=false

# ---------------------------------------------------------------------------------------------
# pnpm, installed for every user (the images run as `node`), and the tools the app image needs.
FROM runtime AS base
RUN npm install --global pnpm@10.33.0 && npm cache clean --force
# PostgreSQL 17's client from the PostgreSQL project's own repository (Debian 12 ships 15), age for
# encrypted backups, jq for their manifest, curl for uploads and monitor pings.
# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && install -d /etc/apt/keyrings \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /etc/apt/keyrings/pgdg.asc \
 && echo "deb [signed-by=/etc/apt/keyrings/pgdg.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-17 age jq \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

# ---------------------------------------------------------------------------------------------
# The workspace's dependencies: fetched from the lockfile alone (cached until it changes), then
# installed offline from that store.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile

# ---------------------------------------------------------------------------------------------
# The web build. Nothing may be built into it (D-113): it is made with a Supabase address that
# cannot exist, and fails if that address appears anywhere in the output (the build's own cache,
# which records the settings it saw and is not shipped, aside).
FROM deps AS build-web
ENV SUPABASE_URL=http://build.invalid
RUN pnpm --filter @lynx/web build \
 && if grep -rl --exclude-dir=cache build.invalid apps/web/.next; then \
      echo "a build-time setting was built into the app" >&2; exit 1; \
    fi

# ---------------------------------------------------------------------------------------------
FROM runtime AS web
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=build-web /repo/apps/web/.next/standalone ./
COPY --from=build-web /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build-web /repo/apps/web/public ./apps/web/public
# Next's cache is the only place it writes (a tmpfs in compose.yml).
RUN install -d -o node -g node apps/web/.next/cache
ARG APP_RELEASE=dev
ENV APP_RELEASE=${APP_RELEASE}
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/web/server.js"]

# ---------------------------------------------------------------------------------------------
FROM deps AS app
ENV PROMPTS_DIR=/repo/prompts \
    BACKUP_DIR=/backups
# Where the app writes: backups (a volume), and the Supabase CLI's working files.
RUN install -d -o node -g node /backups /repo/supabase/.temp /repo/.supabase
ARG APP_RELEASE=dev
ENV APP_RELEASE=${APP_RELEASE}
USER node
# The worker as one process (tsx's loader in node), so it receives the stop signal itself.
WORKDIR /repo/apps/worker
CMD ["node", "--import", "tsx", "src/index.ts"]
