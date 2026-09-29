import { canPlayOnDevices } from '@lynx/content';
import { Presentation } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { StartQuizDialog, type QuizVersionChoice } from '@/components/class-mode/start-quiz-dialog';
import { Button } from '@/components/ui/button';
import { classPortalConfigured } from '@/server/class-portal/db';
import { isPresentable, presenterHref } from '@/server/class-mode/presenter';
import type { LibraryItemView } from '@/server/library/view-model';
import { loadQuizClasses } from '@/server/queries/class-mode';
import { getSession, librarySchools } from '@/server/session';

export interface ClassModeSlotProps {
  item: LibraryItemView;
  /** The version on screen: « Présenter » projects it (`?v=`), and the quiz dialog starts on it. */
  versionId: string;
}

/**
 * « Mode classe » on the item page (DECISIONS D-082): « Présenter à la classe » for the version
 * on screen (slice S2), then « Lancer un quiz sur les appareils » (slice S3). Rendered on the
 * server once per version, in the item page's action row next to the PDF slot, for library
 * users only.
 *
 * « Présenter à la classe » opens the projector page on that version (`/projector/items/<id>?v=`)
 * for teachers and direction at a school with the Library module, when the item can be used in
 * class and has a player (quizzes, exit tickets, games, brain breaks, experiments) or is marked
 * projectable (`isPresentable`, which the page checks again).
 *
 * « Lancer un quiz sur les appareils » is offered for a quiz, or a game with questions, that the
 * teacher can use (the same rule), when the version on screen has questions devices can answer
 * (`canPlayOnDevices`; the database decides at start). The dialog lists her classes at library
 * schools (those of the item's grades first) and the playable versions; it says so when this
 * server has no device access configured (« Présenter » still works).
 *
 * Plain links, not `next/link`: the projector opens as a new document. After a client-side
 * navigation the tab would keep the item page's server payload (its inline scripts and the
 * router cache), which holds the « Guide et corrigé », the teacher's note and the safety notes;
 * a new document holds only the slides.
 */
export async function ClassModeSlot({ item, versionId }: ClassModeSlotProps) {
  const session = await getSession();
  if (!session || !librarySchools(session).length) return null;
  const presentable = isPresentable({
    type: item.type,
    projectable: item.formats.projectable,
    status: item.status,
    shareScope: item.shareScope,
    mine: item.mine,
  });
  if (!presentable) return null;
  const [t, tItem] = await Promise.all([
    getTranslations('classPresenter'),
    getTranslations('libraryItem'),
  ]);

  const onScreen = item.versions.find((v) => v.id === versionId);
  let quiz = null;
  if (onScreen && canPlayOnDevices(item.type, onScreen.content)) {
    const versions: QuizVersionChoice[] = item.versions
      .filter((v) => canPlayOnDevices(item.type, v.content))
      .map((v) => ({
        id: v.id,
        base: v.languageLevelId === null,
        label:
          v.languageLevelId === null
            ? tItem('versions.base')
            : v.levelLabel === null
              ? tItem('versions.otherLevel')
              : v.personalLevel
                ? tItem('versions.personal', { label: v.levelLabel })
                : v.levelLabel,
      }));
    const classes = await loadQuizClasses(session, item.grades.map((g) => g.code).join(','));
    quiz = (
      <StartQuizDialog
        itemId={item.id}
        versions={versions}
        initialVersionId={versionId}
        classes={classes.map((c) => ({ id: c.id, name: c.name, schoolName: c.schoolName }))}
        configured={classPortalConfigured()}
        showSchool={new Set(classes.map((c) => c.schoolName)).size > 1}
      />
    );
  }

  return (
    <>
      <Button asChild variant="secondary">
        <a href={presenterHref(item.id, versionId)}>
          <Presentation aria-hidden />
          {t('present')}
        </a>
      </Button>
      {quiz}
    </>
  );
}
