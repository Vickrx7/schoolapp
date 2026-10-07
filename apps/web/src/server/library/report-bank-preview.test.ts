import { loadPrompt, prepareCall, type KnownPerson } from '@lynx/ai';
import {
  reportCommentBankFeature,
  reportCommentBankInputSchema,
  type ReportCommentBankInput,
} from '@lynx/ai/features/report-comment-bank';
import { describe, expect, it } from 'vitest';
import { buildReportBankPreview } from './report-bank-preview';

const NOW = new Date('2026-10-08T12:00:00Z');

const people: KnownPerson[] = [
  { name: 'Samuel', kind: 'student' },
  { name: 'Isabelle Tremblay', kind: 'staff' },
];

/** As `report_comment_bank_ai_preview` returns it. */
const request = (teacherNote: string): ReportCommentBankInput =>
  reportCommentBankInputSchema.parse({
    itemType: 'report_comments',
    scope: 'subject',
    period: 'term',
    length: 'medium',
    gradeCodes: ['3'],
    gradeLabels: ['3e année'],
    subjectId: 'ece67150-44d3-4e6e-b772-d9bde2165caf',
    subjectLabel: 'Mathématiques',
    expectations: [],
    teacherNote,
  });

describe('« Vérifier avant d’envoyer » for « Créer une banque avec l’IA » (D-132)', () => {
  it('blocks a note with a title before a name the app does not know (UX review 1)', () => {
    const preview = buildReportBankPreview(
      request(
        'Ton chaleureux. Nous utilisons les blocs de base dix. Merci à Mme Dupuis et à Samuel pour leur aide.',
      ),
      people,
      NOW,
    );
    expect(preview.blocked).toEqual([{ kind: 'titledName', match: 'Mme Dupuis' }]);
    expect(preview.note).toBe(true);
    const shown = preview.message.map((s) => s.text).join('');
    expect(shown).toContain('Merci à Mme Dupuis et à Élève A pour leur aide.');
    expect(shown).not.toContain('Samuel');
  });

  it('lists the note’s capitalized words and shows exactly what the request sends', () => {
    const input = request('Comme Mme Tremblay, des exemples concrets. Merci à Sophie.');
    const preview = buildReportBankPreview(input, people, NOW);
    expect(preview.blocked).toEqual([]);
    expect(preview.words).toEqual(['Sophie']);
    const prepared = prepareCall(reportCommentBankFeature, input, {
      systemPrompt: 'Écris.',
      people,
      now: NOW,
    });
    if (!prepared.ok) throw new Error('refused');
    expect(preview.message.map((s) => s.text).join('')).toBe(prepared.user);
    expect(prepared.user).toContain('Comme Adulte A, des exemples concrets. Merci à Sophie.');
  });

  it('replaces « Tú » but not « tu », as the worker does, which sends the request (D-145)', async () => {
    const school: KnownPerson[] = [...people, { name: 'Tú', kind: 'student' }];
    const input = request('Tu peux t’inspirer des progrès de Tú. Un an de travail.');
    const preview = buildReportBankPreview(input, school, NOW);
    expect(preview.replaced).toBe(1);
    expect(preview.message.filter((s) => s.placeholder).map((s) => s.text)).toEqual(['Élève A']);
    const shown = preview.message.map((s) => s.text).join('');
    expect(shown).toContain('Tu peux t’inspirer des progrès de Élève A. Un an de travail.');
    // The prompt says « Tu rédiges… »: the last check lets it through.
    const prepared = prepareCall(reportCommentBankFeature, input, {
      systemPrompt: await loadPrompt('report_comment_bank', 'v1'),
      people: school,
      now: NOW,
    });
    if (!prepared.ok) throw new Error(`refused: ${prepared.problems.join(', ')}`);
    expect(prepared.user).toBe(shown);
  });

  it('asks for nothing more without a note', () => {
    const preview = buildReportBankPreview(request(''), people, NOW);
    expect(preview).toMatchObject({ blocked: [], note: false, words: [], replaced: 0 });
  });
});
