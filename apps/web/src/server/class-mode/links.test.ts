import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { classLinkUrl, joinAddress, joinUrl, qrSvg } from './links';

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ-_01234';

/**
 * Reads the dark modules back from the SVG `qrcode` draws: one path of horizontal strokes,
 * `M<x> <y>.5h<n>` then `m<dx> 0h<n>` for the next run of the same row.
 */
function modulesFromSvg(svg: string): { size: number; dark: Set<string> } {
  const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  const stroke = /<path stroke="#000000" d="([^"]+)"/.exec(svg);
  if (!viewBox || !stroke) throw new Error('not a qrcode SVG');
  const dark = new Set<string>();
  let x = 0;
  let y = 0;
  for (const [, op, a, b] of stroke[1]!.matchAll(/([Mmh])(-?[\d.]+)(?: (-?[\d.]+))?/g)) {
    if (op === 'M') {
      x = Number(a);
      y = Math.floor(Number(b));
    } else if (op === 'm') {
      x += Number(a);
      y += Math.floor(Number(b));
    } else {
      for (let i = 0; i < Number(a); i++) dark.add(`${x + i},${y}`);
      x += Number(a);
    }
  }
  return { size: Number(viewBox[1]), dark };
}

/** The dark modules of the QR code of `text`, with the same one-module margin. */
function expectedModules(text: string): Set<string> {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const dark = new Set<string>();
  const size = qr.modules.size;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (qr.modules.get(row, col)) dark.add(`${col + 1},${row + 1}`);
    }
  }
  return dark;
}

describe('class link and its QR code (D-084)', () => {
  it('puts the token in the fragment of the join page', () => {
    expect(joinUrl('https://ecole.example.ca')).toBe('https://ecole.example.ca/jouer');
    expect(joinAddress('https://ecole.example.ca/')).toBe('ecole.example.ca/jouer');
    expect(joinAddress('http://localhost:3000')).toBe('localhost:3000/jouer');
    expect(classLinkUrl('https://ecole.example.ca', TOKEN)).toBe(
      `https://ecole.example.ca/jouer#k=${TOKEN}`,
    );
    expect(() => classLinkUrl('https://ecole.example.ca', 'short')).toThrow(RangeError);
  });

  it('draws exactly the QR code of the class link', async () => {
    const url = classLinkUrl('https://ecole.example.ca', TOKEN);
    const svg = await qrSvg(url);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 \d+ \d+"/);
    // No script and no size: the container scales it.
    expect(svg).not.toMatch(/<script|width=|height=/);
    const { size, dark } = modulesFromSvg(svg);
    const expected = expectedModules(url);
    expect(size).toBe(QRCode.create(url, { errorCorrectionLevel: 'M' }).modules.size + 2);
    expect(dark).toEqual(expected);
    // Another link gives another code.
    const other = classLinkUrl('https://ecole.example.ca', TOKEN.replace('a', 'b'));
    expect(modulesFromSvg(await qrSvg(other)).dark).not.toEqual(expected);
  });
});
