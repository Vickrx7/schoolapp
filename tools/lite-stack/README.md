# Lite stack (Docker-free)

A local stand-in for `supabase start` for machines and sandboxes that cannot run Docker. It runs
the same pieces Supabase uses, as standalone binaries:

| Service                              | Port             | Binary                                      |
| ------------------------------------ | ---------------- | ------------------------------------------- |
| API gateway (`/auth/v1`, `/rest/v1`) | 54321            | `proxy.mjs` (Node)                          |
| Postgres                             | 54322            | system PostgreSQL 16 (`pg_config --bindir`) |
| Mail catcher UI and API              | 54324            | Mailpit                                     |
| Supabase Auth                        | 9999 (internal)  | `supabase/auth` release                     |
| PostgREST                            | 54330 (internal) | PostgREST release                           |

It uses the Supabase CLI's local JWT secret and demo keys, so `.env.example` works unchanged.

```bash
tools/lite-stack/stack.sh reset    # fresh database: auth schema, migrations, seed.sql, then seeds/*.sql
tools/lite-stack/stack.sh fresh    # the same without any data: a new install, the target of a restore drill
tools/lite-stack/stack.sh start    # start services, apply new migrations
tools/lite-stack/stack.sh test     # pgTAP suite (needs pg_prove, e.g. apt install libtap-parser-sourcehandler-pgtap-perl postgresql-16-pgtap)
tools/lite-stack/stack.sh psql     # psql into the database
tools/lite-stack/stack.sh stop
```

Development only. Production (hosted or board-hosted) uses the official Supabase images.
