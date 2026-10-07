import { describe, expect, it } from 'vitest';
import { findBlockedDetails, PrivacyViolation, Redactor, type KnownPerson } from './privacy';

const NOW = new Date('2026-09-28T12:00:00Z');

const roster: KnownPerson[] = [
  { name: 'Léa', kind: 'student' },
  { name: 'Marie-Ève', kind: 'student' },
  { name: 'Marie', kind: 'student' },
  { name: 'Pierre', kind: 'student' },
  { name: 'Aïcha', kind: 'student' },
  { name: "O'Neil", kind: 'student' },
  { name: 'Isabelle Tremblay', kind: 'staff' },
];

const kinds = (text: string) => findBlockedDetails(text, NOW).map((f) => f.kind);

describe('Redactor', () => {
  it('replaces students consistently across texts and keeps the rest', () => {
    const r = new Redactor(roster, NOW);
    expect(r.redact('Léa prête son livre à Aïcha. Léa sourit.').text).toBe(
      'Élève A prête son livre à Élève B. Élève A sourit.',
    );
    expect(r.redact('Aïcha répond.').text).toBe('Élève B répond.');
  });

  it('matches names without accents or in another case', () => {
    const r = new Redactor(roster, NOW);
    expect(r.redact('lea et AICHA jouent.').text).toBe('Élève A et Élève B jouent.');
  });

  it('prefers the longest name', () => {
    const r = new Redactor(roster, NOW);
    expect(r.redact('Marie-Ève et Marie Ève et Marie').text).toBe('Élève A et Élève A et Élève B');
  });

  it('only matches whole words', () => {
    const r = new Redactor(roster, NOW);
    expect(r.redact('Léandre et Mariella, Pierrette.').text).toBe(
      'Léandre et Mariella, Pierrette.',
    );
  });

  it('treats names that are common words as names only when capitalized', () => {
    const r = new Redactor(roster, NOW);
    expect(r.redact('La pierre roule. Pierre la ramasse.').text).toBe(
      'La pierre roule. Élève A la ramasse.',
    );
  });

  it('handles apostrophes in names and elisions before names', () => {
    const r = new Redactor(roster, NOW);
    expect(r.redact("O'Neil lit le livre d'Aïcha.").text).toBe("Élève A lit le livre d'Élève B.");
  });

  it('replaces staff by full name, honorific and surname, or first name', () => {
    const r = new Redactor(roster, NOW);
    const out = r.redact(
      'Isabelle Tremblay arrive. Mme Tremblay parle. Tremblay sourit. Isabelle écrit.',
    ).text;
    expect(out).toBe('Adulte A arrive. Adulte A parle. Adulte A sourit. Adulte A écrit.');
  });

  it('puts students back with the roster spelling and staff as they were named', () => {
    const r = new Redactor(roster, NOW);
    r.redact('lea parle avec Mme Tremblay.');
    expect(r.restore('Élève A parle avec Adulte A.')).toBe('Léa parle avec Mme Tremblay.');
  });

  it('splits the text into segments for the preview', () => {
    const r = new Redactor(roster, NOW);
    expect(r.redact('Bravo Léa !').segments).toEqual([
      { text: 'Bravo ' },
      { text: 'Élève A', placeholder: 'Élève A' },
      { text: ' !' },
    ]);
  });

  it('puts names back, fixing elisions', () => {
    const r = new Redactor(roster, NOW);
    r.redact('Léa, Aïcha et Isabelle Tremblay');
    expect(
      r.restore({
        a: "Le livre d'Élève A et le sac d'Élève B.",
        b: ["L'Élève A lit avec Adulte A.", 'Élève Z reste tel quel.'],
        c: 3,
      }),
    ).toEqual({
      a: 'Le livre de Léa et le sac d’Aïcha.',
      b: ['Léa lit avec Isabelle Tremblay.', 'Élève Z reste tel quel.'],
      c: 3,
    });
  });

  it('refuses to send anything that still contains a name or a personal detail', () => {
    const r = new Redactor(roster, NOW);
    expect(() => r.assertSafeOutbound('Élève A lit un livre.')).not.toThrow();
    expect(() => r.assertSafeOutbound('Léa lit un livre.')).toThrow(PrivacyViolation);
    expect(() => r.assertSafeOutbound('Écrire à parent@example.com')).toThrow(PrivacyViolation);
  });

  it('works with an empty roster', () => {
    const r = new Redactor([], NOW);
    expect(r.redact('Bonjour la classe').text).toBe('Bonjour la classe');
    expect(() => r.assertSafeOutbound('Bonjour la classe')).not.toThrow();
  });

  it('handles a large roster', () => {
    const many = Array.from({ length: 600 }, (_, i) => ({
      name: `Prénom${String.fromCharCode(97 + (i % 26))}${Math.floor(i / 26)}`,
      kind: 'student' as const,
    }));
    const r = new Redactor([...many, ...roster], NOW);
    expect(r.redact('Léa et Prénomb3 lisent.').text).toBe('Élève A et Élève B lisent.');
  });
});

describe('findBlockedDetails', () => {
  it('blocks emails, phones and identifiers', () => {
    expect(kinds('Courriel : parent.leblanc@gmail.com')).toEqual(['email']);
    expect(kinds('Appelez le 613-555-0123 ou (613) 555-0199.')).toEqual(['phone', 'phone']);
    expect(kinds('NISO 123456789')).toEqual(['identifier']);
    expect(kinds('OEN : 123 456 789')).toEqual(['identifier']);
    expect(kinds('carte santé 1234-567-890-AB')).toEqual(['identifier']);
    expect(kinds('Numéro 123-456-789')).toEqual(['identifier']);
  });

  it('blocks postal codes and street addresses', () => {
    expect(kinds('Il habite à K1A 0B1.')).toEqual(['postalCode']);
    expect(kinds('Chez elle au 12, rue des Érables')).toEqual(['address']);
    expect(kinds('au 450 boulevard Saint-Joseph')).toEqual(['address']);
  });

  it('blocks a child’s birth date but not historical dates', () => {
    expect(kinds('Léa est née le 3 mai 2017.')).toEqual(['birthDate']);
    expect(kinds('Son anniversaire : 14 février.')).toEqual(['birthDate']);
    expect(kinds('Date : 2017-05-03')).toEqual(['birthDate']);
    expect(kinds('Louis Riel est né le 22 octobre 1844.')).toEqual([]);
    expect(kinds('Le 24 juin 1534, Jacques Cartier arrive.')).toEqual([]);
  });

  it('lets ordinary school texts through', () => {
    const text = [
      'Le castor construit un barrage de 3 mètres.',
      'Écris les nombres jusqu’à 1 000 000 : 125 000, 999 999.',
      'Calcule 1 250 + 3 480 = 4 730.',
      'La classe de 3e année visite le musée le 12 octobre.',
      'Il y a 365 jours dans une année et 24 heures dans un jour.',
      'Arrivée à la 2e place, elle a couru 400 mètres.',
    ].join('\n');
    expect(kinds(text)).toEqual([]);
  });
});
