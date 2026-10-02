/**
 * The backups' signature (DECISIONS D-115): deploy/backup/common.sh computes HMAC-SHA256 in bash
 * (so the key never appears on a command line). It must be the real HMAC-SHA256, whatever the key
 * (bytes 0x36 and 0x5c included) and the message.
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
