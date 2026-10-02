/**
 * « Classe exemple (5e année) » (DECISIONS D-109): a Français and a Mathématiques unit of 8
 * lessons each, original and in Ontario French, with `subNotes` on lesson 4 (so the « Fiche de
 * suppléance » and a plan's notes make sense). No person is named: the class's students are
 * `SAMPLE_FIRST_NAMES`.
 */
import type { SampleUnitContent } from './index';

export const SAMPLE_UNITS_5E: readonly SampleUnitContent[] = [
  {
    subjectCode: 'fra',
    title: 'Écrire un texte descriptif',
    description:
      'Les élèves lisent un texte descriptif modèle, choisissent un animal du Canada, organisent leurs notes en sous-thèmes et écrivent un texte de trois paragraphes.',
    lessons: [
      {
        title: 'Lire un texte descriptif modèle',
        objectives: 'Reconnaître le but d’un texte descriptif et ses parties.',
        materials: 'Texte modèle sur le castor, surligneurs de deux couleurs.',
        content:
          'Lecture du texte modèle en grand groupe. Les élèves surlignent l’introduction d’une couleur et les renseignements d’une autre. Discussion : à quoi sert ce texte?',
        subNotes: null,
        durationMinutes: 50,
      },
      {
        title: 'Repérer les intertitres et les paragraphes',
        objectives: 'Expliquer comment les intertitres organisent l’information.',
        materials: 'Texte modèle, fiche de repérage.',
        content:
          'En équipes, les élèves repèrent les intertitres du texte modèle et résument chaque paragraphe en une phrase. Mise en commun au tableau.',
        subNotes: null,
        durationMinutes: 50,
      },
      {
        title: 'Choisir un animal et chercher des renseignements',
        objectives: 'Trouver des renseignements fiables dans deux sources.',
        materials: 'Livres documentaires de la bibliothèque, fiche de notes.',
        content:
          'Chaque élève choisit un animal du Canada dans la liste affichée. Ils notent au moins huit renseignements, en mots-clés, et le titre des deux sources consultées.',
        subNotes: null,
        durationMinutes: 50,
      },
      {
        title: 'Organiser ses notes en sous-thèmes',
        objectives:
          'Classer ses notes sous trois sous-thèmes : l’habitat, l’alimentation et l’apparence.',
        materials: 'Fiches de notes des élèves, organisateur graphique en trois colonnes.',
        content:
          'Modéliser le classement avec les notes sur le castor. Les élèves classent ensuite leurs propres notes dans l’organisateur et ajoutent un intertitre à chaque colonne.',
        subNotes:
          'Les fiches de notes sont dans le classeur vert, une pochette par élève. Les organisateurs graphiques photocopiés sont sur le bureau. Faire l’exemple du castor au tableau pendant dix minutes, puis laisser travailler en silence.',
        durationMinutes: 50,
      },
      {
        title: 'Rédiger l’introduction',
        objectives: 'Écrire une introduction qui présente le sujet et capte l’attention.',
        materials: 'Organisateur graphique, cahier d’écriture.',
        content:
          'Comparer deux introductions et choisir la plus intéressante. Les élèves écrivent leur introduction avec une question ou un fait étonnant, puis la présentent sujet amené, sujet posé.',
        subNotes: null,
        durationMinutes: 50,
      },
      {
        title: 'Rédiger les paragraphes',
        objectives: 'Écrire un paragraphe par sous-thème avec une phrase principale.',
        materials: 'Organisateur graphique, cahier d’écriture.',
        content:
          'Rappel de la phrase principale et des phrases secondaires. Les élèves rédigent leurs trois paragraphes à partir de leurs notes, sans copier les sources.',
        subNotes: null,
        durationMinutes: 50,
      },
      {
        title: 'Réviser et corriger',
        objectives: 'Améliorer son texte et corriger les accords dans le groupe du nom.',
        materials: 'Grille de révision, dictionnaire.',
        content:
          'Les élèves relisent leur texte avec la grille : une fois pour le sens, une fois pour l’orthographe. Échange avec un ou une camarade qui donne un compliment et une suggestion.',
        subNotes: null,
        durationMinutes: 50,
      },
      {
        title: 'Présenter son texte',
        objectives: 'Présenter son texte devant un petit groupe en parlant clairement.',
        materials: 'Textes au propre, illustrations des élèves.',
        content:
          'Présentations en petits groupes de quatre. Chaque élève présente son animal et répond à une question. On affiche ensuite les textes dans le corridor.',
        subNotes: null,
        durationMinutes: 50,
      },
    ],
  },
  {
    subjectCode: 'mat',
    title: 'Les fractions',
    description:
      'Représenter, comparer et utiliser des fractions avec du matériel, puis faire le lien avec les dixièmes et résoudre des problèmes.',
    lessons: [
      {
        title: 'Représenter des fractions',
        objectives: 'Représenter une fraction d’un tout avec du matériel et un dessin.',
        materials: 'Bandes de fractions, cercles de fractions.',
        content:
          'Plier une bande de papier en parts égales. Les élèves représentent 1/2, 1/4 et 3/4 avec les bandes, puis les dessinent et les écrivent en mots.',
        subNotes: null,
        durationMinutes: 50,
      },
      {
        title: 'Les fractions équivalentes',
        objectives: 'Trouver des fractions équivalentes à l’aide de bandes de fractions.',
        materials: 'Bandes de fractions, feuille d’exercices.',
        content:
          'Montrer que 1/2, 2/4 et 4/8 couvrent la même longueur. En équipes, les élèves trouvent trois autres familles de fractions équivalentes.',
        subNotes: null,
        durationMinutes: 50,
      },
      {
        title: 'Comparer des fractions',
        objectives: 'Comparer des fractions qui ont le même numérateur ou le même dénominateur.',
        materials: 'Droite numérique de 0 à 1, cartes de fractions.',
        content:
          'Placer des fractions sur la droite numérique. Jeu de cartes en équipes de deux : la plus grande fraction gagne, à condition d’expliquer pourquoi.',
        subNotes: null,
        durationMinutes: 50,
      },
      {
        title: 'Fractions d’un ensemble',
        objectives: 'Trouver une fraction d’un ensemble d’objets.',
        materials: 'Jetons de couleur, feuille d’exercices de la page 34.',
        content:
          'Avec 12 jetons, trouver la moitié, le tiers et le quart. Les élèves résolvent ensuite six situations avec les jetons, puis sans.',
        subNotes:
          'Les jetons sont dans les petits contenants transparents, sur l’étagère près de la fenêtre. Faire l’exemple des 12 jetons au tableau, puis distribuer les feuilles d’exercices. Les élèves qui finissent tôt peuvent créer leur propre situation.',
        durationMinutes: 50,
      },
      {
        title: 'Les nombres fractionnaires',
        objectives: 'Représenter des nombres fractionnaires et des fractions impropres.',
        materials: 'Cercles de fractions, feuille d’exercices.',
        content:
          'Montrer 1 et 3/4 avec des cercles. Les élèves représentent cinq nombres fractionnaires et les écrivent aussi sous forme de fraction impropre.',
        subNotes: null,
        durationMinutes: 50,
      },
      {
        title: 'Fractions et dixièmes',
        objectives: 'Faire le lien entre les dixièmes et les nombres décimaux.',
        materials: 'Grilles de dix, droite numérique de 0 à 1.',
        content:
          'Colorier 3 cases d’une grille de dix et écrire 3/10 et 0,3. Les élèves associent des fractions en dixièmes à leur nombre décimal et les placent sur la droite numérique.',
        subNotes: null,
        durationMinutes: 50,
      },
      {
        title: 'Résoudre des problèmes',
        objectives: 'Utiliser les fractions pour résoudre des problèmes de partage.',
        materials: 'Trois problèmes affichés, cahier de mathématiques.',
        content:
          'Lire un problème de partage de pizza ensemble. En équipes, les élèves résolvent les problèmes et présentent leur démarche avec un dessin et une phrase réponse.',
        subNotes: null,
        durationMinutes: 50,
      },
      {
        title: 'Retour et petite évaluation',
        objectives: 'Montrer ce qu’on a appris sur les fractions.',
        materials: 'Petite évaluation d’une page.',
        content:
          'Courte révision avec les bandes de fractions, puis évaluation individuelle de huit questions. Retour en grand groupe sur les questions les plus difficiles.',
        subNotes: null,
        durationMinutes: 50,
      },
    ],
  },
];
