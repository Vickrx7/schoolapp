import { describe, expect, it } from 'vitest';
import en from '../../messages/en-CA.json';
import fr from '../../messages/fr-CA.json';
import { inviteMessage, type InviteMessageInput } from './invite-message';

const input: InviteMessageInput = {
  locale: 'fr-CA',
  name: 'Isabelle Nouvelle',
  email: 'isabelle.nouvelle@exemple.ca',
  loginUrl: 'https://app.exemple.ca/login',
  inviterName: 'Nathalie Roy',
  appName: 'Lynx École',
  role: 'teacher',
  place: 'É.É.C. Saint-Exemple',
};

describe('the invitation message (D-107)', () => {
  it('explains, in French, where to sign in, which address to type and the code', () => {
    const message = inviteMessage(input, fr);
    expect(message.subject).toBe('Votre accès à Lynx École');
    expect(message.body).toContain('Bonjour Isabelle Nouvelle,');
    expect(message.body).toContain('Lynx École (Enseignant·e, É.É.C. Saint-Exemple)');
    expect(message.body).toContain('https://app.exemple.ca/login');
    expect(message.body).toContain('isabelle.nouvelle@exemple.ca');
    expect(message.body).toContain('code à 6 chiffres');
    expect(message.body.trimEnd().endsWith('Nathalie Roy')).toBe(true);
    expect(message.smsBody).toContain('https://app.exemple.ca/login');
    expect(message.smsBody).toContain('isabelle.nouvelle@exemple.ca');
  });

  it('is written in English when asked, whatever the inviter reads', () => {
    const message = inviteMessage(
      { ...input, locale: 'en-CA', role: 'office_admin' },
      en as typeof fr,
    );
    expect(message.subject).toBe('Your access to Lynx École');
    expect(message.body).toContain('Hello Isabelle Nouvelle,');
    expect(message.body).toContain('(Office, É.É.C. Saint-Exemple)');
    expect(message.body).toContain('6-digit code');
    expect(message.body).not.toContain('Bonjour');
  });

  it('opens the inviter’s own apps: mail to the person, a text with the body only', () => {
    const message = inviteMessage(input, fr);
    expect(message.mailto.startsWith('mailto:isabelle.nouvelle@exemple.ca?subject=')).toBe(true);
    expect(decodeURIComponent(message.mailto.split('&body=')[1]!)).toBe(message.body);
    expect(message.sms).toBe(`sms:?&body=${encodeURIComponent(message.smsBody)}`);
    // An address with characters that mean something in a URL stays one address.
    const odd = inviteMessage({ ...input, email: 'a&b?c@exemple.ca' }, fr);
    expect(odd.mailto.startsWith('mailto:a%26b%3Fc@exemple.ca?subject=')).toBe(true);
  });

  it('stays under 1,800 characters as a mailto link, with the longest names allowed', () => {
    for (const catalog of [fr, en as typeof fr]) {
      const message = inviteMessage(
        {
          ...input,
          locale: catalog === fr ? 'fr-CA' : 'en-CA',
          name: 'N'.repeat(120),
          inviterName: 'I'.repeat(120),
          email: `${'e'.repeat(60)}@${'d'.repeat(60)}.ca`,
          place: 'P'.repeat(120),
          role: 'vice_principal',
        },
        catalog,
      );
      expect(message.mailto.length).toBeLessThan(1800);
    }
  });
});
