'use client';

import type { ShareScope } from '@lynx/db';
import { Share2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import { shareItem } from '@/server/actions/library';
import { allowedScopes } from '@/server/library/growth';
import { NamesDialog, type NamesCheckState } from './names-dialog';

/**
 * « Partager » (DECISIONS D-066): only a reviewed resource, with its school (« Avec mon école »)
 * or the whole board (« Avec tout le conseil »), or back to private. Faith content not yet
 * faith-reviewed cannot go to the whole board (« proposez la ressource au conseil »). The
 * first-name guard runs before anything is shared: each student's name found is confirmed or
 * removed, and personal details always block.
 *
 * An adaptation (D-092) shows the credit its colleagues will see, and an adaptation of a resource
 * shared with one school can go at most to that school (« Cette adaptation peut être partagée au
 * plus avec votre école. »); the database refuses anything wider on every path (LXM03).
 */
export function ShareDialog({
  itemId,
  current,
  schoolId,
  schools: allSchools,
  faithBlocksBoard,
  personalLevels,
  capSchoolId = null,
  credit = null,
}: {
  itemId: string;
  current: ShareScope;
  /** The item's school, when it has one. */
  schoolId: string | null;
  /** The user's library schools of the item's board. */
  schools: { id: string; name: string }[];
  faithBlocksBoard: boolean;
  personalLevels: boolean;
  /** The only school an adaptation may be shared with (null: no cap). */
  capSchoolId?: string | null;
  /** An adaptation's credit line (« Adaptée de « … » (Conseil scolaire) »). */
  credit?: string | null;
}) {
  const t = useTranslations('libraryEdit.share');
  const tGrowth = useTranslations('libraryGrowth');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const allowed = allowedScopes(capSchoolId);
  const schools = allowed.schoolIds
    ? allSchools.filter((s) => allowed.schoolIds!.includes(s.id))
    : allSchools;
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<ShareScope>(current === 'private' ? 'school' : current);
  const [school, setSchool] = useState(
    schools.find((s) => s.id === schoolId)?.id ?? schools[0]?.id ?? '',
  );
  const [names, setNames] = useState<NamesCheckState | null>(null);
  const share = useAction(shareItem);

  const run = async (confirmed: string[]) => {
    const result = await share.run(
      itemId,
      scope,
      scope === 'school' ? school || null : null,
      confirmed,
    );
    if (!result?.ok) return;
    if (!result.data.done) {
      // One dialog at a time: the names replace the sharing choices (which are kept).
      setOpen(false);
      setNames({ names: result.data.names, blocked: result.data.blocked });
      return;
    }
    setNames(null);
    setOpen(false);
    toast.success(t(`done.${scope}`));
    router.refresh();
  };

  const capped = !allowed.scopes.includes('board');
  const options: { value: ShareScope; disabled: boolean; hint?: string }[] = [
    { value: 'private', disabled: false },
    { value: 'school', disabled: personalLevels || !schools.length },
    {
      value: 'board',
      disabled: personalLevels || faithBlocksBoard || capped,
      hint: capped
        ? tGrowth('shareCap', { scope: 'school' })
        : faithBlocksBoard
          ? t('faithBoardHint')
          : undefined,
    },
  ];

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Share2 aria-hidden />
        {t('open')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t('title')} description={t('intro')} closeLabel={tCommon('close')}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run([]);
            }}
          >
            {personalLevels ? <Notice tone="warning">{t('personalLevels')}</Notice> : null}
            {credit ? (
              <p className="text-sm text-slate-700">{tGrowth('shareCredit', { credit })}</p>
            ) : null}
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium text-slate-700">{t('scope')}</legend>
              {options.map((o) => (
                <div key={o.value}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-slate-800">
                    <input
                      type="radio"
                      name="scope"
                      className="size-5"
                      value={o.value}
                      checked={scope === o.value}
                      disabled={o.disabled}
                      onChange={() => setScope(o.value)}
                    />
                    {t(`scopes.${o.value}`)}
                  </label>
                  {o.hint ? <p className="ml-7 text-sm text-slate-600">{o.hint}</p> : null}
                </div>
              ))}
            </fieldset>
            {scope === 'school' && schools.length > 1 ? (
              <Field label={t('school')} htmlFor="share-school">
                <Select
                  id="share-school"
                  value={school}
                  onChange={(e) => setSchool(e.target.value)}
                >
                  {schools.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <p className="text-sm text-slate-600">{t('guardHint')}</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                {tCommon('cancel')}
              </Button>
              <Button type="submit" disabled={share.pending || scope === current}>
                {t('submit')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <NamesDialog
        state={names}
        pending={share.pending}
        onClose={() => setNames(null)}
        onConfirm={(confirmed) => void run(confirmed)}
        confirmLabel={t('submit')}
      />
    </>
  );
}
