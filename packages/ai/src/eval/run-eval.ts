/**
 * Runs an AI feature's evaluation set and writes a report to packages/ai/eval-results/. Run before
 * any prompt change (SPEC 10).
 *
 *   pnpm ai:eval --provider fake                        # free, checks the harness itself
 *   pnpm ai:eval --yes                                  # Claude (AI_MODEL, AI_EFFORT); about $1.60
 *   pnpm ai:eval --yes --case castor-3e --version v2
 *   pnpm ai:eval --feature sub_plan --provider fake     # « Consignes détaillées »
 *   pnpm ai:eval --feature sub_plan --yes               # about $2 on Claude
 *
 *   pnpm ai:eval --feature library_item --provider fake    # « Créer avec l’IA »
 *   pnpm ai:eval --feature library_item --case quiz-5e --yes    # one case, under $1
 *   pnpm ai:eval --feature library_item --batch --provider fake # the 10 cases as one batch
 *   pnpm ai:eval --feature library_item --batch --case quiz-5e --yes   # worst case about $0.70
 *   pnpm ai:eval --feature library_levels --provider fake  # « Créer les versions manquantes »
 *
 *   pnpm ai:eval --feature report_comment_bank --provider fake   # « Créer une banque avec l’IA »
 *   pnpm ai:eval --feature report_comment_bank --case mat-3e-term --yes   # one case, under $1
 *
 * `--feature` is differentiate (the default), sub_plan, library_item, library_levels or
 * report_comment_bank. Reads
 * ANTHROPIC_API_KEY, AI_MODEL and AI_EFFORT from the environment (or apps/web/.env.local).
 *
 * `--batch` (library_item only; bulk generation, DECISIONS D-096 to D-098) sends the cases as one
 * Message Batches API batch, prepared and checked by the same code as the worker's bulk runs, and
 * reports the batch id, the wait, each case's worst case and its actual cost at batch prices. A
 * batch usually ends within the hour (at most 24 hours); the script waits and polls.
 */
import {
  docToPlainText,
  renderAnswerKeyDoc,
  renderTeacherDoc,
  type AnswerKey,
  type LibraryItemType,
} from '@lynx/content';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  differentiateFeature,
  MAX_TEXT_TIMES_LEVELS,
  type DifferentiateInput,
} from '../features/differentiate';
import {
  libraryItemFeature,
  type LibraryItemAiOutput,
  type LibraryItemInput,
} from '../features/library-item';
import { libraryLevelsFeature } from '../features/library-levels';
import {
  reportCommentBankFeature,
  type ReportCommentBankAiOutput,
  type ReportCommentBankInput,
} from '../features/report-comment-bank';
import type { LibraryAiVersion } from '../features/library-shared';
import { subPlanFeature } from '../features/sub-plan';
import { countedInputTokens, fallbackInputTokens, schemaJsonText, worstCaseUsd } from '../batch';
import { estimateCostUsd, priceFor } from '../pricing';
import { loadPrompt } from '../prompts';
import { createAnthropicProvider, createFakeProvider, type Effort } from '../providers';
import { checkOutput, prepareCall, runFeature } from '../run';
import type { BatchItem, BatchItemResult } from '../types';
import {
  checkDifferentiation,
  checkLibraryItem,
  checkLibraryLevels,
  checkReportCommentBank,
  checkSubPlan,
  type CheckResult,
} from './checks';
import { differentiateCases } from './differentiate-cases';
import { libraryItemCases } from './library-item-cases';
import { libraryLevelsCases } from './library-levels-cases';
import { reportCommentBankCases } from './report-comment-bank-cases';
import { subPlanCases } from './sub-plan-cases';

const { values } = parseArgs({
  options: {
    feature: { type: 'string', default: 'differentiate' },
    provider: { type: 'string', default: 'anthropic' },
    model: { type: 'string' },
    effort: { type: 'string' },
    version: { type: 'string' },
    case: { type: 'string' },
    yes: { type: 'boolean', default: false },
    batch: { type: 'boolean', default: false },
  },
});

const LEVELS = [
  {
    label: 'Débutant',
    description:
      'Phrases courtes, vocabulaire très fréquent, appuis visuels suggérés et glossaire.',
  },
  {
    label: 'Intermédiaire',
    description: 'Phrases simples et vocabulaire courant, quelques mots nouveaux expliqués.',
  },
  { label: 'Avancé', description: 'Texte du niveau scolaire attendu.' },
  { label: 'Enrichi', description: "Vocabulaire plus riche et questions d'approfondissement." },
];

const model = values.model ?? process.env.AI_MODEL ?? 'claude-opus-5-5';
const effort = (values.effort ?? process.env.AI_EFFORT ?? 'medium') as Effort;
const provider =
  values.provider === 'fake'
    ? createFakeProvider()
    : createAnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY, model, effort });
const price = priceFor(provider.model);

/** One case's run in the report: status, usage, then its checks (or why there was no answer). */
interface CaseRun {
  id: string;
  heading: string;
  status: string;
  line: string;
  problems: string[];
  checks: CheckResult[] | null;
  /** The answer, as markdown for the teacher who reads the report. */
  answer: string[];
  costUsd: number;
}

function statusLine(run: Awaited<ReturnType<typeof runFeature>>): string {
  return (
    `Status: **${run.status}**${run.errorCode ? ` (${run.errorCode})` : ''} · attempts ${run.attempts} · ` +
    `${run.usage.inputTokens} in / ${run.usage.outputTokens} out tokens · $${run.costUsd.toFixed(4)} · ${(run.latencyMs / 1000).toFixed(1)} s`
  );
}

/** Stops before a paid run unless --yes was given. */
function confirmCost(count: number, what: string, estimate: number) {
  if (provider.name === 'fake' || values.yes) return;
  console.log(
    `This sends ${count} fictional ${what} to ${model} (effort ${effort}).\n` +
      `Estimated cost: about $${estimate.toFixed(2)} USD. Re-run with --yes to go ahead.`,
  );
  process.exit(0);
}

async function differentiateRuns(version: string): Promise<CaseRun[]> {
  const cases = differentiateCases.filter((c) => !values.case || c.id === values.case);
  if (!cases.length) throw new Error(`no case named ${values.case}`);
  // About $0.12 for a short text with four levels, more as text × levels grows.
  confirmCost(
    cases.length,
    'texts',
    cases.reduce(
      (sum, c) =>
        sum + 0.1 + (0.3 * c.text.length * (c.levels ?? LEVELS).length) / MAX_TEXT_TIMES_LEVELS,
      0,
    ),
  );
  const system = await loadPrompt(differentiateFeature.name, version);
  const runs: CaseRun[] = [];
  for (const c of cases) {
    const input: DifferentiateInput = {
      title: c.title,
      text: c.text,
      objective: c.objective,
      itemType: c.itemType,
      gradeCode: c.gradeCode,
      gradeLabel: c.gradeLabel,
      subjectId: null,
      subjectLabel: c.subjectLabel,
      levels: (c.levels ?? LEVELS).map((l, i) => ({
        key: `L${i + 1}`,
        languageLevelId: `00000000-0000-4000-8000-00000000000${i + 1}`,
        ...l,
      })),
    };
    if (input.text.length * input.levels.length > MAX_TEXT_TIMES_LEVELS) {
      throw new Error(`${c.id} is larger than the app accepts (MAX_TEXT_TIMES_LEVELS)`);
    }
    process.stdout.write(`${c.id} … `);
    const run = await runFeature({
      feature: differentiateFeature,
      provider,
      price,
      systemPrompt: system,
      input,
      people: c.people ?? [],
    });
    const answer: string[] = [];
    const checks = run.output
      ? checkDifferentiation(run.output, {
          levelKeys: input.levels.map((l) => l.key),
          mustKeep: c.mustKeep,
          people: (c.people ?? []).map((p) => p.name.split(' ')[0] ?? p.name),
        })
      : null;
    if (run.output) {
      answer.push(`**Objective:** ${run.output.objective}`, '');
      for (const v of run.output.versions) {
        const level = input.levels.find((l) => l.key === v.level)?.label ?? v.level;
        answer.push(`### ${level}: ${v.title}`, '', v.text, '');
        if (v.glossary.length)
          answer.push(
            `Glossaire : ${v.glossary.map((g) => `**${g.term}** : ${g.definition}`).join(' · ')}`,
            '',
          );
        if (v.questions.length) answer.push(...v.questions.map((q) => `- ${q}`), '');
        answer.push(`_Note : ${v.teacherNote}_`, '');
      }
    }
    runs.push({
      id: c.id,
      heading: `${c.id}: ${c.title} (${c.gradeLabel})`,
      status: run.status,
      line: statusLine(run),
      problems: run.problems,
      checks,
      answer,
      costUsd: run.costUsd,
    });
    console.log(
      checks ? `${checks.filter((r) => r.passed).length}/${checks.length} checks` : run.status,
    );
  }
  return runs;
}

async function subPlanRuns(version: string): Promise<CaseRun[]> {
  const cases = subPlanCases.filter((c) => !values.case || c.id === values.case);
  if (!cases.length) throw new Error(`no case named ${values.case}`);
  // About $0.10 per request plus $0.03 per period (Opus 5.5 at medium effort).
  confirmCost(
    cases.length,
    'substitute plans',
    cases.reduce((sum, c) => sum + 0.1 + 0.03 * c.input.blocks.length, 0),
  );
  const system = await loadPrompt(subPlanFeature.name, version);
  const runs: CaseRun[] = [];
  for (const c of cases) {
    process.stdout.write(`${c.id} … `);
    const run = await runFeature({
      feature: subPlanFeature,
      provider,
      price,
      systemPrompt: system,
      input: c.input,
      people: c.people ?? [],
    });
    const checks = run.output ? checkSubPlan(run.output, c.input, c.expect, run) : null;
    const answer: string[] = [];
    if (run.output) {
      const o = run.output;
      answer.push(`**Journée :** ${o.dayOverview}`, '');
      if (o.faithSentence) answer.push(`**Foi :** ${o.faithSentence}`, '');
      for (const b of o.blocks) {
        const block = c.input.blocks.find((x) => x.key === b.key);
        answer.push(
          `### ${b.key}: ${block ? `${block.start}–${block.end} ${block.subjectLabel}` : '?'}`,
          '',
          b.overview,
          '',
        );
        for (const s of b.steps) {
          answer.push(`- ${s.minutes} min : ${s.instruction}${s.say ? ` Dites : ${s.say}` : ''}`);
        }
        answer.push('');
        for (const d of b.differentiation) answer.push(`- **${d.group}** : ${d.instruction}`);
        if (b.materialsChecklist.length) {
          answer.push('', `Matériel : ${b.materialsChecklist.join(' · ')}`);
        }
        if (b.ifTimeRemains) answer.push('', `S’il reste du temps : ${b.ifTimeRemains}`);
        if (b.activity) {
          answer.push('', `**Activité : ${b.activity.title}**`, '', b.activity.studentInstructions);
          for (const g of b.activity.perGroup)
            answer.push(`- ${g.group} : ${g.studentInstructions}`);
        }
        answer.push('');
      }
      answer.push(
        '<details><summary>Texte envoyé</summary>',
        '',
        '```',
        run.sentText ?? '',
        '```',
        '</details>',
        '',
      );
    }
    runs.push({
      id: c.id,
      heading: `${c.id}: ${c.title}`,
      status: run.status,
      line: statusLine(run),
      problems: run.problems,
      checks,
      answer,
      costUsd: run.costUsd,
    });
    console.log(
      checks ? `${checks.filter((r) => r.passed).length}/${checks.length} checks` : run.status,
    );
  }
  return runs;
}

/** A version of a library resource as a teacher reads it: the guide, then the answer key. */
function versionMarkdown(
  type: LibraryItemType,
  title: string,
  heading: string,
  version: LibraryAiVersion,
): string[] {
  const guide = docToPlainText(renderTeacherDoc({ itemTitle: title }, type, version.content));
  const key = version.answerKey
    ? docToPlainText(
        renderAnswerKeyDoc(type, version.content, version.answerKey as unknown as AnswerKey, {
          number: null,
        }),
      )
    : '';
  return [`### ${heading}`, '', '```', guide, ...(key ? ['', key] : []), '```', ''];
}

/** A library resource as the teacher who reads the report sees it, then what was sent. */
function libraryItemAnswer(
  o: LibraryItemAiOutput,
  input: Pick<LibraryItemInput, 'itemType' | 'levels'>,
  sentText: string,
): string[] {
  const type = input.itemType;
  const answer: string[] = [
    `**${o.title}** (${o.durationMinutes} min) — ${o.summary}`,
    '',
    `Matériel : ${o.materials} · Mots-clés : ${o.keywords}`,
    '',
  ];
  if (o.safetyNotes) answer.push(`Sécurité : ${JSON.stringify(o.safetyNotes)}`, '');
  if (o.catholicConnection) answer.push(`**Lien avec la foi :** ${o.catholicConnection}`, '');
  answer.push(...versionMarkdown(type, o.title, 'Version de base', o.base));
  for (const l of o.levels) {
    const label = input.levels.find((x) => x.key === l.level)?.label ?? l.level;
    answer.push(...versionMarkdown(type, o.title, label, l));
  }
  answer.push(
    '<details><summary>Texte envoyé</summary>',
    '',
    '```',
    sentText,
    '```',
    '</details>',
    '',
  );
  return answer;
}

/** Lines added under the report's heading (the batch mode's id, wait and worst case). */
const extraHeader: string[] = [];

/**
 * « Créer avec l’IA » as bulk generation sends it (D-096 to D-098): every case prepared by
 * `prepareCall`, counted and priced at its worst case, sent as one batch, waited for, read,
 * checked by `checkOutput`, then deleted from the provider.
 */
async function libraryItemBatchRuns(version: string): Promise<CaseRun[]> {
  const batch = provider.batch;
  if (!batch) throw new Error(`the ${provider.name} provider has no batches`);
  const cases = libraryItemCases.filter((c) => !values.case || c.id === values.case);
  if (!cases.length) throw new Error(`no case named ${values.case}`);
  const system = await loadPrompt(libraryItemFeature.name, version);
  const prepared = cases.map((c) => ({
    c,
    customId: randomUUID(),
    call: prepareCall(libraryItemFeature, c.input, {
      systemPrompt: system,
      people: c.people ?? [],
    }),
  }));
  const items = new Map<string, BatchItem>();
  const worst = new Map<string, number>();
  for (const { customId, call } of prepared) {
    if (!call.ok) continue;
    const item: BatchItem = {
      customId,
      system: call.system,
      user: call.user,
      schema: call.schema,
      maxTokens: call.maxTokens,
      fake: () => libraryItemFeature.fake(call.input),
    };
    // Counting is free but reaches the provider: before --yes, the byte bound is enough.
    let tokens = fallbackInputTokens(item.system, item.user, schemaJsonText(item.schema));
    if (provider.name === 'fake' || values.yes) {
      try {
        tokens = countedInputTokens(await batch.countInputTokens(item));
      } catch {
        // Keep the byte bound.
      }
    }
    items.set(customId, item);
    worst.set(customId, worstCaseUsd(tokens, item.maxTokens, price));
  }
  const worstTotal = [...worst.values()].reduce((n, w) => n + w, 0);
  if (provider.name !== 'fake' && !values.yes) {
    console.log(
      `This sends ${items.size} fictional resources to ${model} (effort ${effort}) as one batch.\n` +
        `Worst case: $${worstTotal.toFixed(2)} USD; usually about a fifth of it. Re-run with --yes to go ahead.`,
    );
    process.exit(0);
  }

  const started = Date.now();
  const results = new Map<string, BatchItemResult>();
  let batchId = '(nothing sent)';
  if (items.size) {
    ({ batchId } = await batch.submit([...items.values()]));
    console.log(`batch ${batchId} sent (${items.size} requests)`);
    while ((await batch.status(batchId)).state !== 'ended') {
      process.stdout.write('.');
      await new Promise((r) => setTimeout(r, 30_000));
    }
    for await (const result of batch.results(batchId, items)) results.set(result.customId, result);
    await batch.remove(batchId);
  }
  const waitSeconds = (Date.now() - started) / 1000;
  extraHeader.push(
    `- Batch: ${batchId} · waited ${waitSeconds.toFixed(0)} s`,
    `- Worst case: $${worstTotal.toFixed(4)} USD (batch prices)`,
  );

  const runs: CaseRun[] = [];
  for (const { c, customId, call } of prepared) {
    const heading = `${c.id}: ${c.title}`;
    if (!call.ok) {
      runs.push({
        id: c.id,
        heading,
        status: 'failed',
        line: `Status: **failed** (${call.errorCode}) · not sent`,
        problems: call.problems,
        checks: null,
        answer: [],
        costUsd: 0,
      });
      console.log(`${c.id} … failed (${call.errorCode})`);
      continue;
    }
    const result = results.get(customId);
    const costUsd = result ? estimateCostUsd(result.usage, price, { batch: true }) : 0;
    const usageLine = result
      ? `${result.usage.inputTokens + result.usage.cacheWriteTokens} in / ${result.usage.outputTokens} out tokens`
      : 'no answer';
    const tail = ` · ${usageLine} · $${costUsd.toFixed(4)} (worst case $${(worst.get(customId) ?? 0).toFixed(4)})`;
    const checked =
      result?.output != null
        ? checkOutput(
            libraryItemFeature,
            result.output as LibraryItemAiOutput,
            call.input,
            call.redactor,
          )
        : null;
    if (!checked?.ok) {
      const reason = !result ? 'batch_missing' : checked ? 'invalid_output' : result.stopReason;
      runs.push({
        id: c.id,
        heading,
        status: 'failed',
        line: `Status: **failed** (${reason})${tail}`,
        problems: checked && !checked.ok ? checked.problems : [],
        checks: null,
        answer: [],
        costUsd,
      });
      console.log(`${c.id} … failed (${reason})`);
      continue;
    }
    const checks = checkLibraryItem(checked.output, c.input, c.expect);
    runs.push({
      id: c.id,
      heading,
      status: 'succeeded',
      line: `Status: **succeeded**${tail}`,
      problems: [],
      checks,
      answer: libraryItemAnswer(checked.output, c.input, call.user),
      costUsd,
    });
    console.log(`${c.id} … ${checks.filter((r) => r.passed).length}/${checks.length} checks`);
  }
  return runs;
}

async function libraryItemRuns(version: string): Promise<CaseRun[]> {
  const cases = libraryItemCases.filter((c) => !values.case || c.id === values.case);
  if (!cases.length) throw new Error(`no case named ${values.case}`);
  // About $0.10 for a resource, and about $0.08 more per level (Opus 5.5 at medium effort).
  confirmCost(
    cases.length,
    'resources',
    cases.reduce((sum, c) => sum + 0.1 + 0.08 * c.input.levels.length, 0),
  );
  const system = await loadPrompt(libraryItemFeature.name, version);
  const runs: CaseRun[] = [];
  for (const c of cases) {
    process.stdout.write(`${c.id} … `);
    const run = await runFeature({
      feature: libraryItemFeature,
      provider,
      price,
      systemPrompt: system,
      input: c.input,
      people: c.people ?? [],
    });
    const checks = run.output ? checkLibraryItem(run.output, c.input, c.expect) : null;
    const answer = run.output ? libraryItemAnswer(run.output, c.input, run.sentText ?? '') : [];
    runs.push({
      id: c.id,
      heading: `${c.id}: ${c.title}`,
      status: run.status,
      line: statusLine(run),
      problems: run.problems,
      checks,
      answer,
      costUsd: run.costUsd,
    });
    console.log(
      checks ? `${checks.filter((r) => r.passed).length}/${checks.length} checks` : run.status,
    );
  }
  return runs;
}

async function libraryLevelsRuns(version: string): Promise<CaseRun[]> {
  const cases = libraryLevelsCases.filter((c) => !values.case || c.id === values.case);
  if (!cases.length) throw new Error(`no case named ${values.case}`);
  // About $0.05 plus $0.06 per level (Opus 5.5 at medium effort).
  confirmCost(
    cases.length,
    'resources to adapt',
    cases.reduce((sum, c) => sum + 0.05 + 0.06 * c.input.levels.length, 0),
  );
  const system = await loadPrompt(libraryLevelsFeature.name, version);
  const runs: CaseRun[] = [];
  for (const c of cases) {
    process.stdout.write(`${c.id} … `);
    const run = await runFeature({
      feature: libraryLevelsFeature,
      provider,
      price,
      systemPrompt: system,
      input: c.input,
      people: c.people ?? [],
    });
    const checks = run.output ? checkLibraryLevels(run.output, c.input) : null;
    const answer: string[] = [];
    if (run.output) {
      for (const l of run.output.levels) {
        const label = c.input.levels.find((x) => x.key === l.level)?.label ?? l.level;
        answer.push(...versionMarkdown(c.input.itemType, c.title, label, l));
      }
    }
    runs.push({
      id: c.id,
      heading: `${c.id}: ${c.title}`,
      status: run.status,
      line: statusLine(run),
      problems: run.problems,
      checks,
      answer,
      costUsd: run.costUsd,
    });
    console.log(
      checks ? `${checks.filter((r) => r.passed).length}/${checks.length} checks` : run.status,
    );
  }
  return runs;
}

const MARK_FR: Record<string, string> = {
  with_difficulty: 'Progresse avec difficulté',
  well: 'Progresse bien',
  very_well: 'Progresse très bien',
  excellent: 'E',
  good: 'T',
  satisfactory: 'S',
  needs_improvement: 'N',
};
const KIND_FR: Record<string, string> = {
  strength: 'Point fort',
  next_step: 'Prochaine étape',
  general: 'Commentaire général',
};

/** A comment bank as the teacher who reads the report sees it, then what was sent. */
function reportBankAnswer(
  o: ReportCommentBankAiOutput,
  input: ReportCommentBankInput,
  sentText: string,
): string[] {
  const answer: string[] = [`**${o.title}** — ${o.summary}`, '', `Mots-clés : ${o.keywords}`, ''];
  const groups = new Map<string, typeof o.entries>();
  for (const e of o.entries) {
    const key = e.skill ?? e.expectationKey ?? '—';
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  for (const [key, entries] of groups) {
    const expectation = input.expectations.find((x) => x.key === key);
    answer.push(
      `### ${expectation ? `${expectation.key} ${expectation.code} : ${expectation.text}` : key === '—' ? 'Général' : key}`,
      '',
    );
    for (const e of entries) {
      const mark =
        e.level !== null
          ? `niveau ${e.level}`
          : (MARK_FR[e.progress ?? e.rating ?? ''] ?? 'toutes les cotes');
      const forms = [e.feminine && `F : ${e.feminine}`, e.masculine && `M : ${e.masculine}`]
        .filter(Boolean)
        .join(' · ');
      answer.push(
        `- **${KIND_FR[e.kind] ?? e.kind}** (${mark}${e.category ? `, ${e.category}` : ''}) : ${e.neutral}${forms ? ` (${forms})` : ''}`,
      );
    }
    answer.push('');
  }
  answer.push(
    '<details><summary>Texte envoyé</summary>',
    '',
    '```',
    sentText,
    '```',
    '</details>',
    '',
  );
  return answer;
}

async function reportCommentBankRuns(version: string): Promise<CaseRun[]> {
  const cases = reportCommentBankCases.filter((c) => !values.case || c.id === values.case);
  if (!cases.length) throw new Error(`no case named ${values.case}`);
  // About $0.30 to $0.60 per bank at medium effort: more attentes, more entries.
  confirmCost(
    cases.length,
    'comment banks',
    cases.reduce((sum, c) => sum + 0.3 + 0.025 * c.input.expectations.length, 0),
  );
  const system = await loadPrompt(reportCommentBankFeature.name, version);
  const runs: CaseRun[] = [];
  for (const c of cases) {
    process.stdout.write(`${c.id} … `);
    const run = await runFeature({
      feature: reportCommentBankFeature,
      provider,
      price,
      systemPrompt: system,
      input: c.input,
      people: c.people ?? [],
    });
    const checks = run.output ? checkReportCommentBank(run.output, c.input, c.expect) : null;
    const answer = run.output ? reportBankAnswer(run.output, c.input, run.sentText ?? '') : [];
    runs.push({
      id: c.id,
      heading: `${c.id}: ${c.title}`,
      status: run.status,
      line: statusLine(run),
      problems: run.problems,
      checks,
      answer,
      costUsd: run.costUsd,
    });
    console.log(
      checks ? `${checks.filter((r) => r.passed).length}/${checks.length} checks` : run.status,
    );
  }
  return runs;
}

const FEATURES = {
  differentiate: {
    title: 'Texte différencié',
    feature: differentiateFeature,
    runs: differentiateRuns,
  },
  sub_plan: { title: 'Consignes détaillées', feature: subPlanFeature, runs: subPlanRuns },
  library_item: { title: 'Créer avec l’IA', feature: libraryItemFeature, runs: libraryItemRuns },
  library_levels: {
    title: 'Créer les versions manquantes avec l’IA',
    feature: libraryLevelsFeature,
    runs: libraryLevelsRuns,
  },
  report_comment_bank: {
    title: 'Créer une banque avec l’IA',
    feature: reportCommentBankFeature,
    runs: reportCommentBankRuns,
  },
} as const;
const chosen = FEATURES[values.feature as keyof typeof FEATURES];
if (!chosen) {
  throw new Error(
    `unknown feature ${values.feature} (differentiate, sub_plan, library_item, library_levels or report_comment_bank)`,
  );
}
if (values.batch && values.feature !== 'library_item') {
  throw new Error('--batch is for --feature library_item (bulk generation)');
}
const version = values.version ?? chosen.feature.promptVersion;
const runs = values.batch ? await libraryItemBatchRuns(version) : await chosen.runs(version);

const passedChecks = runs.reduce((n, r) => n + (r.checks?.filter((c) => c.passed).length ?? 0), 0);
const totalChecks = runs.reduce((n, r) => n + (r.checks?.length ?? 0), 0);
const totalCost = runs.reduce((n, r) => n + r.costUsd, 0);
const report: string[] = [
  `# ${chosen.title}: evaluation`,
  '',
  `- Prompt: ${chosen.feature.name}/${version}`,
  `- Model: ${provider.model}${provider.name === 'fake' ? '' : ` (effort ${effort})`}`,
  `- Date: ${new Date().toISOString()}`,
  `- Checks passed: ${passedChecks}/${totalChecks}`,
  `- Total cost: $${totalCost.toFixed(4)} USD${values.batch ? ' (batch prices)' : ''}`,
  ...extraHeader,
  '',
];
for (const r of runs) {
  report.push(`## ${r.heading}`, '', r.line, '');
  if (!r.checks) {
    report.push(`Problems: ${r.problems.join('; ') || 'none'}`, '');
    continue;
  }
  report.push('| Check | Result |', '| --- | --- |');
  for (const c of r.checks) {
    report.push(
      `| ${c.name} | ${c.passed ? 'pass' : '**FAIL**'}${c.detail ? ` (${c.detail})` : ''} |`,
    );
  }
  report.push('', ...r.answer);
}

const dir = fileURLToPath(new URL('../../eval-results/', import.meta.url));
await mkdir(dir, { recursive: true });
const file = `${dir}${new Date().toISOString().replace(/[:.]/g, '-')}-${chosen.feature.name}${values.batch ? '-batch' : ''}-${provider.model}.md`;
await writeFile(file, `${report.join('\n')}\n`);
const noAnswer = runs.filter((r) => !r.checks).length;
console.log(
  `\nChecks passed: ${passedChecks}/${totalChecks}${noAnswer ? ` · ${noAnswer} without an answer` : ''} · cost $${totalCost.toFixed(4)} · report: ${file}`,
);
