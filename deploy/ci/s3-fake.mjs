#!/usr/bin/env node
// A stand-in for S3-compatible storage, for the backup CI job only (DECISIONS D-115): it takes
// PUTs of whole objects, checks their AWS Signature Version 4 against the one key it knows and the
// body against its declared SHA-256, and keeps them as <dir>/<bucket>/<key>. Anything else is
// refused, so `backup.sh` with BACKUP_S3_ENDPOINT is tested against a server that verifies what a
// real one verifies. Settings (environment): S3_FAKE_DIR, S3_FAKE_PORT (default 9000),
// S3_FAKE_REGION (default ca-central-1), S3_FAKE_KEY_ID and S3_FAKE_SECRET.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

const dir = process.env.S3_FAKE_DIR;
const port = Number(process.env.S3_FAKE_PORT ?? 9000);
const region = process.env.S3_FAKE_REGION ?? 'ca-central-1';
const keyId = process.env.S3_FAKE_KEY_ID;
const secret = process.env.S3_FAKE_SECRET;
if (!dir || !keyId || !secret) {
  process.stderr.write('s3-fake: set S3_FAKE_DIR, S3_FAKE_KEY_ID and S3_FAKE_SECRET\n');
  process.exit(2);
}

const AUTHORIZATION =
  /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, ?SignedHeaders=([a-z0-9;-]+), ?Signature=([0-9a-f]{64})$/;

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

/** The signature S3 expects for this request (AWS Signature Version 4, a whole payload). */
function signature(req, signedHeaders, date, scope) {
  const [pathname, query = ''] = (req.url ?? '/').split('?');
  const headers = signedHeaders
    .map(
      (name) =>
        `${name}:${String(req.headers[name] ?? '')
          .trim()
          .replace(/\s+/g, ' ')}\n`,
    )
    .join('');
  const canonical = [
    req.method,
    pathname,
    query,
    headers,
    signedHeaders.join(';'),
    req.headers['x-amz-content-sha256'],
  ].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', req.headers['x-amz-date'], scope, sha256(canonical)].join(
    '\n',
  );
  let key = hmac(`AWS4${secret}`, date);
  for (const part of [region, 's3', 'aws4_request']) key = hmac(key, part);
  return createHmac('sha256', key).update(toSign).digest('hex');
}

/** Why the request is refused, or null. */
function refusal(req, body) {
  if (req.method !== 'PUT') return 'only PUT';
  const auth = AUTHORIZATION.exec(String(req.headers.authorization ?? ''));
  if (!auth) return 'no AWS4-HMAC-SHA256 authorization';
  const [, id, date, scopeRegion, signed, given] = auth;
  if (id !== keyId) return 'unknown access key';
  if (scopeRegion !== region) return `region ${scopeRegion}, expected ${region}`;
  const amzDate = String(req.headers['x-amz-date'] ?? '');
  if (!amzDate.startsWith(date)) return 'x-amz-date does not match the credential';
  const when = Date.parse(
    amzDate.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'),
  );
  if (!Number.isFinite(when) || Math.abs(Date.now() - when) > 15 * 60 * 1000) return 'stale date';
  const signedHeaders = signed.split(';');
  for (const name of ['host', 'x-amz-content-sha256', 'x-amz-date']) {
    if (!signedHeaders.includes(name)) return `${name} is not signed`;
  }
  if (req.headers['x-amz-content-sha256'] !== sha256(body))
    return 'body does not match its SHA-256';
  const expected = Buffer.from(
    signature(req, signedHeaders, date, `${date}/${region}/s3/aws4_request`),
  );
  if (!timingSafeEqual(expected, Buffer.from(given))) return 'signature does not match';
  return null;
}

createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const why = refusal(req, body);
    const pathname = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const target = path.resolve(dir, `.${pathname}`);
    if (
      !why &&
      (!target.startsWith(path.resolve(dir) + path.sep) || pathname.split('/').length < 3)
    ) {
      res.writeHead(400).end();
      process.stderr.write(`s3-fake: ${req.method} ${pathname} 400 (not /<bucket>/<key>)\n`);
      return;
    }
    if (why) {
      res.writeHead(403).end();
      process.stderr.write(`s3-fake: ${req.method} ${pathname} 403 (${why})\n`);
      return;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, body);
    res.writeHead(200, { ETag: `"${createHash('md5').update(body).digest('hex')}"` }).end();
    process.stderr.write(`s3-fake: PUT ${pathname} 200 (${body.length} bytes)\n`);
  });
}).listen(port, '127.0.0.1', () => {
  process.stderr.write(`s3-fake: listening on 127.0.0.1:${port} (${region})\n`);
});
