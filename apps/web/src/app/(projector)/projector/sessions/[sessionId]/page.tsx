import { parseBoardSettings } from '@lynx/domain';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { JoinPanel } from '@/components/class-mode/projector/join-panel';
import { ProjectorShell } from '@/components/class-mode/projector/projector-shell';
import { classLinkUrl, joinAddress, qrSvg } from '@/server/class-mode/links';
import { serverEnv } from '@/server/env';
import { loadClassLinkToken, loadProjectorSession } from '@/server/queries/class-mode';
import { requireSession } from '@/server/session';
import { loadClass } from '@/server/queries/classes';

type Props = { params: Promise<{ sessionId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations('classMode.projector');
  const { sessionId } = await params;
  if (!z.uuid().safeParse(sessionId).success) return { title: t('title') };
  const projector = await loadProjectorSession(sessionId);
  return {
    title: projector?.live.title ? t('pageTitle', { title: projector.live.title }) : t('title'),
  };
}

/**
 * The projector of « Quiz sur les appareils » (DECISIONS D-084 to D-090):
 * `/projector/sessions/<id>`, for the class team with a teacher role (`class_session_live`;
 * anyone else: not found). The first state is read here, then the page polls. The join panel
 * (address, code, the class link's QR code) is rendered here, on the server. The page holds the
 * snapshot's questions and the teacher's live state: never a key before the reveal, and none
 * when answers are hidden.
 */
export default async function ProjectorSessionPage({ params }: Props) {
  const session = await requireSession();
  const { sessionId } = await params;
  if (!z.uuid().safeParse(sessionId).success) notFound();
  const projector = await loadProjectorSession(sessionId);
  if (!projector) notFound();

  const baseUrl = serverEnv().APP_BASE_URL;
  const [token, cls] = await Promise.all([
    projector.live.status === 'open' ? loadClassLinkToken(projector.classId) : null,
    loadClass(session, projector.classId),
  ]);
  const qr = token ? await qrSvg(classLinkUrl(baseUrl, token)) : null;
  const board = session.boards.find((b) => b.id === cls?.boardId);
  const retentionDays = (board?.settings ?? parseBoardSettings({})).classModeResultsRetentionDays;

  return (
    <ProjectorShell
      sessionId={projector.id}
      classId={projector.classId}
      initial={projector.live}
      retentionDays={retentionDays}
      joinPanel={
        <JoinPanel code={projector.live.joinCode} address={joinAddress(baseUrl)} qrSvg={qr} />
      }
    />
  );
}
