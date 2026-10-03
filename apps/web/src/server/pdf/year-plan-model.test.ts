import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  UNITS,
  YEAR_PLAN_EN as EN,
  YEAR_PLAN_FR as FR,
  yearPlanInput as input,
} from './year-plan-fixtures';
import { buildYearPlanPdfModel } from './year-plan-model';

describe('buildYearPlanPdfModel', () => {
  it('lays the year out by month: calendar, report dates, seasons and subjects', () => {
    const model = buildYearPlanPdfModel(input(), FR);
    expect(model.glance.months.map((m) => m.label)).toEqual([
      'Septembre',
      'Octobre',
      'Novembre',
      'Décembre',
      'Janvier',
      'Février',
      'Mars',
      'Avril',
      'Mai',
      'Juin',
    ]);
    // September: 21 school days from Wednesday the 2nd (Labour Day is before the year).
    expect(model.glance.months[0]!.days).toBe('21 jours de classe');
    expect(model.glance.rows.map((r) => [r.kind, r.label])).toEqual([
      ['calendar', 'Calendrier'],
      ['reports', 'Bulletins'],
      ['seasons', 'Temps liturgique'],
      ['subject', 'Français'],
      ['subject', 'Mathématiques'],
      // A subject with timetable blocks and no units keeps its row.
      ['subject', 'Arts'],
    ]);
    const october = (kind: string, label?: string) =>
      model.glance.rows.find((r) => r.kind === kind && (!label || r.label === label))!.cells[1]!;
    // Days off and masses, never other events.
    expect(october('calendar').map((i) => i.text)).toEqual([
      'Journée pédagogique (9\u00a0oct.)',
      'Action de grâce (12\u00a0oct.)',
      'Messe de l’Action de grâce (8\u00a0oct.)',
    ]);
    expect(october('reports').map((i) => i.text)).toEqual(['Progrès\u00a0: fin 30\u00a0oct.']);
    expect(model.glance.rows[2]!.cells[3]!.map((i) => i.text)).toEqual([
      'Avent · 29\u00a0nov.–24\u00a0déc.',
      'Temps de Noël · 25\u00a0déc.–10\u00a0janv.',
    ]);
    // A unit is in every month it touches, with its dates; « 1er » for the first of a month.
    expect(october('subject', 'Mathématiques')).toEqual([
      { text: 'Les nombres jusqu’à 1 000', detail: '14\u00a0sept.–9\u00a0oct.' },
      { text: 'L’addition et la soustraction', detail: '13\u00a0oct.–6\u00a0nov.' },
    ]);
    expect(october('subject', 'Français')).toEqual([
      { text: 'Lire pour s’informer', detail: '1er\u00a0oct.–2\u00a0oct. †' },
    ]);
    expect(model.glance.legend).toBe(
      '† Dates d’après les leçons données, pas encore enregistrées.',
    );
  });

  it('lists a unit dated outside the school year under « Hors de l’année scolaire » (post-MVP review)', () => {
    const summer = UNITS.find((u) => u.id === 'addition')!;
    const model = buildYearPlanPdfModel(
      input({
        units: [
          ...UNITS,
          {
            ...summer,
            id: 'summer',
            title: 'Projet d’été',
            plannedStartOn: '2027-07-05',
            plannedEndOn: '2027-07-16',
          },
        ],
      }),
      FR,
    );
    const math = model.bySubject.sections.find((s) => s.subject === 'Mathématiques')!;
    expect(math.units.map((u) => u.title)).not.toContain('Projet d’été');
    expect(math.outsideYear).toEqual({
      title: 'Hors de l’année scolaire',
      units: [
        expect.objectContaining({
          title: 'Projet d’été',
          when: 'Du 5 juillet au 16 juillet',
          length: 'Dates hors de l’année scolaire : à replanifier',
        }),
      ],
    });
    // Without one, no such part.
    expect(
      buildYearPlanPdfModel(input(), FR).bySubject.sections.every((s) => s.outsideYear === null),
    ).toBe(true);
  });

  it('lists the units by subject with their weeks, school days and attentes', () => {
    const model = buildYearPlanPdfModel(input(), FR);
    expect(model.bySubject.sections.map((s) => s.subject)).toEqual(['Français', 'Mathématiques']);
    const [read] = model.bySubject.sections[0]!.units;
    expect(read).toMatchObject({
      title: 'Lire pour s’informer',
      when: 'Du 1er\u00a0octobre au 2\u00a0octobre',
      length: '1 semaine · 2 jours de classe',
      inferred: 'Dates d’après les leçons données',
      expectations: [],
    });
    const math = model.bySubject.sections[1]!;
    expect(math.units.map((u) => [u.title, u.when, u.length])).toEqual([
      // Thanksgiving week: the PA day and the holiday are not school days.
      [
        'Les nombres jusqu’à 1 000',
        'Du 14\u00a0septembre au 9\u00a0octobre',
        '4 semaines · 19 jours de classe',
      ],
      [
        'L’addition et la soustraction',
        'Du 13\u00a0octobre au 6\u00a0novembre',
        '4 semaines · 19 jours de classe',
      ],
    ]);
    expect(math.units[0]!.expectations).toEqual([
      {
        code: 'B1.1',
        text: 'Lire et représenter les nombres naturels jusqu’à 1 000.',
        toVerify: 'à vérifier',
      },
      { code: 'B1.2', text: 'Comparer et ordonner des nombres.', toVerify: 'à vérifier' },
    ]);
    expect(math.unplaced).toBe('Unités sans dates\u00a0: Les fractions');
    expect(model.bySubject.expectationsLabel).toBe('Attentes visées');
    // A summary « à vérifier » is printed: the footer says so.
    expect(model.footer.note).toBe('Les attentes «\u00a0à vérifier\u00a0» sont des résumés.');
  });

  it('names the class, the year, the team and the day, and an ASCII file name', () => {
    const model = buildYearPlanPdfModel(input(), FR);
    expect(model.header).toEqual({
      school: 'École Sainte-Marie',
      title: 'Plan à long terme',
      subtitle: '3e année · Année scolaire 2026-2027',
      lines: [
        'Équipe de la classe\u00a0: Mme Isabelle Tremblay (titulaire)',
        'Imprimé le 2\u00a0octobre\u00a02026',
      ],
    });
    expect(model.info).toEqual({
      title: 'Plan à long terme — 3e année — 2026-2027',
      language: 'fr-CA',
    });
    expect(model.fileName).toBe('plan-a-long-terme-3e-annee-2026-2027.pdf');
    expect(model.footer.page(1, 3)).toBe('Page 1 sur 3');
  });

  it('prints coverage only when asked', () => {
    expect(buildYearPlanPdfModel(input(), FR).coverage).toBeNull();
    const model = buildYearPlanPdfModel(
      input({
        coverage: {
          rows: [
            {
              label: 'Mathématiques',
              counts: { total: 34, taught: 3, planned: 5, taughtEarlier: 0, notPlanned: 26 },
            },
          ],
          unverified: true,
        },
      }),
      FR,
    );
    expect(model.coverage).toEqual({
      title: 'Couverture des attentes',
      // The paper says what the screen says: a partial list, to check (post-MVP review).
      intro:
        'Au 2\u00a0octobre\u00a02026, pour toute l’année\u00a0: ce que les unités et les leçons de la classe ont prévu et enseigné, par matière. Seules les attentes chargées dans l’application sont comptées\u00a0: une liste résumée, à vérifier, qui peut être incomplète.',
      columns: ['Matière', 'Attentes', 'Enseignées', 'Prévues', 'Pas encore prévues'],
      rows: [{ key: '0', label: 'Mathématiques', values: ['34', '3', '5', '26'] }],
      notes: [expect.stringMatching(/^Mode de calcul\u00a0: une attente est enseignée/)],
    });
    const none = buildYearPlanPdfModel(input({ coverage: { rows: [], unverified: false } }), FR);
    expect(none.coverage?.notes).toEqual([
      'Aucune attente n’est chargée pour les années d’études de cette classe.',
    ]);
  });

  it('leaves the « à vérifier » note out when every printed attente is verified', () => {
    const verified = UNITS.map((u) => ({
      ...u,
      expectations: u.expectations.map((e) => ({ ...e, verified: true })),
    }));
    const model = buildYearPlanPdfModel(input({ units: verified }), FR);
    expect(model.footer.note).toBeNull();
    expect(model.bySubject.sections[1]!.units[0]!.expectations[0]!.toVerify).toBeNull();
  });

  it('labels the document in the reader’s language; the plan’s words stay as typed', () => {
    const model = buildYearPlanPdfModel(input(), EN);
    expect(model.header.title).toBe('Long-range plan');
    expect(model.glance.months[0]).toMatchObject({ label: 'September', days: '21 school days' });
    expect(model.bySubject.sections[1]!.units[0]!.when).toBe(
      'From September\u00a014 to October\u00a09',
    );
    expect(model.bySubject.sections[1]!.units[0]!.title).toBe('Les nombres jusqu’à 1 000');
    expect(model.fileName).toBe('long-range-plan-3e-annee-2026-2027.pdf');
    expect(model.info.language).toBe('en-CA');
  });

  it('prints no student data: a unit’s description never reaches it', () => {
    const withNotes = UNITS.map((u) => ({
      ...u,
      // The year view's units carry the description; paper never prints it.
      description: 'Léa Tremblay a besoin d’aide pour la lecture.',
    }));
    const model = buildYearPlanPdfModel(input({ units: withNotes }), FR);
    expect(JSON.stringify(model)).not.toContain('Léa');
  });

  it('is loaded without reading students (the route and its query)', () => {
    for (const file of [
      '../queries/year-plan-pdf.ts',
      '../queries/year-plan.ts',
      '../queries/class-coverage.ts',
      '../../app/(app)/classes/[classId]/planning/year/pdf/route.ts',
    ]) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source, file).not.toMatch(/from\('(students|student_alerts|class_sub_profiles)'/);
      expect(source, file).not.toMatch(/\b(students|student_alerts)\s*\(/);
    }
  });

  it('says so when there is no unit', () => {
    const model = buildYearPlanPdfModel(input({ units: [] }), FR);
    expect(model.bySubject.sections).toEqual([]);
    expect(model.bySubject.empty).toBe('Aucune unité pour l’instant.');
    expect(model.glance.legend).toBeNull();
    expect(model.footer.note).toBeNull();
  });
});
