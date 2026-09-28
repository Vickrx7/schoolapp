/**
 * Runs the « Texte différencié » evaluation set and writes a report to
 * packages/ai/eval-results/. Run before any prompt change (SPEC 10).
 *
 *   pnpm ai:eval --provider fake                 # free, checks the harness itself
 *   pnpm ai:eval --yes                           # Claude (AI_MODEL, AI_EFFORT); costs about $1
 *   pnpm ai:eval --yes --case castor-3e --version v2
 *
 * Reads ANTHROPIC_API_KEY, AI_MODEL and AI_EFFORT from the environment (or apps/web/.env.local).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { differentiateFeature, type DifferentiateInput } from '../features/differentiate';
import { priceFor } from '../pricing';
import { loadPrompt } from '../prompts';
import { createAnthropicProvider, createFakeProvider, type Effort } from '../providers';
import { runFeature } from '../run';
import { checkDifferentiation } from './checks';
import { differentiateCases } from './differentiate-cases';

const { values } = parseArgs({
  options: {
    provider: { type: 'string', default: 'anthropic' },
    model: { type: 'string' },
    effort: { type: 'string' },
    version: { type: 'string', default: differentiateFeature.promptVersion },
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
const cases = differentiateCases.filter((c) => !values.case || c.id === values.case);
if (!cases.length) throw new Error(`no case named ${values.case}`);

if (provider.name !== 'fake' && !values.yes) {
  console.log(
    `This sends ${cases.length} fictional texts to ${model} (effort ${effort}).\n` +
      `Estimated cost: about $${(cases.length * 0.12).toFixed(2)} USD. Re-run with --yes to go ahead.`,
  );
  process.exit(0);
}

const system = await loadPrompt(differentiateFeature.name, values.version);
const price = priceFor(provider.model);
const report: string[] = [
  `# Texte différencié: evaluation`,
  '',
  `- Prompt: differentiate/${values.version}`,
  `- Model: ${provider.model}${provider.name === 'fake' ? '' : ` (effort ${effort})`}`,
  `- Date: ${new Date().toISOString()}`,
  '',
];
let totalCost = 0;
let passedChecks = 0;
let totalChecks = 0;

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
    levels: LEVELS.map((l, i) => ({
      key: `L${i + 1}`,
      languageLevelId: `00000000-0000-4000-8000-00000000000${i + 1}`,
      ...l,
    })),
  };
  process.stdout.write(`${c.id} … `);
  const run = await runFeature({
    feature: differentiateFeature,
    provider,
    price,
    systemPrompt: system,
    input,
    people: c.people ?? [],
  });
  totalCost += run.costUsd;
  report.push(`## ${c.id}: ${c.title} (${c.gradeLabel})`, '');
  report.push(
    `Status: **${run.status}**${run.errorCode ? ` (${run.errorCode})` : ''} · attempts ${run.attempts} · ` +
      `${run.usage.inputTokens} in / ${run.usage.outputTokens} out tokens · $${run.costUsd.toFixed(4)} · ${(run.latencyMs / 1000).toFixed(1)} s`,
    '',
  );
  if (!run.output) {
    console.log(run.status);
    report.push(`Problems: ${run.problems.join('; ') || 'none'}`, '');
    continue;
  }
  const checks = checkDifferentiation(run.output, {
    levelKeys: input.levels.map((l) => l.key),
    mustKeep: c.mustKeep,
    people: (c.people ?? []).map((p) => p.name.split(' ')[0] ?? p.name),
  });
  const passed = checks.filter((r) => r.passed).length;
  passedChecks += passed;
  totalChecks += checks.length;
  console.log(`${passed}/${checks.length} checks`);
  report.push('| Check | Result |', '| --- | --- |');
  for (const r of checks) {
    report.push(
      `| ${r.name} | ${r.passed ? 'pass' : '**FAIL**'}${r.detail ? ` (${r.detail})` : ''} |`,
    );
  }
  report.push('', `**Objective:** ${run.output.objective}`, '');
  for (const v of run.output.versions) {
    const level = input.levels.find((l) => l.key === v.level)?.label ?? v.level;
    report.push(`### ${level}: ${v.title}`, '', v.text, '');
    if (v.glossary.length)
      report.push(
        `Glossaire : ${v.glossary.map((g) => `**${g.term}** : ${g.definition}`).join(' · ')}`,
        '',
      );
    if (v.questions.length) report.push(...v.questions.map((q) => `- ${q}`), '');
    report.push(`_Note : ${v.teacherNote}_`, '');
  }
}

report.splice(
  5,
  0,
  `- Checks passed: ${passedChecks}/${totalChecks}`,
  `- Total cost: $${totalCost.toFixed(4)} USD`,
);
const dir = fileURLToPath(new URL('../../eval-results/', import.meta.url));
await mkdir(dir, { recursive: true });
const file = `${dir}${new Date().toISOString().replace(/[:.]/g, '-')}-${provider.model}.md`;
await writeFile(file, `${report.join('\n')}\n`);
console.log(
  `\nChecks passed: ${passedChecks}/${totalChecks} · cost $${totalCost.toFixed(4)} · report: ${file}`,
);
