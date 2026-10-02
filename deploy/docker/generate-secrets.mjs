#!/usr/bin/env node
// Writes a new .env for deploy/docker/compose.yml (DECISIONS D-114), with fresh random secrets:
//
//   node generate-secrets.mjs --hosted   # Supabase Pro in Canada; fill in its URL, keys, databases
//   node generate-secrets.mjs --board    # board-hosted: the self-hosted Supabase's secrets too
//   node generate-secrets.mjs --ci       # the docker-smoke CI job: localhost, test mail, fake AI
//   … [--out <file>]                     # default: .env here
//
// The file is created with mode 0600 and never overwritten. Each service's settings are grouped
// under its name; compose.yml gives each service only its own. The backup key is not generated
// here: its private half must never be on the server (run `age-keygen` on the operator's
// workstation and put only the public key, age1…, in BACKUP_AGE_RECIPIENT).
import { createHmac, randomBytes, randomInt } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const MODES = ['--hosted', '--board', '--ci'];
const args = process.argv.slice(2);
const mode = args.find((a) => MODES.includes(a))?.slice(2);
const outIndex = args.indexOf('--out');
const out = outIndex >= 0 ? args[outIndex + 1] : '.env';
if (
  !mode ||
  !out ||
  args.some((a, i) => !MODES.includes(a) && a !== '--out' && i !== outIndex + 1)
) {
  process.stderr.write('usage: node generate-secrets.mjs --hosted|--board|--ci [--out <file>]\n');
  process.exit(2);
}

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** Letters and digits only, so it can sit in a connection URL unencoded. */
const password = (length = 48) =>
  Array.from({ length }, () => ALPHANUMERIC[randomInt(ALPHANUMERIC.length)]).join('');
/** 32 random bytes, base64: an encryption or HMAC key. */
const key = () => randomBytes(32).toString('base64');

/** An HS256 API key for the self-hosted Supabase, as tools/lite-stack/keys.mjs makes the local ones. */
function apiKey(secret, role) {
  const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  const body = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({
    iss: 'supabase',
    role,
    iat,
    exp: iat + 10 * 365 * 24 * 3600,
  })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

const selfHosted = mode !== 'hosted';
const postgresPassword = password();
const jwtSecret = password();
const subPortalPassword = password(40);
const classPortalPassword = password(40);
// Inside Compose's own network (the connection never leaves the server) the self-hosted database
// has no TLS: the Supabase CLI (migrate) needs to be told so.
const db = (user, pw) => `postgresql://${user}:${pw}@db:5432/postgres?sslmode=disable`;
const domain = mode === 'ci' ? 'localhost' : '';

const files = {
  hosted: 'compose.yml',
  board: 'compose.yml:compose.supabase.yml',
  ci: 'compose.yml:compose.supabase.yml:compose.ci.yml',
}[mode];

const sections = [
  [
    `Lynx École (${mode}), written ${new Date().toISOString().slice(0, 10)} by generate-secrets.mjs. Secret: keep it`,
    'on the server only (mode 0600), never in a backup or a repository. DEPLOYMENT.md explains each value.',
  ],
  ['Compose'],
  [`COMPOSE_FILE=${files}`],
  mode === 'ci' ? ['COMPOSE_PROFILES=mail-catcher'] : [],
  [
    '# journald on the server (kept 14 days, deploy/host/journald-lynx.conf).',
    'LOG_DRIVER=journald',
  ],

  ['proxy (Caddy: the only public entry)'],
  [
    '# The app’s address, e.g. app.example.ca (DNS A/AAAA records to this server).',
    `APP_DOMAIN=${domain}`,
    '# For Let’s Encrypt’s notices.',
    `ACME_EMAIL=${mode === 'ci' ? 'ci@example.test' : ''}`,
    `CADDY_TLS=${mode === 'ci' ? 'internal' : 'acme'}`,
  ],

  ['web'],
  [
    selfHosted
      ? '# The self-hosted Supabase, inside Compose (compose.supabase.yml).'
      : '# Supabase dashboard → Project Settings → API: https://<project-ref>.supabase.co and the anon key.',
    `SUPABASE_URL=${selfHosted ? 'http://api-gateway:8000' : ''}`,
    `SUPABASE_ANON_KEY=${selfHosted ? apiKey(jwtSecret, 'anon') : ''}`,
    '# The product name shown in the app; empty: Lynx École.',
    'APP_NAME=',
    'SUPPORT_EMAIL=',
    'PRIVACY_CONTACT_EMAIL=',
    '# Losing these makes alerts and report notes unreadable: keep a copy with the backup key.',
    `ALERTS_ENCRYPTION_KEYS=1:${key()}`,
    `SUB_CODE_HMAC_KEYS=1:${key()}`,
    `CLASS_PORTAL_HMAC_KEY=${key()}`,
    selfHosted
      ? '# The portals’ database logins (their passwords are set by migrate, below).'
      : '# The portals’ logins through the session pooler: lynx_sub_portal.<project-ref> and lynx_class_portal.<project-ref>.',
    `SUB_PORTAL_DATABASE_URL=${selfHosted ? db('lynx_sub_portal', subPortalPassword) : `postgresql://lynx_sub_portal.<project-ref>:${subPortalPassword}@aws-0-ca-central-1.pooler.supabase.com:5432/postgres`}`,
    `CLASS_PORTAL_DATABASE_URL=${selfHosted ? db('lynx_class_portal', classPortalPassword) : `postgresql://lynx_class_portal.<project-ref>:${classPortalPassword}@aws-0-ca-central-1.pooler.supabase.com:5432/postgres`}`,
    '# 2 behind a board load balancer (also added to the Caddyfile).',
    'TRUSTED_PROXY_HOPS=1',
  ],

  ['worker'],
  [
    selfHosted
      ? `DATABASE_URL=${db('postgres', postgresPassword)}`
      : '# The session pooler (LISTEN needs session mode): postgresql://postgres.<project-ref>:<db password>@aws-0-ca-central-1.pooler.supabase.com:5432/postgres',
    ...(selfHosted ? [] : ['DATABASE_URL=']),
    '# Server-only: the worker and the admin CLI, never the web server (D-012).',
    `SUPABASE_SERVICE_ROLE_KEY=${selfHosted ? apiKey(jwtSecret, 'service_role') : ''}`,
    '# none, fake (answers made locally) or anthropic (then ANTHROPIC_API_KEY).',
    `AI_PROVIDER=${mode === 'ci' ? 'fake' : 'none'}`,
    'ANTHROPIC_API_KEY=',
    'WORKER_CONCURRENCY=4',
    '# An external monitor pinged every minute (it receives no data).',
    'HEARTBEAT_URL_WORKER=',
  ],

  ['migrate'],
  [
    selfHosted
      ? `MIGRATIONS_DATABASE_URL=${db('postgres', postgresPassword)}`
      : '# As DATABASE_URL (the database owner, session mode).',
    ...(selfHosted ? [] : ['MIGRATIONS_DATABASE_URL=']),
    `SUB_PORTAL_PASSWORD=${subPortalPassword}`,
    `CLASS_PORTAL_PASSWORD=${classPortalPassword}`,
    '# yes: migrate a database with data without a backup first (only when you hold a recent one).',
    'MIGRATE_WITHOUT_BACKUP=',
  ],

  ['backup (and migrate, which backs up before migrating)'],
  [
    selfHosted ? `BACKUP_DATABASE_URL=${db('postgres', postgresPassword)}` : '# As DATABASE_URL.',
    ...(selfHosted ? [] : ['BACKUP_DATABASE_URL=']),
    '# The PUBLIC key from `age-keygen` on the operator’s workstation (age1…); several: space-separated.',
    'BACKUP_AGE_RECIPIENT=',
    '# Optional copy to S3 in Canada, with a key that may only put objects.',
    'BACKUP_S3_BUCKET=',
    'BACKUP_S3_REGION=ca-central-1',
    'BACKUP_S3_PREFIX=',
    'BACKUP_S3_ACCESS_KEY_ID=',
    'BACKUP_S3_SECRET_ACCESS_KEY=',
    'BACKUP_KEEP_DAYS=30',
    'HEARTBEAT_URL_BACKUP=',
  ],
];

if (selfHosted) {
  sections.push(
    ['self-hosted Supabase (compose.supabase.yml)'],
    [
      `POSTGRES_PASSWORD=${postgresPassword}`,
      '# Signs the API keys above: changing it changes them and signs everyone out.',
      `JWT_SECRET=${jwtSecret}`,
      '# The mail relay that sends the sign-in codes.',
      `SMTP_HOST=${mode === 'ci' ? 'mailpit' : ''}`,
      `SMTP_PORT=${mode === 'ci' ? '1025' : '587'}`,
      `SMTP_USER=${mode === 'ci' ? 'ci' : ''}`,
      `SMTP_PASS=${mode === 'ci' ? 'ci' : ''}`,
      `SMTP_ADMIN_EMAIL=${mode === 'ci' ? 'no-reply@example.test' : ''}`,
      'SMTP_SENDER_NAME=Lynx École',
      `AUTH_EMAIL_MAX_FREQUENCY=${mode === 'ci' ? '1s' : '60s'}`,
      'GOTRUE_SESSIONS_TIMEBOX=168h',
      'GOTRUE_SESSIONS_INACTIVITY_TIMEOUT=12h',
    ],
  );
}

// A one-line section is a heading; others are lines as they are.
const text = sections
  .filter((lines) => lines.length > 0)
  .map((lines) =>
    lines.length === 1 && !lines[0].includes('=') && !lines[0].startsWith('#')
      ? `\n# --- ${lines[0]} ${'-'.repeat(Math.max(3, 90 - lines[0].length))}`
      : lines
          .map((line) => (line.includes('=') || line.startsWith('#') ? line : `# ${line}`))
          .join('\n'),
  )
  .join('\n');

try {
  writeFileSync(out, `${text}\n`, { flag: 'wx', mode: 0o600 });
} catch (err) {
  if (err.code === 'EEXIST') {
    process.stderr.write(`${out} exists already: it is never overwritten (move it away first)\n`);
    process.exit(1);
  }
  throw err;
}
const blanks = text
  .split('\n')
  .filter((line) => /^[A-Z_]+=$/.test(line))
  .map((line) => line.slice(0, -1));
process.stderr.write(
  `wrote ${out} (mode 0600). Fill in what your install uses among: ${blanks.join(', ')}` +
    (text.includes('<project-ref>') ? '; and replace each <project-ref>' : '') +
    '\n',
);
