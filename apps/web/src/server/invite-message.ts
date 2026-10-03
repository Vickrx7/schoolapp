/**
 * The welcome message a board admin sends to someone they invited (DECISIONS D-107): our servers
 * send no invitation e-mail, so the page prepares it in French or English and « Courriel » or
 * « Texto » opens the inviter's own apps, as for substitute codes (D-059). It explains the
 * sign-in address, the e-mail address to type and the 6-digit code; no link to click, so mail
 * scanners have nothing to use up (D-019). Pure (not server-only), so it is unit tested with the
 * real message files.
 */
import type { AppRole } from '@lynx/db';
import { createTranslator } from 'next-intl';
import type messages from '../../messages/fr-CA.json';
import type { AppLocale } from '../i18n/config';

export type MessageCatalog = typeof messages;

export interface InviteMessageInput {
  locale: AppLocale;
  /** The invited person's name, as the inviter typed it. */
  name: string;
  email: string;
  /** The sign-in page, e.g. https://app.example.ca/login. */
  loginUrl: string;
  /** Who sends it (the signature). */
  inviterName: string;
  appName: string;
  role: AppRole;
  /** The school's name, or the board's for a board admin. */
  place: string;
}

export interface InviteMessage {
  subject: string;
  body: string;
  smsBody: string;
  /** `mailto:` to the person, with the subject and the body. */
  mailto: string;
  /** `sms:` with the body only (the app knows no phone number). */
  sms: string;
}

/** An address in a `mailto:` (RFC 6068): percent-encoded, but a readable @. */
const mailtoAddress = (email: string) => encodeURIComponent(email).replace(/%40/g, '@');

export function inviteMessage(input: InviteMessageInput, catalog: MessageCatalog): InviteMessage {
  const t = createTranslator({ locale: input.locale, messages: catalog });
  const values = {
    name: input.name,
    email: input.email,
    loginUrl: input.loginUrl,
    inviterName: input.inviterName,
    appName: input.appName,
    role: t(`profile.roleNames.${input.role}`),
    place: input.place,
  };
  const subject = t('board.invite.inviteEmailSubject', values);
  const body = t('board.invite.inviteEmailBody', values);
  const smsBody = t('board.invite.inviteSms', values);
  return {
    subject,
    body,
    smsBody,
    mailto: `mailto:${mailtoAddress(input.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    sms: `sms:?&body=${encodeURIComponent(smsBody)}`,
  };
}

/** The message in both languages, for the page's switch (the message files load on demand). */
export async function inviteMessages(
  input: Omit<InviteMessageInput, 'locale'>,
): Promise<Record<AppLocale, InviteMessage>> {
  const [fr, en] = await Promise.all([
    import('../../messages/fr-CA.json'),
    import('../../messages/en-CA.json'),
  ]);
  return {
    'fr-CA': inviteMessage({ ...input, locale: 'fr-CA' }, fr.default),
    'en-CA': inviteMessage({ ...input, locale: 'en-CA' }, en.default as MessageCatalog),
  };
}
