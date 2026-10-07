#!/usr/bin/env node
// The portal roles' logins (DECISIONS D-049, D-083, D-114), for deploy/docker/migrate.sh: prints
// `alter role … with login password '…'` for lynx_sub_portal (SUB_PORTAL_PASSWORD) and
// lynx_class_portal (CLASS_PORTAL_PASSWORD), each set in the environment. The password is sent as
// a SCRAM-SHA-256 verifier computed here, which PostgreSQL stores as it is: the password itself
// never reaches the database server, its logs or a command line. An empty variable leaves its
// role unchanged (that portal stays off unless it already has a login).
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

const ROLES = [
  ['lynx_sub_portal', 'SUB_PORTAL_PASSWORD'],
  ['lynx_class_portal', 'CLASS_PORTAL_PASSWORD'],
];

/** PostgreSQL's SCRAM-SHA-256 verifier (RFC 5802, RFC 7677), as `password_encryption` makes it. */
export function scramVerifier(password, salt = randomBytes(16), iterations = 4096) {
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest('base64');
  const serverKey = createHmac('sha256', salted).update('Server Key').digest('base64');
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey}:${serverKey}`;
}

for (const [role, variable] of ROLES) {
  const password = process.env[variable] ?? '';
  if (password === '') {
    process.stderr.write(`migrate: ${variable} is empty: ${role} is left as it is\n`);
    continue;
  }
  // Printable ASCII only: PostgreSQL normalizes other passwords (SASLprep) before hashing.
  if (!/^[\x21-\x7e]{16,}$/.test(password)) {
    process.stderr.write(`migrate: ${variable} must be at least 16 printable ASCII characters\n`);
    process.exit(1);
  }
  process.stdout.write(`alter role ${role} with login password '${scramVerifier(password)}';\n`);
}
