/**
 * The backups' signature (DECISIONS D-115): deploy/backup/common.sh computes HMAC-SHA256 in bash
 * (so the key never appears on a command line). It must be the real HMAC-SHA256, whatever the key
 * (bytes 0x36 and 0x5c included) and the message. Also where a backup's copy goes: Amazon S3, or
 * any S3-compatible storage (the backup CI job uploads to a stand-in that checks the signature).
 */
import { execFileSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const COMMON = fileURLToPath(new URL('../../../deploy/backup/common.sh', import.meta.url));

function bashHmac(keyHex: string, message: string): string {
  return execFileSync('bash', ['-c', `set -euo pipefail; . "$COMMON"; hmac_sha256_hex "$KEY"`], {
    input: message,
    env: { ...process.env, COMMON, KEY: keyHex },
    encoding: 'utf8',
  }).trim();
}

describe('hmac_sha256_hex (deploy/backup/common.sh)', () => {
  it('is HMAC-SHA256', () => {
    const keys = [
      '36'.repeat(32),
      '5c'.repeat(32),
      '00'.repeat(32),
      ...Array.from({ length: 6 }, () => randomBytes(32).toString('hex')),
    ];
    const messages = [
      '',
      'lynx-backup-signature:v1\nmanifest.json.age 0\ndump.sql.gz.age 1\n',
      randomBytes(300).toString('base64'),
    ];
    for (const key of keys) {
      for (const message of messages) {
        expect(bashHmac(key, message)).toBe(
          createHmac('sha256', Buffer.from(key, 'hex')).update(message).digest('hex'),
        );
      }
    }
  });

  it('refuses a key that is not 64 hex digits', () => {
    expect(() => bashHmac('abc', 'x')).toThrow();
  });
});

function s3Url(endpoint: string, bucket: string, region: string, key: string): string {
  return execFileSync(
    'bash',
    [
      '-c',
      'set -euo pipefail; . "$COMMON"; s3_object_url "$1" "$2" "$3" "$4"',
      'bash',
      endpoint,
      bucket,
      region,
      key,
    ],
    { env: { ...process.env, COMMON }, encoding: 'utf8' },
  ).trim();
}

describe('s3_object_url (deploy/backup/common.sh)', () => {
  it('is the bucket’s own Amazon S3 address without an endpoint', () => {
    expect(s3Url('', 'lynx-backups', 'ca-central-1', 'nightly/lynx-backup-1.tar')).toBe(
      'https://lynx-backups.s3.ca-central-1.amazonaws.com/nightly/lynx-backup-1.tar',
    );
  });

  it('is path-style at any S3-compatible endpoint', () => {
    expect(s3Url('https://s3.conseil.ca', 'lynx', 'us-east-1', 'lynx-backup-1.tar')).toBe(
      'https://s3.conseil.ca/lynx/lynx-backup-1.tar',
    );
    expect(s3Url('http://10.0.0.5:9000/', 'lynx', 'us-east-1', 'a/lynx-backup-1.tar')).toBe(
      'http://10.0.0.5:9000/lynx/a/lynx-backup-1.tar',
    );
  });

  it('refuses an endpoint with a path, a query or another scheme', () => {
    for (const endpoint of [
      's3.conseil.ca',
      'ftp://s3.conseil.ca',
      'https://s3.conseil.ca/bucket',
      'https://s3.conseil.ca?x=1',
      'https://user@s3.conseil.ca',
    ]) {
      expect(() => s3Url(endpoint, 'lynx', 'us-east-1', 'k'), endpoint).toThrow();
    }
  });
});
