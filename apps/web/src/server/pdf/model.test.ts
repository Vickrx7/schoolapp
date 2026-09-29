import { composeSubPlan, type SubPlanAudience } from '@lynx/domain';
import { describe, expect, it } from 'vitest';
import { buildPlanPdfModel, planPdfFileName, type PdfPart, type PlanPdfModel } from './model';
import {
  BLOCK,
  CLASS_5,
  CLASS_MANAGEMENT,
  composed,
  CONTEXT,
  EDITS,
  EN_LABELS,
  FR_LABELS,
  FRENCH_TYPOGRAPHY,
  LESSON_4,
  LEVELS,
  pdfPlan,
  ROSTER,
} from './test-fixtures';

const model = (labels = FR_LABELS, plan = composed('pdf')) =>
  buildPlanPdfModel(plan, CONTEXT, ROSTER, LEVELS, labels);
const section = (m: PlanPdfModel, id: string) => m.sections.find((s) => s.id === id);
const block = (m: PlanPdfModel, key: string) =>
  section(m, 'schedule')!.blocks.find((b) => b.key === key)!;
const texts = (parts: PdfPart[] | undefined) =>
  (parts ?? []).map((p) =>
    p.kind === 'text'
      ? [p.label, p.text]
      : p.kind === 'list'
        ? [p.label, ...p.items]
        : p.kind === 'group'
          ? [p.title, p.meta, p.names]
          : [p.text],
  );

describe('buildPlanPdfModel', () => {
  it('never prints « Gestion de classe », even though the plan has it', () => {
    const owner = composed('owner');
    expect(owner.classNotes[0]!.classManagement).toBe(CLASS_MANAGEMENT);
    const json = JSON.stringify(model());
    expect(json).not.toContain('Signal de silence');
    expect(json).not.toContain('Gestion de classe');
    // The class's other notes are printed.
    expect(texts(section(model(), 'classNotes')?.parts)).toEqual([
      ['À l’arrivée', 'Les élèves accrochent leur sac et s’assoient en silence.'],
      ['Routines', 'Calendrier et météo après la prière.'],
      ['Fin de journée', 'Les autobus partent à 15 h 20 par la porte est.'],
      ['Activités de rechange', 'Lecture libre au coin lecture.'],
    ]);
  });

  it.each<SubPlanAudience>(['owner', 'staff', 'office', 'substitute'])(
    'refuses a plan composed for the %s audience',
    (audience) => {
      expect(() => model(FR_LABELS, composed(audience))).toThrow(/pdf audience/);
    },
  );

  it('prints alerts as the fixed sentence only: there is no alert text to print', () => {
    const m = model();
    expect(m.alertsNotice).toBe(
      'Alertes de sécurité ou médicales : consultez l’application ou la direction.',
    );
    // Nothing else in the document speaks of alerts.
    expect(JSON.stringify(m).match(/[Aa]lerte/g)).toHaveLength(1);
    // The builder has no way to receive alerts: plan, context, roster, levels and labels.
    expect(buildPlanPdfModel.length).toBe(5);
  });

  it('prints the groups with first names, their level and size', () => {
    const groups = section(model(), 'groups')!;
    expect(groups.title).toBe('Groupes');
    expect(groups.parts).toEqual([
      {
        kind: 'text',
        label: null,
        text: 'Les niveaux servent à adapter les consignes. Ne les nommez pas devant les élèves.',
      },
      {
        kind: 'group',
        title: 'Débutant',
        meta: 'G1 · 3 élèves',
        names: 'Samuel, Adam, Aïcha',
        description: 'Comprend des consignes courtes, avec des images.',
      },
      {
        kind: 'group',
        title: 'Avancé',
        meta: 'G2 · 2 élèves',
        names: 'Liam, Emma',
        description: null,
      },
    ]);
  });

  it('prints each block with its lesson and the teacher’s steps', () => {
    const m = model();
    expect(section(model(), 'schedule')!.blocks.map((b) => [b.time, b.title])).toEqual([
      ['8 h 45 – 8 h 55', 'Entrée, prière du matin et O Canada'],
      ['8 h 55 – 9 h 45', 'Français'],
      ['9 h 45 – 10 h 35', 'Mathématiques'],
      ['13 h 35 – 14 h 25', 'EPS avec M. Leblanc'],
      ['15 h 15 – 15 h 20', 'Départ'],
    ]);
    const french = block(m, BLOCK.french);
    expect(french.tags).toEqual(['Local 101']);
    expect(french.lesson).toEqual({
      heading: 'Leçon 4 · Lire pour s’informer : les animaux de l’Ontario',
      title: 'Trouver l’idée principale',
      gap: null,
    });
    expect(french.steps).toEqual([
      { minutes: '10 min', text: FRENCH_TYPOGRAPHY, say: null },
      { minutes: '30 min', text: 'Travail en dyades : surlignez l’idée principale.', say: null },
    ]);
    expect(texts(french.details)).toEqual([
      ['Intention d’apprentissage', 'Je peux trouver l’idée principale d’un paragraphe.'],
      // Windows line breaks are made plain.
      ['Matériel et où le trouver', 'Texte « Le huard »\nSurligneurs (bac vert)'],
      [
        'Note de la leçon',
        'Les élèves du groupe débutant ont une version illustrée du texte (bac vert).',
      ],
      ['Contenu de la leçon', 'Lecture guidée, puis travail en dyades.'],
      ['Note de l’horaire', 'Les textes sont sur le bureau.'],
    ]);
    expect(texts(french.extras)).toEqual([
      ['Consigne pour aujourd’hui', 'Les responsables de la semaine distribuent les textes.'],
    ]);
    expect(m.stepsLabel).toBe('Déroulement');
  });

  it('prints the AI layer’s parts for the adult, under the teacher’s own steps', () => {
    const ai = {
      jobId: 'job',
      refs: [{ key: 'B1', ref: { blockKey: BLOCK.french, lessonId: LESSON_4 } }],
      result: {
        dayOverview: '',
        blocks: [
          {
            key: 'B1',
            overview: 'Lecture du huard et idée principale.',
            steps: [{ minutes: 50, instruction: 'Lisez le texte.', say: '« Écoutez bien. »' }],
            differentiation: [
              { group: 'G1', instruction: 'Version illustrée du texte.' },
              { group: 'G2', instruction: 'Un paragraphe de plus.' },
            ],
            ifTimeRemains: 'Lecture libre.',
            materialsChecklist: ['Texte « Le huard »'],
            activity: {
              title: 'Mon idée principale',
              studentInstructions: 'Écris l’idée principale du texte.',
              perGroup: [{ group: 'G1', studentInstructions: 'Dessine-la.' }],
            },
          },
        ],
        faithSentence: '',
      },
    };
    const plan = composeSubPlan(pdfPlan(), { edits: EDITS, ai, audience: 'pdf' });
    const french = block(model(FR_LABELS, plan), BLOCK.french);
    // The teacher's steps win; the AI layer adds its overview, groups and activity.
    expect(french.steps[0]).toEqual({ minutes: '10 min', text: FRENCH_TYPOGRAPHY, say: null });
    expect(texts(french.details)[0]).toEqual(['En bref', 'Lecture du huard et idée principale.']);
    expect(texts(french.extras)).toEqual([
      ['Consigne pour aujourd’hui', 'Les responsables de la semaine distribuent les textes.'],
      [
        'Consignes par groupe',
        'G1 · Débutant — Version illustrée du texte.',
        'G2 · Avancé — Un paragraphe de plus.',
      ],
      ['Activité pour les élèves', 'Mon idée principale\nÉcris l’idée principale du texte.'],
      ['Matériel et où le trouver', 'Texte « Le huard »'],
      ['Si vous avez du temps', 'Lecture libre.'],
    ]);
    // Without the teacher's steps, the AI's steps and « Dites : » lines are printed.
    const aiOnly = composeSubPlan(pdfPlan(), { ai, audience: 'pdf' });
    expect(block(model(FR_LABELS, aiOnly), BLOCK.french).steps).toEqual([
      { minutes: '50 min', text: 'Lisez le texte.', say: 'Dites : « Écoutez bien. »' },
    ]);
  });

  it('prints events on their block, handovers and the day’s other events', () => {
    const m = model();
    expect(block(m, BLOCK.math)).toMatchObject({
      tags: ['Remplacé', 'Local 101'],
      event: {
        title: 'Messe de l’école · 9 h 45',
        notes: 'Au gymnase. Les élèves s’assoient par classe.',
      },
      lesson: null,
      steps: [],
    });
    expect(block(m, BLOCK.gym)).toMatchObject({
      otherAdult: 'Avec M. Leblanc',
      tags: ['Gymnase'],
    });
    expect(texts(section(m, 'events')?.parts)).toEqual([[null, 'Assemblée · 12 h 05 – 12 h 30']]);
  });

  it('prints the header, the teacher’s note, contacts, the end of the day and the faith moment', () => {
    const m = model();
    expect(m.header).toEqual({
      schoolName: 'É.É.C. Saint-Exemple',
      title: 'Plan de suppléance',
      heading: '3e année – Mme Tremblay',
      lines: [
        'Mercredi 21 octobre 2026 · Journée complète · 8 h 45 – 15 h 20',
        'Classe de Mme Tremblay · Local 101',
      ],
    });
    expect(texts(m.intro)).toEqual([
      ['Mot de l’enseignant·e', 'Merci! Les cahiers sont dans le bac bleu.'],
      ['Aperçu de la journée', 'Journée calme; les élèves connaissent la routine.'],
    ]);
    expect(texts(section(m, 'contacts')?.parts)).toEqual([
      ['Secrétariat', '555-0100'],
      ['Collègue à côté', 'M. Gagnon — Local 104, juste à côté'],
      ['Enseignant·e de matière', 'M. Leblanc'],
      ['Arrivée à l’école', 'Présentez-vous au secrétariat (local 100) à votre arrivée.'],
      [
        'Mesures d’urgence',
        'Sortie de secours : porte est. Point de rassemblement : terrain de soccer.',
      ],
    ]);
    expect(texts(section(m, 'endOfDay')?.parts)).toEqual([
      [null, 'Départ des élèves à 15 h 20'],
      [null, 'Fermez les fenêtres.', 'Laissez le suivi au secrétariat.'],
    ]);
    expect(texts(section(m, 'faith')?.parts)).toEqual([
      ['Prière pour la journée'],
      [null, 'Seigneur, guide nos pas aujourd’hui.'],
    ]);
    expect(m.sections.map((s) => s.id)).toEqual([
      'schedule',
      'events',
      'groups',
      'classNotes',
      'contacts',
      'endOfDay',
      'faith',
    ]);
    expect(m.footer.confidential).toBe(
      'Document confidentiel — à remettre au secrétariat à la fin de la journée',
    );
    expect(m.footer.page(2, 3)).toBe('Page 2 sur 3');
  });

  it('names the file and the document by date only', () => {
    const m = model();
    expect(m.fileName).toBe('plan-suppleance-2026-10-21.pdf');
    expect(planPdfFileName('2026-11-02')).toBe('plan-suppleance-2026-11-02.pdf');
    expect(m.info).toEqual({ title: 'Plan de suppléance — 2026-10-21', language: 'fr-CA' });
  });

  it('follows the reader’s language for labels; the plan stays in the teacher’s French', () => {
    const m = model(EN_LABELS);
    expect(m.header.lines[0]).toBe(
      'Wednesday, October 21, 2026 · Full day · 8:45 a.m. – 3:20 p.m.',
    );
    expect(section(m, 'schedule')!.title).toBe('Schedule');
    expect(block(m, BLOCK.french).steps[0]!.text).toBe(FRENCH_TYPOGRAPHY);
    // The document's language is the plan's: French (WCAG 3.1.2).
    expect(m.info.language).toBe('fr-CA');
    expect(m.alertsNotice).toBe('Safety or medical alerts: check the app or ask the principal.');
    // Level names in English when the board has them.
    const groups = section(m, 'groups')!.parts.filter((p) => p.kind === 'group');
    expect(groups.map((g) => (g.kind === 'group' ? g.title : ''))).toEqual([
      'Beginner',
      'Advanced',
    ]);
    expect(JSON.stringify(m)).not.toContain('Signal de silence');
  });

  it('names the class of each block and each note when the plan covers several classes', () => {
    const base = pdfPlan();
    const plan = pdfPlan({
      classes: [
        ...base.classes,
        {
          classId: CLASS_5,
          name: '5e année – M. Gagnon',
          gradeLabels: ['5e'],
          roomName: 'Local 104',
        },
      ],
      blocks: [
        base.blocks[1]!,
        {
          ...base.blocks[1]!,
          key: BLOCK.dismissal,
          classId: CLASS_5,
          className: '5e année – M. Gagnon',
          start: '09:45',
          end: '10:35',
          roomName: 'Local 104',
          lesson: null,
        },
      ],
      classNotes: [
        base.classNotes[0]!,
        {
          classId: CLASS_5,
          arrival: 'Les élèves de 5e entrent par la porte ouest.',
          routines: null,
          classManagement: 'Tableau des responsabilités (5e).',
          dismissal: null,
          fallbackActivities: null,
          neighbour: { name: 'Mme Tremblay', note: null },
          team: [],
        },
      ],
    });
    const m = buildPlanPdfModel(
      composeSubPlan(plan, { edits: EDITS, audience: 'pdf' }),
      CONTEXT,
      ROSTER,
      LEVELS,
      FR_LABELS,
    );
    expect(m.header.heading).toBe('3e année – Mme Tremblay · 5e année – M. Gagnon');
    expect(m.header.lines[1]).toBe('Classe de Mme Tremblay · Local 101 · Local 104');
    expect(block(m, BLOCK.dismissal).tags).toEqual(['5e année – M. Gagnon', 'Local 104']);
    const notes = section(m, 'classNotes')!.parts;
    expect(notes.filter((p) => p.kind === 'heading')).toEqual([
      { kind: 'heading', text: '3e année – Mme Tremblay' },
      { kind: 'heading', text: '5e année – M. Gagnon' },
    ]);
    expect(texts(section(m, 'contacts')?.parts)).toContainEqual([
      'Collègue à côté · 5e année – M. Gagnon',
      'Mme Tremblay',
    ]);
    expect(JSON.stringify(m)).not.toContain('Tableau des responsabilités');
    // The groups of the 3e are headed by their class.
    expect(section(m, 'groups')!.parts).not.toContainEqual({
      kind: 'heading',
      text: '5e année – M. Gagnon',
    });
  });

  it('leaves out empty sections and prints a plan without classes', () => {
    const m = buildPlanPdfModel(
      composeSubPlan(
        pdfPlan({
          classes: [],
          groups: [],
          blocks: [],
          dayEvents: [],
          classNotes: [],
          faith: null,
          endOfDay: { time: '15:20', checklist: [] },
        }),
        { audience: 'pdf' },
      ),
      {
        ...CONTEXT,
        officePhone: null,
        arrivalInstructions: null,
        emergencyInfo: null,
        absenceNote: null,
      },
      [],
      [],
      FR_LABELS,
    );
    expect(m.header.heading).toBe('Classe de Mme Tremblay');
    expect(m.header.lines).toEqual([
      'Mercredi 21 octobre 2026 · Journée complète · 8 h 45 – 15 h 20',
    ]);
    expect(m.intro).toEqual([]);
    expect(m.sections.map((s) => s.id)).toEqual(['endOfDay']);
  });
});
