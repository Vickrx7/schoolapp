import { describe, expect, it } from 'vitest';
import {
  breakSteps,
  dutySteps,
  endOfDayChecklist,
  eventSteps,
  fallbackSteps,
  handoverSteps,
  lessonSteps,
  prepSteps,
  routineSteps,
} from './scripts';

const texts = (steps: { text: string }[]) => steps.map((s) => s.text);
const minutes = (steps: { minutes: number | null }[]) =>
  steps.reduce((sum, s) => sum + (s.minutes ?? 0), 0);

const lesson = {
  title: 'Trouver l’idée principale',
  objectives: 'Repérer l’idée principale d’un paragraphe.',
  content: 'Modéliser avec le premier paragraphe, puis travail en dyades.',
  subNotes: 'Version illustrée du texte dans le bac vert.',
};

describe('step templates', () => {
  it('recognizes arrival and dismissal routines from their titles, in the class’s order', () => {
    const profile = { arrivalNotes: 'Porte 3.', routinesNotes: null, dismissalNotes: null };
    expect(
      texts(
        routineSteps(
          { title: 'Entrée, prière du matin et O Canada', start: '08:45', end: '08:55' },
          profile,
        ),
      ),
    ).toEqual([
      'Accueillez les élèves à la porte de la classe.',
      'Prenez les présences et signalez les absences au secrétariat.',
      'Voir « À l’arrivée » dans les notes de la classe.',
      'Récitez la prière avec les élèves (un·e élève peut la diriger).',
      'Les élèves se lèvent pour l’O Canada.',
    ]);
    expect(
      texts(
        routineSteps({ title: 'Rangement, prière et départ', start: '15:15', end: '15:20' }, null),
      ),
    ).toEqual([
      'Faites ranger le matériel et remettre les chaises en place.',
      'Récitez la prière avec les élèves (un·e élève peut la diriger).',
      'Accompagnez les élèves à la sortie selon la routine de l’école.',
    ]);
    expect(
      texts(routineSteps({ title: 'Calendrier', start: '09:00', end: '09:05' }, null)),
    ).toEqual(['Calendrier : suivez la routine habituelle de la classe.']);
  });

  it('fits a lesson to the minutes left and quotes the teacher’s note', () => {
    const normal = lessonSteps(lesson, 50, 'normal');
    expect(minutes(normal)).toBe(50);
    expect(texts(normal)).toContain(
      'Note de l’enseignant·e : Version illustrée du texte dans le bac vert.',
    );
    const shortened = lessonSteps(lesson, 30, 'shortened');
    expect(minutes(shortened)).toBe(30);
    expect(shortened[0]!.text).toBe(
      'Période écourtée : il reste 30 minutes. Gardez l’essentiel de la leçon.',
    );
    expect(texts(lessonSteps(lesson, 3, 'interrupted'))).toEqual([
      'Période interrompue : il reste environ 3 minutes pour la leçon.',
      'Note de l’enseignant·e : Version illustrée du texte dans le bac vert.',
      'Déroulement : Modéliser avec le premier paragraphe, puis travail en dyades.',
    ]);
    const long = lessonSteps({ ...lesson, content: 'x'.repeat(701) }, 50, 'normal');
    expect(texts(long).join(' ')).toContain('voir « Contenu de la leçon »');
    expect(texts(long).join(' ')).not.toContain('xxx');
  });

  it('describes events, handovers, duty, prep and breaks', () => {
    expect(
      texts(
        eventSteps(
          { title: 'Messe', notes: 'Au gymnase.', start: '09:45', end: '10:35' },
          'replaced',
        ),
      ),
    ).toEqual([
      'Messe de 9 h 45 à 10 h 35 : accompagnez les élèves et restez avec le groupe.',
      'Au gymnase.',
      'Au retour, reprenez l’horaire de la classe.',
    ]);
    expect(
      texts(
        handoverSteps({
          subject: 'Anglais',
          otherAdult: 'M. Leblanc',
          roomName: 'Local 104',
          classRoomName: 'Local 104',
          start: '11:15',
          end: '12:05',
        }),
      )[0],
    ).toBe('M. Leblanc prend le groupe en classe de 11 h 15 à 12 h 05 pour Anglais.');
    expect(
      texts(
        handoverSteps({
          subject: 'Musique',
          otherAdult: null,
          roomName: null,
          classRoomName: 'Local 101',
          start: '13:35',
          end: '14:25',
        }),
      )[0],
    ).toBe(
      'Une autre personne de l’équipe-école prend le groupe en classe de 13 h 35 à 14 h 25 pour Musique.',
    );
    expect(texts(dutySteps({ title: 'Surveillance', start: '12:05', end: '12:25' }))[0]).toBe(
      'Surveillance de 12 h 05 à 12 h 25.',
    );
    expect(texts(dutySteps({ title: 'Cour arrière', start: '12:05', end: '12:25' }))[0]).toBe(
      'Surveillance de 12 h 05 à 12 h 25 : Cour arrière.',
    );
    expect(texts(prepSteps({ title: 'Planification', start: '14:25', end: '15:15' }))[0]).toBe(
      'Période de planification de 14 h 25 à 15 h 15 : pas d’élèves.',
    );
    expect(
      texts(
        breakSteps({ title: 'Pause santé', kind: 'nutrition_break', start: '10:35', end: '11:15' }),
      )[0],
    ).toContain('Pause santé (40 minutes)');
  });

  it('falls back to the class’s activities, else to a default', () => {
    expect(texts(fallbackSteps({ fallbackActivities: 'Lecture libre (bac jaune).' }))[1]).toBe(
      'Activités de rechange prévues par l’enseignant·e : Lecture libre (bac jaune).',
    );
    expect(texts(fallbackSteps(null))[1]).toContain('lecture libre');
  });

  it('ends a morning at the hand-off and a full day at dismissal', () => {
    expect(endOfDayChecklist(null, 'am')[0]).toBe('Laissez la classe en ordre pour l’après-midi.');
    expect(endOfDayChecklist({ dismissalNotes: 'Autobus 12 à 15 h 15.' }, 'full_day')).toContain(
      'Suivez les consignes de départ de la classe (voir « Fin de journée »).',
    );
    expect(endOfDayChecklist(null, 'pm').every((i) => i.length <= 300)).toBe(true);
  });
});
