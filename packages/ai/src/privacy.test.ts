import { describe, expect, it } from 'vitest';
import { findBlockedDetails, PrivacyViolation, Redactor, type KnownPerson } from './privacy';
import { loadPrompt } from './prompts';

const NOW = new Date('2026-09-28T12:00:00Z');

// Characters that look like nothing, or like a plain hyphen or space, in the preview.
const SOFT_HYPHEN = String.fromCodePoint(0xad);
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
const ZERO_WIDTH_JOINER = String.fromCodePoint(0x200d);
const NON_BREAKING_HYPHEN = String.fromCodePoint(0x2011);
const EN_DASH = String.fromCodePoint(0x2013);
const NBSP = String.fromCodePoint(0xa0);
const NARROW_NBSP = String.fromCodePoint(0x202f);

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

  it('finds names split by invisible characters or odd hyphens, and sends the cleaned text', () => {
    const r = new Redactor(roster, NOW);
    expect(r.redact(`Lé${SOFT_HYPHEN}a et Marie${NON_BREAKING_HYPHEN}Ève lisent.`).text).toBe(
      'Élève A et Élève B lisent.',
    );
    expect(r.redact(`Lé${ZERO_WIDTH_SPACE}a rit, Lé${ZERO_WIDTH_JOINER}a court.`).text).toBe(
      'Élève A rit, Élève A court.',
    );
    expect(r.redact('Marie—Ève et Marie_Ève').text).toBe('Élève B et Élève B');
    const other = r.redact(
      `Bon${ZERO_WIDTH_SPACE}jour à Saint${NON_BREAKING_HYPHEN}Jean — enfin !`,
    );
    expect(other.text).toBe('Bonjour à Saint-Jean — enfin !');
    expect(other.segments).toEqual([{ text: 'Bonjour à Saint-Jean — enfin !' }]);
    // The joiner inside an emoji (woman + ZWJ + school = teacher) is not a hidden character.
    const teacher = String.fromCodePoint(0x1f469, 0x200d, 0x1f3eb);
    expect(r.redact(`${teacher} Bonjour`).text).toBe(`${teacher} Bonjour`);
  });

  it('checks the outbound text again on its own, more strictly', () => {
    const r = new Redactor(roster, NOW);
    for (const text of [
      `Lé${SOFT_HYPHEN}a lit.`,
      `Marie${ZERO_WIDTH_SPACE}Ève lit.`,
      'Lé.a lit.',
      'Marie.Ève lit.',
      'Voici (Lé_a).',
      'M.Tremblay parle.',
      'Appelez le ６１３ 555 0123.',
    ]) {
      expect(() => r.assertSafeOutbound(text), text).toThrow(PrivacyViolation);
    }
    const ordinary =
      "Aux J.O., c'est-à-dire aujourd'hui, l'enseignant·e (É.-U.) écrit p. ex. « Élève A-Luc ».";
    expect(() =>
      new Redactor([...roster, { name: 'Jo', kind: 'student' }], NOW).assertSafeOutbound(ordinary),
    ).not.toThrow();
  });

  it('matches letters that have no accent to strip, and names in any script', () => {
    const r = new Redactor(
      ['Łukasz', 'Søren', 'Đức', 'Işıl', 'Анна', '李明'].map((name) => ({
        name,
        kind: 'student' as const,
      })),
      NOW,
    );
    const out = r.redact('Lukasz, Soren, Duc, Isil, анна et 李明 lisent.').text;
    expect(out).toBe('Élève A, Élève B, Élève C, Élève D, Élève E et Élève F lisent.');
    expect(r.restore(out)).toBe('Łukasz, Søren, Đức, Işıl, Анна et 李明 lisent.');
    expect(new Redactor([{ name: 'Lukasz', kind: 'student' }], NOW).redact('Łukasz').text).toBe(
      'Élève A',
    );
  });

  it('matches staff name parts in any case, and each half of a compound name', () => {
    const staff: KnownPerson[] = [
      { name: 'Anne Gagnon-Roy', kind: 'staff' },
      { name: 'Isabelle Tremblay', kind: 'staff' },
      { name: 'Jean-François Bélanger', kind: 'staff' },
      { name: 'Luc Parent', kind: 'staff' },
    ];
    const cases: [text: string, sent: string][] = [
      ['Mme Gagnon parle.', 'Adulte A parle.'],
      ['Roy parle.', 'Adulte A parle.'],
      ['Mme Roy parle.', 'Adulte A parle.'],
      ['tremblay parle.', 'Adulte A parle.'],
      ['isabelle parle.', 'Adulte A parle.'],
      ['Madame Isabelle parle.', 'Adulte A parle.'],
      ['Jean parle.', 'Adulte A parle.'],
      ['jean-françois parle.', 'Adulte A parle.'],
      ['François parle.', 'Adulte A parle.'],
      ['Parent parle.', 'Adulte A parle.'],
      ['Mme parent parle.', 'Adulte A parle.'],
      // Parts that are everyday words only when capitalized.
      ['Un parent achète un jean.', 'Un parent achète un jean.'],
    ];
    for (const [text, sent] of cases) {
      expect(new Redactor(staff, NOW).redact(text).text, text).toBe(sent);
    }
    // A lowercase part may be an everyday word: it comes back exactly as written.
    const r = new Redactor(staff, NOW);
    const sent = r.redact('tremblay les accompagne; Mme Tremblay aussi.').text;
    expect(sent).toBe('Adulte A les accompagne; Adulte B aussi.');
    expect(r.restore(sent)).toBe('tremblay les accompagne; Mme Tremblay aussi.');
  });

  it('keeps name particles and short parts of staff names away from everyday words', () => {
    const staff: KnownPerson[] = [
      { name: 'Marc De Grandpré', kind: 'staff' },
      { name: 'Marie La Salle', kind: 'staff' },
      { name: "Paul D'Amour", kind: 'staff' },
      { name: 'Anne Saint-Pierre', kind: 'staff' },
      { name: 'Minh Lê', kind: 'staff' },
      { name: 'Kevin Au', kind: 'staff' },
      { name: 'Anh Tạ', kind: 'staff' },
      { name: 'Hae-won Son', kind: 'staff' },
    ];
    // Ordinary text: nothing is replaced.
    const ordinary =
      "De plus, la salle de classe est pleine d'amour. Au plus 5 m au sud du fleuve " +
      'Saint-Laurent, le chat de Madame la directrice suit son maître. Ta mère le sait. ' +
      'La salle de gym ouvre à 8 h.';
    const r = new Redactor(staff, NOW);
    expect(r.redact(ordinary).text).toBe(ordinary);
    expect(() => r.assertSafeOutbound(ordinary)).not.toThrow();

    // The people are still found, with the rest of their name or after an honorific.
    const cases: [text: string, sent: string][] = [
      ['Mme De Grandpré parle.', 'Adulte A parle.'],
      ['M. de Grandpré parle.', 'Adulte A parle.'],
      ['De Grandpré parle.', 'Adulte A parle.'],
      ['Grandpré parle.', 'Adulte A parle.'],
      ['Mme La Salle parle.', 'Adulte A parle.'],
      ['La Salle et LaSalle parlent.', 'Adulte A et Adulte A parlent.'],
      ["M. D'Amour parle.", 'Adulte A parle.'],
      ["Paul d'Amour parle.", 'Adulte A parle.'],
      ['Saint-Pierre parle.', 'Adulte A parle.'],
      ['Mme Lê parle.', 'Adulte A parle.'],
      ['Minh Lê parle.', 'Adulte A parle.'],
      ['M. Au parle.', 'Adulte A parle.'],
      ['Mme Tạ parle.', 'Adulte A parle.'],
      ['Mme Son parle.', 'Adulte A parle.'],
    ];
    for (const [text, sent] of cases) {
      expect(new Redactor(staff, NOW).redact(text).text, text).toBe(sent);
    }
    // The last check still finds them hidden by punctuation.
    for (const text of ['M.Lê parle.', 'La.Salle parle.', 'D.Amour parle.']) {
      expect(() => new Redactor(staff, NOW).assertSafeOutbound(text), text).toThrow(
        PrivacyViolation,
      );
    }
  });

  it('matches names that are not everyday words in any case', () => {
    const r = new Redactor(
      ['Léo', 'Noé', 'Rémi'].map((name) => ({ name, kind: 'student' as const })),
      NOW,
    );
    expect(r.redact('léo, noé et rémi lisent.').text).toBe('Élève A, Élève B et Élève C lisent.');
  });

  it('never puts back the wrong person when a name could be several people', () => {
    const roys = new Redactor(
      [
        { name: 'Nathalie Roy', kind: 'staff' },
        { name: 'Marc Roy', kind: 'staff' },
      ],
      NOW,
    );
    const text = 'Mme Roy enseigne la musique et M. Roy l’éducation physique.';
    const sent = roys.redact(text).text;
    expect(sent).toBe('Adulte A enseigne la musique et Adulte B l’éducation physique.');
    expect(roys.restore(sent)).toBe(text);

    const isabelles: KnownPerson[] = [
      { name: 'Isabelle Tremblay', kind: 'staff' },
      { name: 'Isabelle', kind: 'student' },
    ];
    for (const people of [isabelles, [...isabelles].reverse()]) {
      const r = new Redactor(people, NOW);
      const out = r.redact('Isabelle Tremblay félicite Isabelle.').text;
      expect(out).toBe('Adulte A félicite Élève A.');
      expect(r.restore(out)).toBe('Isabelle Tremblay félicite Isabelle.');
    }

    // Two children, "Léa" and "Lea": the name comes back as the teacher typed it.
    const leas = new Redactor(
      [
        { name: 'Léa', kind: 'student' },
        { name: 'Lea', kind: 'student' },
      ],
      NOW,
    );
    expect(leas.restore(leas.redact('LEA lit.').text)).toBe('LEA lit.');
  });

  it('never turns the teacher’s own « élève A » into a real student', () => {
    const people: KnownPerson[] = [
      { name: 'Léa', kind: 'student' },
      { name: 'Noah', kind: 'student' },
    ];
    const text =
      "Léa et Noah font un problème. L'élève A a 5 pommes et l'élève B en a 3. Combien l'élève A en a-t-il de plus que l'élève B ?";
    const r = new Redactor(people, NOW);
    const sent = r.redact(text).text;
    expect(sent).toBe(
      "Élève C et Élève D font un problème. L'élève A a 5 pommes et l'élève B en a 3. Combien l'élève A en a-t-il de plus que l'élève B ?",
    );
    expect(r.restore(sent)).toBe(text);
    expect(r.replacements()).toHaveLength(2);

    // The students were already Élève A and B in an earlier text of the same request.
    const r2 = new Redactor(people, NOW);
    expect(r2.redact('Léa et Noah').text).toBe('Élève A et Élève B');
    const problem = r2.redact("L'élève A a 5 pommes et l'élève B en a 3. L'élève C aussi.").text;
    expect(problem).toBe("L'élève D a 5 pommes et l'élève E en a 3. L'élève C aussi.");
    expect(r2.restore(`Élève A et Élève B. ${problem}`)).toBe(
      "Léa et Noah. L'élève A a 5 pommes et l'élève B en a 3. L'élève C aussi.",
    );
    expect(r2.replacements()).toHaveLength(2);
  });

  it('lets the real system prompt through with a roster of common names', async () => {
    // A name that is also a word of the prompt (« fidèle au texte ») would block every request.
    const surnames = (
      'Tremblay Gagnon Roy Côté Bouchard Gauthier Morin Lavoie Fortin Gagné Ouellet Pelletier ' +
      'Bélanger Lévesque Bergeron Leblanc Girard Simard Boucher Caron Beaulieu Cloutier Dubé ' +
      'Poirier Fournier Lapointe Lefebvre Poulin Martin Landry Grenier Richard Hébert Couture ' +
      'Parent Plante Racine Paré Léger Page Petit Fontaine Marchand Champagne Laurier Carrière ' +
      'Paradis Masse Major Normand Chevalier Séguin Lalonde Charbonneau Brisebois Lacroix ' +
      'Cormier Doucet Thériault Smith Brown Wilson'
    ).split(' ');
    const firsts = (
      'Jean Marc Luc Paul Guy Denis Michel Pierre André Claude Louis Martin Simon Pascal Julie ' +
      'Nathalie Isabelle Sophie Marie Anne Chantal Josée Lucie Claire Diane Line Lise Sylvie ' +
      'France Manon Maxime Olivier Constant Aimé Désiré Fidèle Jean-François Marie-Ève'
    ).split(' ');
    // Particles and very short parts (« De », « La », « Du », « Lê », « Au ») are everyday
    // words of the prompt too.
    const withParticles = [
      'Marc De Grandpré',
      'Luc Des Rosiers',
      'Julie Du Sablon',
      'Anne La Salle',
      'Jean De La Salle',
      "Paul D'Amour",
      "Luc L'Heureux",
      'Anne Saint-Pierre',
      'Guy St-Onge',
      'Ana De Souza',
      'Anne Van Horne',
      'Ali El Amrani',
      'Minh Lê',
      'Lê Minh',
      'Thi Tạ',
      'Anh Tu',
      'Kevin Au',
      'Paul Ni',
      'Sam Ou',
      'Wei Si',
      'Hae-won Son',
      'Mai Lui',
    ];
    const people: KnownPerson[] = [
      ...surnames.map((s, i) => ({
        name: `${firsts[i % firsts.length]} ${s}`,
        kind: 'staff' as const,
      })),
      ...withParticles.map((name) => ({ name, kind: 'staff' as const })),
      ...firsts.map((name) => ({ name, kind: 'student' as const })),
    ];
    const prompt = await loadPrompt('differentiate', 'v1');
    const r = new Redactor(people, NOW);
    expect(() => r.assertSafeOutbound(prompt)).not.toThrow();
    // Nor does the preview mark its ordinary words.
    expect(r.redact(prompt).text).toBe(prompt);
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

  it('blocks year-first dates with any separator and dates written in English', () => {
    for (const text of [
      'née le 2017/05/03',
      'Date : 2017.05.03',
      `Date : 2017${EN_DASH}05${EN_DASH}03`,
      'born May 3, 2017',
      'Birthday: March 14',
      'Birthday: March 14, 2017.',
      'DOB: Jan. 5, 2016',
      'born on the 3rd of May 2017',
    ]) {
      expect(kinds(text), text).toEqual(['birthDate']);
    }
    expect(kinds('Louis Riel was born October 22, 1844.')).toEqual([]);
    expect(kinds('Version 2019.13.45 du logiciel')).toEqual([]);
  });

  it('blocks street addresses written in English order', () => {
    for (const text of [
      'He lives at 450 Elgin Street.',
      'Chez lui : 123 Bank St.',
      '100 Queen St, Ottawa',
      '98 Ridgewood Ave',
      '98 Crestview Blvd',
      '742 Evergreen Terrace',
      '12A St. Laurent Blvd',
      'au 450, 3e Avenue',
      'au 1500 prom. Riverside',
      'au 22 cr. des Pins',
      '15 Maple Court',
      '5 Bayview Place',
    ]) {
      expect(kinds(text), text).toEqual(['address']);
    }
  });

  it('blocks numbers written with typographic spaces and dashes', () => {
    expect(kinds(`K1A${NBSP}0B1`)).toEqual(['postalCode']);
    expect(kinds(`K1A${NARROW_NBSP}0B1`)).toEqual(['postalCode']);
    expect(kinds(`K1A${EN_DASH}0B1`)).toEqual(['postalCode']);
    for (const text of [
      `613${NON_BREAKING_HYPHEN}555${NON_BREAKING_HYPHEN}1234`,
      `613${EN_DASH}555${EN_DASH}1234`,
      '613 - 555 - 1234',
      '613/555-1234',
    ]) {
      expect(kinds(text), text).toEqual(['phone']);
    }
    expect(kinds(`1234${EN_DASH}567${EN_DASH}890`)).toEqual(['identifier']);
    expect(kinds('1234.567.890')).toEqual(['identifier']);
    expect(kinds(`123${NON_BREAKING_HYPHEN}456${NON_BREAKING_HYPHEN}789`)).toEqual(['identifier']);
  });

  it('lets ordinary school texts through', () => {
    const text = [
      'Le castor construit un barrage de 3 mètres.',
      'Écris les nombres jusqu’à 1 000 000 : 125 000, 999 999.',
      'Calcule 1 250 + 3 480 = 4 730.',
      'La classe de 3e année visite le musée le 12 octobre.',
      'Il y a 365 jours dans une année et 24 heures dans un jour.',
      'Arrivée à la 2e place, elle a couru 400 mètres.',
      'Chapitre 3 : Le Petit Prince rencontre le renard.',
      '— Bonjour ! dit-il. Il a couru 3 km — bravo !',
      'The 3 Little Pigs build 3 houses on Main Street.',
      'Le 1er juillet 1867, le Canada devient un pays.',
      'En 2019-2020, l’école comptait 250 élèves; en 2025–2026, 310.',
      'Page 12, exercices 3 à 5. Il est né en mai.',
      'En 1980, Terry Fox court le Marathon de l’espoir.',
      'En 2009, Usain Bolt court le 100 mètres en 9,58 secondes.',
      'En 1534, Jacques Cartier place une croix à Gaspé.',
    ].join('\n');
    expect(kinds(text)).toEqual([]);
  });
});
