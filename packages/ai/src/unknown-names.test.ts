import { describe, expect, it } from 'vitest';
import { capitalizedWords, findTitledUnknownNames, NEVER_A_PERSON } from './unknown-names';

/**
 * The title rule and the words to check (D-139, D-132, as amended in the post-MVP review): every
 * example the reviewers sent is here, so a leak they found can never come back.
 */
const titled = (text: string) => findTitledUnknownNames(text).map((f) => f.match);

describe('findTitledUnknownNames: a title not followed by a name the app knows', () => {
  it('finds a title followed by a name the app does not know', () => {
    expect(titled('Merci à Mme Dupuis pour son aide.')).toEqual(['Mme Dupuis']);
    expect(titled('Merci à M. Watson et à Mx Lê.')).toEqual(['M. Watson', 'Mx Lê']);
    expect(titled('Merci à M. et Mme Dupuis.')).toEqual(['Mme Dupuis']);
    expect(titled('Thanks to Mr. Smith, Dr Lee and Dre Roy!')).toEqual([
      'Mr. Smith',
      'Dr Lee',
      'Dre Roy',
    ]);
    expect(titled('merci à madame Gagnon')).toEqual(['madame Gagnon']);
    expect(titled('Le père Gagnon et sœur Lucie viendront.')).toEqual([
      'père Gagnon',
      'sœur Lucie',
    ]);
    expect(titled('Mon frère Lucas et l’abbé Roy.')).toEqual(['frère Lucas', 'abbé Roy']);
    expect(titled('Mme DUPUIS viendra.')).toEqual(['Mme DUPUIS']);
  });

  it('applies no allow-list after a title (security review 1)', () => {
    expect(titled('Merci à Mme Noël pour les biscuits.')).toEqual(['Mme Noël']);
    expect(titled('Merci à M. Toussaint qui est venu parler de son métier.')).toEqual([
      'M. Toussaint',
    ]);
    expect(titled('Merci à Mme St-Pierre pour les biscuits.')).toEqual(['Mme St-Pierre']);
    expect(titled('Merci à M. Saint-Onge pour le transport.')).toEqual(['M. Saint-Onge']);
    expect(titled('Merci à Mme Ste-Marie qui a accompagné la sortie.')).toEqual(['Mme Ste-Marie']);
    expect(titled('Merci à Mme Grace Dupuis pour sa visite.')).toEqual(['Mme Grace Dupuis']);
    expect(titled('Merci à Mme April Dupuis pour sa visite.')).toEqual(['Mme April Dupuis']);
    expect(titled('Thanks to Mrs. June Smith and Mr. English.')).toEqual([
      'Mrs. June Smith',
      'Mr. English',
    ]);
    expect(titled('Le père Noël Bélanger viendra.')).toEqual(['père Noël Bélanger']);
    // Fail closed: « le père Noël » is a title before a name the app does not know.
    expect(titled('Le père Noël passera.')).toEqual(['père Noël']);
    expect(titled('Merci à Mme Épiphanie et à M. Jesus Garcia.')).toEqual([
      'Mme Épiphanie',
      'M. Jesus Garcia',
    ]);
  });

  it('knows the titles of a Catholic school’s letters, plural ones included (review 2)', () => {
    expect(titled('Merci à Mmes Dupuis et Côté.')).toEqual(['Mmes Dupuis']);
    expect(titled('Merci à MM. Bélanger et Roy.')).toEqual(['MM. Bélanger']);
    expect(titled('Merci à Mesdames Roy et Côté.')).toEqual(['Mesdames Roy']);
    expect(titled('Merci à Messieurs Roy et Côté.')).toEqual(['Messieurs Roy']);
    expect(titled('Le curé Bélanger et le diacre Lavoie.')).toEqual([
      'curé Bélanger',
      'diacre Lavoie',
    ]);
    expect(titled('Merci à Me Lavoie.')).toEqual(['Me Lavoie']);
    expect(titled('Merci à Sr Thérèse.')).toEqual(['Sr Thérèse']);
    expect(titled('Merci au P. Lemieux.')).toEqual(['P. Lemieux']);
    expect(titled('Merci à Coach Miller et à Miss Smith.')).toEqual(['Coach Miller', 'Miss Smith']);
    expect(titled('Merci à Mlle Roy, à Pr Gagnon, à Pre Côté et à Mgr Ouellet.')).toEqual([
      'Mlle Roy',
      'Pr Gagnon',
      'Pre Côté',
      'Mgr Ouellet',
    ]);
    expect(titled('Thanks to Father Smith, Sister Mary, Brother John and Rev. Lee.')).toEqual([
      'Father Smith',
      'Sister Mary',
      'Brother John',
      'Rev. Lee',
    ]);
    expect(titled('Merci à Mister Brown, au docteur Roy et à monseigneur Durocher.')).toEqual([
      'Mister Brown',
      'docteur Roy',
      'monseigneur Durocher',
    ]);
    expect(titled('Grand-maman Lucie et tante Julie viendront.')).toEqual([
      'maman Lucie',
      'tante Julie',
    ]);
  });

  it('takes any space between the title and the name, a line break included (review 2)', () => {
    for (const space of [' ', '\t', '\n', ' ', ' ', ' ', ' ', ' ', ' ', ' ', '　', '  ']) {
      expect(titled(`Merci à Mme${space}Dupuis pour les biscuits.`)).toEqual([`Mme${space}Dupuis`]);
      expect(titled(`Merci à madame${space}Dupuis.`)).toEqual([`madame${space}Dupuis`]);
    }
  });

  it('looks up to three words past the title (« M. le maire Watson »)', () => {
    expect(titled('Bienvenue à M. le maire Watson.')).toEqual(['M. le maire Watson']);
    expect(titled('Merci à Mme la directrice adjointe Dupuis.')).toEqual([
      'Mme la directrice adjointe Dupuis',
    ]);
  });

  it('takes the word after an honorific for a name whatever its case', () => {
    expect(titled('merci à madame dupuis')).toEqual(['madame dupuis']);
    expect(titled('Merci à Mme dupuis et à monsieur roy.')).toEqual(['Mme dupuis', 'monsieur roy']);
  });

  it('finds the rest of a name after a marker', () => {
    expect(titled('Merci à Mme Élève B Dupuis.')).toEqual(['Mme Élève B Dupuis']);
    expect(titled('Merci à Adulte A Dupuis.')).toEqual(['Adulte A Dupuis']);
    expect(titled('Merci à Mme O’Brien et à Mme Dupuis-Lavoie.')).toEqual([
      'Mme O’Brien',
      'Mme Dupuis-Lavoie',
    ]);
    expect(titled('Mme Pasteur viendra.')).toEqual(['Mme Pasteur']);
  });

  it('never finds a marker alone, little words or everyday nouns', () => {
    expect(titled('Merci à Adulte A et à Mme Élève B.')).toEqual([]);
    expect(titled('Merci à Adulte A, à Mme Élève B et à Élève C.')).toEqual([]);
    expect(titled('Mme la directrice a dit que nous irons.')).toEqual([]);
    expect(titled('Monsieur est arrivé.')).toEqual([]);
    expect(titled('Sa mère viendra jeudi avec son frère.')).toEqual([]);
    expect(titled('Me voici.')).toEqual([]);
    expect(titled('Version FR et EN.')).toEqual([]);
  });

  it('needs a capital for an abbreviation and a space after a whole word', () => {
    // « m » of « 100 m », « mère. » at the end of a sentence, « Père, » in a prayer.
    expect(titled('La course de 100 m. Bravo à tous!')).toEqual([]);
    expect(titled('Merci à sa mère. Demain, nous irons au parc.')).toEqual([]);
    expect(titled('Au nom du Père, du Fils et du Saint-Esprit.')).toEqual([]);
    expect(titled('Notre Père qui es aux cieux.')).toEqual([]);
  });
});

describe('capitalizedWords: words to check before sending', () => {
  it('lists capitalized words, never markers, titles, acronyms or words that are never a person', () => {
    expect(
      capitalizedWords([
        'Bonjour chères familles,',
        'Merci à Julie et à Élève A pour la collecte organisée avec la paroisse Sainte-Famille.',
        'Les élèves de 3e année visiteront le Musée canadien de la nature avec Adulte B.',
        'Rappel : la journée PA est vendredi. Noël approche, et Dieu nous aime.',
      ]),
    ).toEqual(['Julie', 'Musée']);
  });

  it('lists a name at the start of a sentence, after a colon, a parenthesis or a quotation mark (review 3)', () => {
    expect(capitalizedWords(['Lecteur mystère de la semaine : Sophie!'])).toEqual([
      'Lecteur',
      'Sophie',
    ]);
    expect(capitalizedWords(['Merci à la maman d’Élève A (Sophie) pour les biscuits.'])).toEqual([
      'Sophie',
    ]);
    expect(capitalizedWords(['« Sophie viendra lire », a dit Élève A.'])).toEqual(['Sophie']);
    expect(capitalizedWords(['Merci au P. Lemieux.'])).toEqual(['Lemieux']);
    expect(capitalizedWords(['Sophie viendra lire une histoire.'])).toEqual(['Sophie']);
    expect(capitalizedWords(['Bénévoles — Sophie, Julie et Marc.'])).toEqual([
      'Bénévoles',
      'Sophie',
      'Julie',
      'Marc',
    ]);
  });

  it('leaves out the little words that start a sentence or a quotation', () => {
    expect(capitalizedWords(['Demain, nous irons au parc.'])).toEqual([]);
    expect(capitalizedWords(['Les Dupuis viendront. Merci à Son et à Bon.'])).toEqual([
      'Dupuis',
      'Son',
      'Bon',
    ]);
    expect(capitalizedWords(['« Les Nombres » est notre unité.'])).toEqual(['Nombres']);
    expect(capitalizedWords(['Mardi 6 octobre à 12 h 05 : Messe de l’école.'])).toEqual([]);
  });

  it('lists words that are also feasts or months when they name a person', () => {
    // After a title they are findings; alone, a first name that is also a word is listed.
    expect(capitalizedWords(['Merci à Grace, à June et à April.'])).toEqual([
      'Grace',
      'June',
      'April',
    ]);
    expect(NEVER_A_PERSON.has('grace')).toBe(false);
  });

  it('finds a name after an elision, each word once', () => {
    expect(capitalizedWords(['Le livre d’Hélène.', 'Hélène et Hélène.'])).toEqual(['Hélène']);
  });
});
