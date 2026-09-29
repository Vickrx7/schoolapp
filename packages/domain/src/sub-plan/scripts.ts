/**
 * Template steps of a substitute plan, written for an adult who has never met the class
 * (SPEC 9.4.4). Plan content is always in French, whatever the interface language: it is
 * teaching material, like the lessons it quotes. Teacher-written text is quoted as typed.
 */
import { formatTimeFr, timeToMinutes, type LocalTime } from '../dates';
import type { BlockKind } from '../school-day';
import type { AbsencePart, SubPlanStep } from './schema';
import type { SubPlanSourceLesson, SubPlanSourceProfile } from './sources';
import { clip, foldForMatch } from './text';

const MAX_STEPS = 12;

function step(text: string, minutes: number | null = null): SubPlanStep {
  return {
    minutes: minutes === null ? null : Math.min(240, Math.max(1, Math.round(minutes))),
    text: clip(text, 1000),
  };
}

function steps(list: (SubPlanStep | null | false | undefined | '')[]): SubPlanStep[] {
  return list.filter((s): s is SubPlanStep => !!s).slice(0, MAX_STEPS);
}

function span(start: LocalTime, end: LocalTime): string {
  return `de ${formatTimeFr(start)} à ${formatTimeFr(end)}`;
}

function minutesOf(start: LocalTime, end: LocalTime): number {
  return Math.max(0, timeToMinutes(end) - timeToMinutes(start));
}

type TimedBlock = { title: string; start: LocalTime; end: LocalTime };

/** Entry, prayer, anthem, dismissal... recognized from the block's title. */
export function routineSteps(
  block: TimedBlock,
  profile: Pick<SubPlanSourceProfile, 'arrivalNotes' | 'routinesNotes' | 'dismissalNotes'> | null,
): SubPlanStep[] {
  const t = foldForMatch(block.title);
  const arrival = /entree|accueil|arrivee/.test(t);
  const prayer = /priere/.test(t);
  const anthem = /o canada|hymne/.test(t);
  const announcements = /annonce/.test(t);
  const dismissal = /depart|sortie|fin de (la )?journee|rangement/.test(t);
  const known = arrival || prayer || anthem || announcements || dismissal;
  // In the order a class does them: arrive, announcements, tidy up, pray, anthem, leave.
  return steps([
    arrival && step('Accueillez les élèves à la porte de la classe.'),
    arrival && step('Prenez les présences et signalez les absences au secrétariat.'),
    arrival && !!profile?.arrivalNotes && step('Voir « À l’arrivée » dans les notes de la classe.'),
    announcements && step('Écoutez les annonces avec les élèves.'),
    dismissal && step('Faites ranger le matériel et remettre les chaises en place.'),
    prayer && step('Récitez la prière avec les élèves (un·e élève peut la diriger).'),
    anthem && step('Les élèves se lèvent pour l’O Canada.'),
    dismissal &&
      step(
        profile?.dismissalNotes
          ? 'Suivez les consignes de départ de la classe (voir « Fin de journée »).'
          : 'Accompagnez les élèves à la sortie selon la routine de l’école.',
      ),
    !known && step(`${block.title} : suivez la routine habituelle de la classe.`),
    !known && !!profile?.routinesNotes && step('Voir « Routines » dans les notes de la classe.'),
  ]);
}

/** Nutrition breaks, recess and lunch. */
export function breakSteps(block: TimedBlock & { kind: BlockKind }): SubPlanStep[] {
  const minutes = minutesOf(block.start, block.end);
  const supervision = step(
    'Vérifiez au secrétariat si vous êtes de surveillance pendant cette période.',
  );
  if (block.kind === 'recess') {
    return steps([
      step(`Récréation ${span(block.start, block.end)} : les élèves sortent à la cloche.`),
      supervision,
    ]);
  }
  return steps([
    step(
      block.kind === 'lunch'
        ? `Dîner ${span(block.start, block.end)} : les élèves mangent à leur place, puis vont à la récréation selon l’horaire de l’école.`
        : `Pause santé (${minutes} minutes) : les élèves mangent à leur place, puis vont à la récréation selon l’horaire de l’école.`,
    ),
    step('Rappelez aux élèves de ranger leur boîte à lunch et de jeter leurs déchets.'),
    supervision,
  ]);
}

/** A lesson with no objectives, no materials and almost no content. */
export function isThinLesson(
  lesson: Pick<SubPlanSourceLesson, 'objectives' | 'materials' | 'content'>,
): boolean {
  return (
    !lesson.objectives?.trim() &&
    !lesson.materials?.trim() &&
    (lesson.content?.trim().length ?? 0) < 80
  );
}

/**
 * A lesson from the teacher's planning, fitted to the minutes left in the block. Steps quote
 * the objective, the teacher's note for the substitute and the content as written.
 */
export function lessonSteps(
  lesson: Pick<SubPlanSourceLesson, 'title' | 'objectives' | 'content' | 'subNotes'>,
  minutes: number,
  status: 'normal' | 'shortened' | 'interrupted',
): SubPlanStep[] {
  const total = Math.max(1, Math.round(minutes));
  const framing = total >= 5;
  const intro = framing ? Math.max(1, Math.round(total * 0.1)) : 0;
  const closing = framing ? Math.max(1, Math.round(total * 0.1)) : 0;
  const main = Math.max(1, total - intro - closing);
  const objectives = lesson.objectives?.trim();
  const content = lesson.content?.trim();
  const subNotes = lesson.subNotes?.trim();

  return steps([
    status === 'shortened' &&
      step(`Période écourtée : il reste ${total} minutes. Gardez l’essentiel de la leçon.`),
    status === 'interrupted' &&
      step(`Période interrompue : il reste environ ${total} minutes pour la leçon.`),
    framing &&
      step(
        objectives
          ? `Présentez l’objectif : ${objectives}`
          : `Présentez la leçon « ${lesson.title} ».`,
        intro,
      ),
    subNotes && step(`Note de l’enseignant·e : ${subNotes}`),
    step(
      content
        ? content.length <= 700
          ? `Déroulement : ${content}`
          : 'Suivez le déroulement détaillé de la leçon (voir « Contenu de la leçon »).'
        : `Faites la leçon « ${lesson.title} » avec le matériel prévu; au besoin, utilisez les activités de rechange.`,
      main,
    ),
    framing &&
      step('Retour en grand groupe : demandez à quelques élèves ce qu’ils ont appris.', closing),
  ]);
}

/** A lesson the teacher already checked off for this date. */
export function reviewSteps(
  lesson: Pick<SubPlanSourceLesson, 'title'>,
  profile: Pick<SubPlanSourceProfile, 'fallbackActivities'> | null,
): SubPlanStep[] {
  return steps([
    step(`L’enseignant·e a déjà coché la leçon « ${lesson.title} » pour cette journée.`),
    step('Faites un court retour sur cette leçon avec les élèves.'),
    ...fallbackSteps(profile).slice(1),
  ]);
}

/** A mass, an assembly... that takes the whole block ('replaced') or part of it. */
export function eventSteps(
  event: { title: string; notes: string | null; start: LocalTime | null; end: LocalTime | null },
  status: 'replaced' | 'interrupted',
): SubPlanStep[] {
  const when =
    event.start && event.end
      ? ` ${span(event.start, event.end)}`
      : event.start
        ? ` à ${formatTimeFr(event.start)}`
        : '';
  const notes = event.notes?.trim();
  return steps([
    step(
      status === 'replaced'
        ? `${event.title}${when} : accompagnez les élèves et restez avec le groupe.`
        : `${event.title}${when} : accompagnez les élèves, puis reprenez la période au retour.`,
    ),
    notes && step(notes),
    status === 'replaced' && step('Au retour, reprenez l’horaire de la classe.'),
  ]);
}

/**
 * A homeroom block another adult teaches, e.g. « Éducation physique et santé avec M. Leblanc
 * (Gymnase) : accompagnez les élèves à 13 h 35 et revenez les chercher à 14 h 25. »
 */
export function handoverSteps(block: {
  subject: string;
  otherAdult: string | null;
  roomName: string | null;
  classRoomName: string | null;
  start: LocalTime;
  end: LocalTime;
}): SubPlanStep[] {
  const adult = block.otherAdult ?? 'une autre personne de l’équipe-école';
  if (block.roomName && block.roomName !== block.classRoomName) {
    return steps([
      step(
        `${block.subject} avec ${adult} (${block.roomName}) : accompagnez les élèves à ${formatTimeFr(block.start)} et revenez les chercher à ${formatTimeFr(block.end)}.`,
      ),
    ]);
  }
  return steps([
    step(
      `${adult.charAt(0).toUpperCase()}${adult.slice(1)} prend le groupe en classe ${span(block.start, block.end)} pour ${block.subject}.`,
    ),
    step(
      'Restez joignable : le secrétariat pourrait vous confier une tâche pendant cette période.',
    ),
  ]);
}

/** Supervision duty assigned to the absent teacher. */
export function dutySteps(block: TimedBlock): SubPlanStep[] {
  const detail = foldForMatch(block.title).trim() === 'surveillance' ? '' : ` : ${block.title}`;
  return steps([
    step(`Surveillance ${span(block.start, block.end)}${detail}.`),
    step('Le secrétariat vous indiquera l’endroit si ce n’est pas précisé.'),
  ]);
}

/** The absent teacher's planning time: no students. */
export function prepSteps(block: TimedBlock): SubPlanStep[] {
  return steps([
    step(`Période de planification ${span(block.start, block.end)} : pas d’élèves.`),
    step('Passez au secrétariat au début de la période : on pourrait vous confier une tâche.'),
  ]);
}

/** Any other block kind. */
export function otherSteps(block: TimedBlock): SubPlanStep[] {
  return steps([
    step(
      `${block.title} ${span(block.start, block.end)} : suivez l’horaire habituel de la classe.`,
    ),
    step('En cas de doute, communiquez avec le secrétariat.'),
  ]);
}

/** A subject block without a lesson: the teacher's « Activités de rechange », or a default. */
export function fallbackSteps(
  profile: Pick<SubPlanSourceProfile, 'fallbackActivities'> | null,
): SubPlanStep[] {
  const fallback = profile?.fallbackActivities?.trim();
  return steps([
    step('Aucune leçon n’est prévue pour cette période.'),
    fallback
      ? step(`Activités de rechange prévues par l’enseignant·e : ${fallback}`)
      : step(
          'Proposez de la lecture libre (bibliothèque de classe), puis un court texte dans le journal d’écriture.',
        ),
  ]);
}

/** What to do before leaving: at dismissal, or at the split for a morning absence. */
export function endOfDayChecklist(
  profile: Pick<SubPlanSourceProfile, 'dismissalNotes'> | null,
  part: AbsencePart,
): string[] {
  const items =
    part === 'am'
      ? [
          'Laissez la classe en ordre pour l’après-midi.',
          'Remplissez le « Suivi de la journée » pour l’enseignant·e avant de partir.',
          'Remettez au secrétariat les documents imprimés (plan, feuille d’accueil).',
        ]
      : [
          'Faites ranger le matériel et remettre les chaises en place.',
          'Vérifiez que chaque élève a ses effets (sac, boîte à lunch, agenda).',
          profile?.dismissalNotes?.trim()
            ? 'Suivez les consignes de départ de la classe (voir « Fin de journée »).'
            : 'Accompagnez les élèves à la sortie selon la routine de l’école.',
          'Remplissez le « Suivi de la journée » pour l’enseignant·e.',
          'Remettez au secrétariat les documents imprimés (plan, feuille d’accueil).',
        ];
  return items.map((i) => clip(i, 300)).slice(0, MAX_STEPS);
}
