/**
 * Addresses and QR codes of « Quiz sur les appareils » (DECISIONS D-084). The class link is
 * `<APP_BASE_URL>/jouer#k=<token>`: the token rides in the fragment, which a browser never sends
 * to the server, so it stays out of every server and proxy log. The projector and the class tab
 * draw it as a QR code, rendered on the server as SVG (`qrcode` is plain JavaScript).
 *
 * Pure (no server-only import) so it is unit-tested; the pages pass APP_BASE_URL.
 */
import QRCode from 'qrcode';
import { isClassLinkToken } from '../class-portal/code';

/** Where students go to type a code: `<APP_BASE_URL>/jouer`. */
export function joinUrl(baseUrl: string): string {
  return new URL('/jouer', baseUrl).toString();
}

/** « Rejoignez la partie : ecole.example.ca/jouer », without the scheme, for the projector. */
export function joinAddress(baseUrl: string): string {
  const url = new URL('/jouer', baseUrl);
  return `${url.host}${url.pathname}`;
}

/** « Lien de la classe »: the join page with the class's token in the fragment. */
export function classLinkUrl(baseUrl: string, token: string): string {
  if (!isClassLinkToken(token)) throw new RangeError('invalid class link token');
  return `${joinUrl(baseUrl)}#k=${token}`;
}

/**
 * A QR code as SVG markup: black on white with a one-module margin, error correction M (a
 * projector's glare or a smudged screen still scans), scaled by its container (viewBox only).
 */
export function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    color: { dark: '#000000', light: '#ffffff' },
  });
}
