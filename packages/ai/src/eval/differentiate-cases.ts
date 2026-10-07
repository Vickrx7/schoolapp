/**
 * Evaluation set for « Texte différencié » (SPEC 10: 10 sample inputs with expected qualities).
 * Fictional texts written for this purpose. Run with `pnpm ai:eval` before any prompt change.
 */
import type { KnownPerson } from '../privacy';

export interface DifferentiateCase {
  id: string;
  title: string;
  gradeCode: string;
  gradeLabel: string;
  subjectLabel: string | null;
  itemType: 'reading_passage' | 'worksheet';
  objective: string;
  text: string;
  /** Words every version must keep (compared without accents or case). */
  mustKeep: string[];
  /** People in the case's imaginary class, to check de-identification. */
  people?: KnownPerson[];
}

export const differentiateCases: DifferentiateCase[] = [
  {
    id: 'castor-3e',
    title: 'Le castor, ingénieur de la nature',
    gradeCode: '3',
    gradeLabel: '3e année',
    subjectLabel: 'Sciences et technologie',
    itemType: 'reading_passage',
    objective: '',
    text: "Le castor est le plus gros rongeur du Canada. Avec ses dents orange très solides, il coupe des arbres près des rivières. Il utilise les branches, la boue et les pierres pour construire un barrage. Le barrage retient l'eau et forme un étang. Au milieu de l'étang, le castor bâtit sa hutte. L'entrée est sous l'eau, ce qui protège sa famille des prédateurs comme le loup. L'étang créé par le castor devient aussi un habitat pour les grenouilles, les canards et les poissons.",
    mustKeep: ['castor', 'barrage'],
  },
  {
    id: 'consignes-maths-2e',
    title: 'Mesurer la classe',
    gradeCode: '2',
    gradeLabel: '2e année',
    subjectLabel: 'Mathématiques',
    itemType: 'worksheet',
    objective:
      'Mesurer des longueurs avec des unités non conventionnelles et comparer les résultats.',
    text: '1. Prends un trombone et un crayon.\n2. Mesure la longueur de ton pupitre avec des trombones. Écris le nombre de trombones.\n3. Mesure la même longueur avec des crayons. Écris le nombre de crayons.\n4. Compare tes deux réponses. Pourquoi les nombres sont-ils différents ?\n5. Avec ton ou ta partenaire, trouve un objet de la classe qui mesure environ 10 trombones.',
    mustKeep: ['trombone', 'crayon', 'mesure'],
  },
  {
    id: 'saisons-maternelle',
    title: 'Les saisons',
    gradeCode: 'K2',
    gradeLabel: 'Jardin d’enfants',
    subjectLabel: null,
    itemType: 'reading_passage',
    objective: '',
    text: "Il y a quatre saisons au Canada. En hiver, il fait froid et il neige. On met une tuque et des mitaines. Au printemps, la neige fond et les fleurs poussent. En été, il fait chaud. On joue dehors et on se baigne. À l'automne, les feuilles changent de couleur et tombent des arbres.",
    mustKeep: ['hiver', 'printemps', 'ete', 'automne'],
  },
  {
    id: 'champlain-6e',
    title: 'Samuel de Champlain et la fondation de Québec',
    gradeCode: '6',
    gradeLabel: '6e année',
    subjectLabel: 'Études sociales',
    itemType: 'reading_passage',
    objective: '',
    text: "En 1608, Samuel de Champlain fonde un poste de traite sur les rives du fleuve Saint-Laurent : c'est le début de Québec. Champlain établit des alliances avec les Wendats, les Innus et les Algonquins, qui connaissent le territoire et échangent des fourrures contre des objets européens. Ces alliances sont essentielles à la survie de la petite colonie, car les hivers sont longs et rigoureux. Toutefois, l'arrivée des Européens transforme profondément la vie des Premières Nations : les maladies, les conflits et les changements dans le commerce ont des conséquences importantes et durables.",
    mustKeep: ['Champlain', '1608', 'Premieres Nations'],
  },
  {
    id: 'priere-4e',
    title: 'La prière de saint François',
    gradeCode: '4',
    gradeLabel: '4e année',
    subjectLabel: 'Enseignement religieux',
    itemType: 'reading_passage',
    objective:
      'Comprendre comment la prière de saint François nous invite à être artisans de paix.',
    text: "Saint François d'Assise a vécu il y a environ 800 ans. Il aimait profondément la création et les pauvres. Une prière qui porte son nom dit : « Seigneur, fais de moi un instrument de ta paix. Là où est la haine, que je mette l'amour. » Cette prière nous invite à apporter la paix autour de nous, à la maison, à l'école et dans notre communauté. Quand nous consolons un ami ou que nous pardonnons, nous vivons cette prière.",
    mustKeep: ['Francois', 'paix'],
  },
  {
    id: 'experience-5e',
    title: 'Expérience : l’eau qui monte',
    gradeCode: '5',
    gradeLabel: '5e année',
    subjectLabel: 'Sciences et technologie',
    itemType: 'worksheet',
    objective: '',
    text: "Matériel : un verre transparent, de l'eau colorée, une branche de céleri.\n\nÉtapes :\n1. Verse de l'eau colorée dans le verre jusqu'à la moitié.\n2. Place la branche de céleri dans l'eau.\n3. Prédis ce qui va arriver après 24 heures et écris ta prédiction.\n4. Observe la branche le lendemain. Coupe-la avec l'aide d'un adulte et observe l'intérieur.\n5. Explique ce que tu vois en utilisant les mots « tige », « capillarité » et « transport de l'eau ».",
    mustKeep: ['celeri', 'prediction'],
  },
  {
    id: 'recit-noms-3e',
    title: 'La journée à la ferme',
    gradeCode: '3',
    gradeLabel: '3e année',
    subjectLabel: 'Français',
    itemType: 'reading_passage',
    objective: '',
    text: "Mardi, la classe de Mme Gauthier visite une ferme laitière près de Casselman. Rosalie donne du foin aux vaches pendant que Youssef pose des questions au fermier. Le fermier explique que les vaches mangent beaucoup d'herbe et boivent jusqu'à 100 litres d'eau par jour. Avant de partir, les élèves goûtent du fromage en grains. Rosalie trouve qu'il fait « couic-couic » sous les dents !",
    mustKeep: ['ferme', 'vache'],
    people: [
      { name: 'Rosalie', kind: 'student' },
      { name: 'Youssef', kind: 'student' },
      { name: 'Josée Gauthier', kind: 'staff' },
    ],
  },
  {
    id: 'probleme-7e',
    title: 'Le budget du voyage de fin d’année',
    gradeCode: '7',
    gradeLabel: '7e année',
    subjectLabel: 'Mathématiques',
    itemType: 'worksheet',
    objective: 'Résoudre des problèmes à plusieurs étapes avec des pourcentages et des taux.',
    text: "La classe prépare un voyage à Ottawa. L'autobus coûte 850 $ pour la journée. L'entrée au musée coûte 12 $ par élève, mais le musée offre un rabais de 15 % aux groupes de 25 élèves ou plus. La classe compte 28 élèves.\n\na) Calcule le coût total de l'entrée au musée avec le rabais.\nb) Calcule le coût total du voyage.\nc) Combien chaque élève doit-il payer si le coût est partagé également ? Arrondis au cent près.\nd) La classe a déjà amassé 600 $ grâce à une vente de pâtisseries. Quel pourcentage du coût total cela représente-t-il ?",
    mustKeep: ['850', '15', '28'],
  },
  {
    id: 'poeme-1re',
    title: 'La neige',
    gradeCode: '1',
    gradeLabel: '1re année',
    subjectLabel: 'Français',
    itemType: 'reading_passage',
    objective: 'Repérer les rimes dans un court poème.',
    text: "Tombe, tombe, petite neige,\nsur le toit de ma maison.\nLe sapin a son manteau beige,\net le chat fait des bonds.\n\nTombe, tombe, neige blanche,\nsur mon nez et sur mes mains.\nJe fais un bonhomme dimanche,\nil sera là jusqu'à demain.",
    mustKeep: ['neige'],
  },
  {
    id: 'eau-8e',
    title: 'L’eau potable dans les communautés des Premières Nations',
    gradeCode: '8',
    gradeLabel: '8e année',
    subjectLabel: 'Histoire et géographie',
    itemType: 'reading_passage',
    objective: '',
    text: "Au Canada, pays qui possède une grande partie de l'eau douce de la planète, certaines communautés des Premières Nations vivent depuis des années sous des avis concernant la qualité de l'eau potable. Ces avis obligent les familles à faire bouillir l'eau ou à utiliser de l'eau embouteillée. Les causes sont multiples : infrastructures vieillissantes, financement insuffisant, éloignement et manque de personnel formé. Des progrès ont été réalisés ces dernières années, mais plusieurs leaders autochtones rappellent que l'accès à une eau propre est un droit fondamental et que les solutions doivent respecter l'autodétermination des communautés.",
    mustKeep: ['eau potable', 'Premieres Nations'],
  },
];
