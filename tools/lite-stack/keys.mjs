// Prints the local anon and service_role API keys (HS256 JWTs) for a JWT secret.
// Matches the demo keys the Supabase CLI uses for local development.
import { createHmac } from 'node:crypto';

const secret = process.env.JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long';

const b64url = (input) => Buffer.from(input).toString('base64url');

function sign(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

const exp = 1983812996; // Same fixed expiry as the Supabase CLI demo keys.
const anon = sign({ iss: 'supabase-demo', role: 'anon', exp });
const service = sign({ iss: 'supabase-demo', role: 'service_role', exp });

if (process.argv.includes('--env')) {
  console.log(`ANON_KEY=${anon}`);
  console.log(`SERVICE_ROLE_KEY=${service}`);
} else {
  console.log(JSON.stringify({ anon, service }));
}
