'use client';

import { MonitorSmartphone, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/field';
import { useErrorText } from '@/hooks/use-action';
import { openAsNewDocument } from '@/lib/new-document';
import { checkQuizStart, startQuiz, type QuizStartCheck } from '@/server/actions/class-mode';

/**
 * « Lancer un quiz sur les appareils » (DECISIONS D-084, D-087, D-090): a dialog (a bottom sheet
 * on phones) with the class, the version (« Version de base »; the others under « Autre version »,
 * so no level name is on screen by default), « En équipes » (2 to 6 teams) or « Chacun pour
 * soi », the timer, « Montrer la bonne réponse après chaque question », and « Options » (students
 * choose their team; score short answers). « Lancer » first checks what devices will show for
 * the class's first names (« Lancer quand même »), then starts; a session already open in the
 * class (a colleague's, a forgotten one) offers « Terminer cette séance et lancer ». The projector
 * opens as a new document, so its tab never holds this page's answer key.
 */

export interface QuizVersionChoice {
  id: string;
  label: string;
  base: boolean;
}

export interface QuizClassChoice {
  id: string;
  name: string;
  schoolName: string;
}

type Step = { kind: 'form' } | { kind: 'names'; check: QuizStartCheck } | { kind: 'open' };

const TIMERS = [null, 20, 30, 60] as const;
const TEAM_COUNTS = [2, 3, 4, 5, 6] as const;

export function StartQuizDialog({
  itemId,
  versions,
  initialVersionId,
  classes,
  configured,
  showSchool,
}: {
  itemId: string;
  versions: QuizVersionChoice[];
  initialVersionId: string;
  classes: QuizClassChoice[];
  configured: boolean;
  /** The user teaches at several library schools: classes carry their school's name. */
  showSchool: boolean;
}) {
  const t = useTranslations('classMode');
  const tCommon = useTranslations('common');
  const errorText = useErrorText();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const base = versions.find((v) => v.base) ?? versions[0];
  const initial = versions.find((v) => v.id === initialVersionId) ?? base;
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const [versionId, setVersionId] = useState(initial?.id ?? '');
  const [mode, setMode] = useState<'teams' | 'solo'>('teams');
  const [teamCount, setTeamCount] = useState(4);
  const [seconds, setSeconds] = useState<(typeof TIMERS)[number]>(null);
  const [revealAnswers, setRevealAnswers] = useState(true);
  const [teamChoice, setTeamChoice] = useState(false);
  const [scoreShort, setScoreShort] = useState(false);
  const others = versions.filter((v) => v.id !== base?.id);

  const start = (replaceOpen: boolean) =>
    startTransition(async () => {
      setError(null);
      try {
        const result = await startQuiz(itemId, {
          classId,
          versionId,
          mode,
          teamCount,
          teamChoice: teamChoice ? 'device' : 'random',
          seconds,
          revealAnswers,
          scoreShortAnswers: scoreShort,
          replaceOpen,
        });
        if (result.ok) {
          // A new document: the projector's tab holds nothing of this page.
          openAsNewDocument(`/projector/sessions/${result.data.sessionId}`);
          return;
        }
        if (result.error === 'classSessionOpen') setStep({ kind: 'open' });
        else setError(result.error);
      } catch {
        setError('network');
      }
    });

  const check = () =>
    startTransition(async () => {
      setError(null);
      try {
        const result = await checkQuizStart(itemId, versionId, classId, scoreShort);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (result.data.possibleNames.length) setStep({ kind: 'names', check: result.data });
        else start(false);
      } catch {
        setError('network');
      }
    });

  const reset = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setStep({ kind: 'form' });
      setError(null);
    }
  };

  const ready = configured && classes.length > 0 && Boolean(versionId && classId);

  return (
    <>
      <Button variant="secondary" onClick={() => reset(true)}>
        <MonitorSmartphone aria-hidden />
        {t('startQuiz')}
      </Button>
      <Dialog open={open} onOpenChange={reset}>
        <DialogContent
          title={t('startQuiz')}
          description={t('devicesHint')}
          closeLabel={tCommon('close')}
        >
          {!configured ? (
            <Notice tone="warning">{t('notConfigured')}</Notice>
          ) : classes.length === 0 ? (
            <Notice tone="warning">{t('noClass')}</Notice>
          ) : (
            <form
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (!ready || pending) return;
                if (step.kind === 'names') start(false);
                else if (step.kind === 'open') start(true);
                else check();
              }}
            >
              <p className="text-sm text-slate-600">{t('dialogDescription')}</p>

              <Field label={t('class')} htmlFor={`${id}-class`}>
                <Select
                  id={`${id}-class`}
                  value={classId}
                  onChange={(e) => {
                    setClassId(e.target.value);
                    setStep({ kind: 'form' });
                  }}
                >
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {showSchool ? `${c.name} · ${c.schoolName}` : c.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-slate-700">{t('version')}</legend>
                <div className="flex flex-wrap gap-2">
                  {base ? (
                    <Chip
                      name={`${id}-version`}
                      value={base.id}
                      checked={versionId === base.id}
                      onChange={() => {
                        setVersionId(base.id);
                        setStep({ kind: 'form' });
                      }}
                    >
                      {t('baseVersion')}
                    </Chip>
                  ) : null}
                </div>
                {others.length ? (
                  <details
                    className="rounded-lg border border-slate-200 p-3 text-sm"
                    open={initial?.id !== base?.id}
                  >
                    <summary className="min-h-11 cursor-pointer content-center font-medium text-slate-800">
                      {t('otherVersion')}
                    </summary>
                    <p className="mt-1 mb-2 text-slate-600">{t('otherVersionHint')}</p>
                    <div className="flex flex-wrap gap-2">
                      {others.map((v) => (
                        <Chip
                          key={v.id}
                          name={`${id}-version`}
                          value={v.id}
                          checked={versionId === v.id}
                          onChange={() => {
                            setVersionId(v.id);
                            setStep({ kind: 'form' });
                          }}
                        >
                          {v.label}
                        </Chip>
                      ))}
                    </div>
                  </details>
                ) : null}
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-slate-700">{t('mode.label')}</legend>
                <div className="flex flex-wrap gap-2">
                  <Chip
                    name={`${id}-mode`}
                    value="teams"
                    checked={mode === 'teams'}
                    onChange={() => setMode('teams')}
                  >
                    {t('mode.teams')}
                  </Chip>
                  <Chip
                    name={`${id}-mode`}
                    value="solo"
                    checked={mode === 'solo'}
                    onChange={() => setMode('solo')}
                  >
                    {t('mode.solo')}
                  </Chip>
                </div>
                {mode === 'teams' ? (
                  <fieldset className="space-y-2 pt-1">
                    <legend className="text-sm text-slate-700">{t('teamCount')}</legend>
                    <div className="flex flex-wrap gap-2">
                      {TEAM_COUNTS.map((n) => (
                        <Chip
                          key={n}
                          name={`${id}-teams`}
                          value={String(n)}
                          checked={teamCount === n}
                          onChange={() => setTeamCount(n)}
                        >
                          {n}
                        </Chip>
                      ))}
                    </div>
                    <p className="text-sm text-slate-600">{t('teamsHint')}</p>
                  </fieldset>
                ) : (
                  <p className="text-sm text-slate-600">{t('soloHint')}</p>
                )}
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-slate-700">{t('timer.label')}</legend>
                <div className="flex flex-wrap gap-2">
                  {TIMERS.map((s) => (
                    <Chip
                      key={s ?? 'none'}
                      name={`${id}-timer`}
                      value={String(s ?? 'none')}
                      checked={seconds === s}
                      onChange={() => setSeconds(s)}
                    >
                      {s === null ? t('timer.none') : t(`timer.s${s}`)}
                    </Chip>
                  ))}
                </div>
              </fieldset>

              <Checkbox
                id={`${id}-reveal`}
                checked={revealAnswers}
                onChange={setRevealAnswers}
                label={t('revealAnswers')}
                hint={t('revealAnswersHint')}
              />

              <details className="rounded-lg border border-slate-200 p-3 text-sm">
                <summary className="min-h-11 cursor-pointer content-center font-medium text-slate-800">
                  {t('options')}
                </summary>
                <div className="mt-2 space-y-4">
                  {mode === 'teams' ? (
                    <Checkbox
                      id={`${id}-choice`}
                      checked={teamChoice}
                      onChange={setTeamChoice}
                      label={t('teamChoice')}
                      hint={t('teamChoiceHint')}
                    />
                  ) : null}
                  <Checkbox
                    id={`${id}-short`}
                    checked={scoreShort}
                    onChange={(value) => {
                      setScoreShort(value);
                      setStep({ kind: 'form' });
                    }}
                    label={t('scoreShort')}
                    hint={t('scoreShortHint')}
                  />
                </div>
              </details>

              {step.kind === 'names' ? (
                <Notice tone="warning">
                  {t('possibleNames', { names: step.check.possibleNames.join(', ') })}
                </Notice>
              ) : null}
              {step.kind === 'open' ? <Notice tone="warning">{t('sessionOpen')}</Notice> : null}
              {error ? (
                <p className="text-sm text-red-600" role="alert">
                  {errorText(error)}
                </p>
              ) : null}

              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" onClick={() => reset(false)}>
                  {tCommon('cancel')}
                </Button>
                <Button type="submit" disabled={!ready || pending}>
                  <Play aria-hidden />
                  {pending
                    ? t('starting')
                    : step.kind === 'names'
                      ? t('startAnyway')
                      : step.kind === 'open'
                        ? t('replaceOpen')
                        : t('start')}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Checkbox({
  id,
  checked,
  onChange,
  label,
  hint,
}: {
  id: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint: string;
}) {
  // The whole row is the target (44 px at least, D-034).
  return (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-hint`}
        className="mt-0.5 size-6 shrink-0 accent-brand-600"
      />
      <span>
        <span id={`${id}-label`} className="block text-sm font-medium text-slate-900">
          {label}
        </span>
        <span id={`${id}-hint`} className="block text-sm text-slate-600">
          {hint}
        </span>
      </span>
    </label>
  );
}
