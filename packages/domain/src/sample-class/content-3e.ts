/**
 * « Classe exemple (3e année) » (DECISIONS D-109): a Français and a Mathématiques unit of 8
 * lessons each, original and in Ontario French, with `subNotes` on lesson 4 (so the « Fiche de
 * suppléance » and a plan's notes make sense). No person is named: the class's students are
 * `SAMPLE_FIRST_NAMES`.
 */
import type { SampleUnitContent } from './index';

export const SAMPLE_UNITS_3E: readonly SampleUnitContent[] = [
  {
    subjectCode: 'fra',
    title: 'Lire et raconter une histoire',
    description:
      'Lecture d’un album en classe, puis les éléments du récit : les personnages, le lieu, le problème et la solution. Les élèves finissent en écrivant une nouvelle fin.',
    lessons: [
      {
        title: 'Découvrir le livre',
        objectives: 'Faire des prédictions à partir du titre, de la couverture et des images.',
        materials: 'Un album de la bibliothèque de l’école, tableau blanc.',
        content:
          'Montrer la couverture et lire le titre à voix haute. Les élèves disent ce qu’ils pensent que l’histoire va raconter. Noter trois prédictions au tableau. Lire les quatre premières pages et revenir aux prédictions.',
        subNotes: null,
        durationMinutes: 50,
      },
      {
        title: 'Les personnages de l’histoire',
        objectives: 'Nommer les personnages et décrire le personnage principal.',
        materials: 'L’album, une feuille avec un grand cadre pour dessiner.',
        content:
          'Relire le début de l’histoire. En équipes de deux, les élèves dressent la liste des personnages. Chaque élève dessine le personnage principal et écrit deux mots qui le décrivent.',
        subNotes: null,
        durationMinutes: 50,
      },
      {
        title: 'Le lieu et le moment',
        objectives: 'Repérer où et quand l’histoire se passe à l’aide d’indices dans le texte.',
        materials: 'L’album, des papillons adhésifs.',
        content:
          'Lire la suite de l’histoire. Les élèves collent un papillon adhésif sur chaque indice du lieu ou du moment. Mise en commun : on vérifie ensemble chaque indice.',
        subNotes: null,
        durationMinutes: 50,
      },
      {
        title: 'Le problème de l’histoire',
        objectives: 'Expliquer dans ses mots le problème que vit le personnage principal.',
        materials: 'L’album, le cahier de lecture.',
        content:
          'Lire jusqu’au moment où le problème apparaît. Discussion en grand groupe, puis chaque élève écrit une phrase qui commence par « Le problème, c’est que… » dans son cahier de lecture.',
        subNotes:
          'L’album est sur le bureau, marqué d’un signet à la page du problème. Lire à voix haute jusqu’au signet seulement. Les cahiers de lecture sont dans le bac bleu. Les élèves qui ont fini peuvent dessiner le problème sous leur phrase.',
        durationMinutes: 50,
      },
      {
        title: 'La solution',
        objectives: 'Trouver comment le problème est réglé et donner son avis sur la solution.',
        materials: 'L’album, le cahier de lecture.',
        content:
          'Avant de lire la fin, les élèves proposent des solutions possibles. Lire la fin de l’histoire. Comparer les propositions avec la solution de l’auteur. Chaque élève écrit s’il aime la solution et pourquoi.',
        subNotes: null,
        durationMinutes: 50,
      },
      {
        title: 'Raconter dans l’ordre',
        objectives: 'Raconter l’histoire en respectant le début, le milieu et la fin.',
        materials: 'Six images de l’histoire photocopiées, colle, ciseaux.',
        content:
          'Les élèves découpent les six images et les placent dans l’ordre. Ils collent les images, puis racontent l’histoire à un ou une camarade en utilisant « d’abord », « ensuite » et « à la fin ».',
        subNotes: null,
        durationMinutes: 50,
      },
      {
        title: 'Écrire une nouvelle fin',
        objectives: 'Écrire trois phrases qui donnent une autre fin à l’histoire.',
        materials: 'Feuille d’écriture lignée, banque de mots affichée.',
        content:
          'Rappel de la fin de l’auteur. Remue-méninges : quelles autres fins seraient possibles? Chaque élève écrit au moins trois phrases, en commençant par une majuscule et en finissant par un point.',
        subNotes: null,
        durationMinutes: 50,
      },
      {
        title: 'Présenter sa nouvelle fin',
        objectives: 'Lire son texte à voix haute de façon claire et écouter les autres.',
        materials: 'Les textes des élèves, la grille d’écoute.',
        content:
          'En petits groupes, chaque élève lit sa nouvelle fin. Les autres disent une chose qu’ils ont aimée. Retour en grand groupe sur les fins les plus surprenantes.',
        subNotes: null,
        durationMinutes: 50,
      },
    ],
  },
  {
    subjectCode: 'mat',
    title: 'Additionner et soustraire jusqu’à 1 000',
    description:
      'Les nombres jusqu’à 1 000, puis l’addition et la soustraction avec et sans regroupement, avec du matériel de base dix et des problèmes écrits.',
    lessons: [
      {
        title: 'Représenter des nombres jusqu’à 1 000',
        objectives: 'Représenter un nombre avec des blocs de base dix et le décomposer.',
        materials: 'Blocs de base dix, tableau de numération.',
        content:
          'Montrer 245 avec des blocs : 2 plaques, 4 réglettes, 5 petits cubes. En équipes, les élèves représentent cinq nombres, puis les écrivent sous la forme 200 + 40 + 5.',
        subNotes: null,
        durationMinutes: 50,
      },
      {
        title: 'Comparer et ordonner des nombres',
        objectives: 'Comparer des nombres à trois chiffres avec les symboles < et >.',
        materials: 'Cartes de nombres, droite numérique au tableau.',
        content:
          'Placer quelques nombres sur la droite numérique. Jeu en équipes de deux : chaque élève tire une carte, et celui ou celle qui a le plus grand nombre l’explique en parlant des centaines, des dizaines et des unités.',
        subNotes: null,
        durationMinutes: 50,
      },
      {
        title: 'Additionner sans regroupement',
        objectives: 'Additionner deux nombres à trois chiffres sans regroupement.',
        materials: 'Blocs de base dix, feuille d’exercices.',
        content:
          'Modéliser 324 + 152 avec les blocs, puis avec la méthode en colonnes. Les élèves font six additions, d’abord avec les blocs, ensuite sans.',
        subNotes: null,
        durationMinutes: 50,
      },
      {
        title: 'Additionner avec regroupement',
        objectives: 'Additionner deux nombres à trois chiffres avec un regroupement.',
        materials: 'Blocs de base dix, feuille d’exercices de la page 12.',
        content:
          'Montrer 238 + 145 : quand il y a 10 unités ou plus, on les échange contre une dizaine. Pratique guidée de trois additions, puis travail autonome.',
        subNotes:
          'Les blocs de base dix sont dans les bacs gris, un bac par équipe de deux. Faire les trois premières additions ensemble au tableau, puis laisser travailler. Ramasser les feuilles d’exercices et les laisser sur le bureau.',
        durationMinutes: 50,
      },
      {
        title: 'Soustraire sans regroupement',
        objectives: 'Soustraire des nombres à trois chiffres sans regroupement.',
        materials: 'Blocs de base dix, droite numérique.',
        content:
          'Modéliser 486 − 253 en retirant des blocs. Vérifier la réponse en additionnant. Les élèves font six soustractions et vérifient chacune par une addition.',
        subNotes: null,
        durationMinutes: 50,
      },
      {
        title: 'Soustraire avec regroupement',
        objectives: 'Soustraire des nombres à trois chiffres avec un échange.',
        materials: 'Blocs de base dix, feuille d’exercices.',
        content:
          'Montrer 342 − 127 : on échange une dizaine contre 10 unités. Pratique guidée, puis jeu de la boutique de l’école avec des prix jusqu’à 500 $.',
        subNotes: null,
        durationMinutes: 50,
      },
      {
        title: 'Résoudre des problèmes écrits',
        objectives: 'Choisir l’opération qui convient et expliquer sa démarche.',
        materials: 'Quatre problèmes écrits affichés, cahier de mathématiques.',
        content:
          'Lire un problème ensemble et souligner la question. Les élèves résolvent les problèmes en équipes, en montrant leur démarche avec un dessin, des nombres et une phrase réponse.',
        subNotes: null,
        durationMinutes: 50,
      },
      {
        title: 'Retour et petite évaluation',
        objectives: 'Montrer ce qu’on a appris sur l’addition et la soustraction.',
        materials: 'Petite évaluation d’une page.',
        content:
          'Courte révision au tableau, puis évaluation individuelle de six questions. Les élèves qui finissent tôt créent un problème pour un ou une camarade.',
        subNotes: null,
        durationMinutes: 50,
      },
    ],
  },
];
