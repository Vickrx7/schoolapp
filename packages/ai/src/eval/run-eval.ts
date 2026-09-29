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
 * `--feature` is differentiate (the default) or sub_plan. Reads ANTHROPIC_API_KEY, AI_MODEL and
 * AI_EFFORT from the environment (or apps/web/.env.local).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  differentiateFeature,
  MAX_TEXT_TIMES_LEVELS,
  type DifferentiateInput,
} from '../features/differentiate';
import { subPlanFeature } from '../features/sub-plan';
import { priceFor } from '../pricing';
import { loadPrompt } from '../prompts';
import { createAnthropicProvider, createFakeProvider, type Effort } from '../providers';
import { runFeature } from '../run';
import { checkDifferentiation, checkSubPlan, type CheckResult } from './checks';
import { differentiateCases } from './differentiate-cases';
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

const FEATURES = {
  differentiate: {
    title: 'Texte différencié',
    feature: differentiateFeature,
    runs: differentiateRuns,
  },
  sub_plan: { title: 'Consignes détaillées', feature: subPlanFeature, runs: subPlanRuns },
} as const;
const chosen = FEATURES[values.feature as keyof typeof FEATURES];
if (!chosen) throw new Error(`unknown feature ${values.feature} (differentiate or sub_plan)`);
const version = values.version ?? chosen.feature.promptVersion;
const runs = await chosen.runs(version);

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
  `- Total cost: $${totalCost.toFixed(4)} USD`,
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
const file = `${dir}${new Date().toISOString().replace(/[:.]/g, '-')}-${chosen.feature.name}-${provider.model}.md`;
await writeFile(file, `${report.join('\n')}\n`);
const noAnswer = runs.filter((r) => !r.checks).length;
console.log(
  `\nChecks passed: ${passedChecks}/${totalChecks}${noAnswer ? ` · ${noAnswer} without an answer` : ''} · cost $${totalCost.toFixed(4)} · report: ${file}`,
);
