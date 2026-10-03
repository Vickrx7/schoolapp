import { z } from 'zod';
import { liveStateSchema } from '@/server/class-portal/schemas';
import { reportError } from '@/server/errors';
import { createSupabaseServerClient } from '@/server/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * What the projector polls every second (DECISIONS D-085): `class_session_live` as the signed-in
 * teacher (the class team with a teacher role; anyone else gets 404). It closes an expired
 * session first (D-089). There is never an answer before the reveal, and none when answers are
 * hidden; `liveStateSchema` drops any key it does not list.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  if (!z.uuid().safeParse(sessionId).success) {
    return Response.json({ status: 'notFound' }, { status: 404, headers: NO_STORE });
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('class_session_live', { p_session_id: sessionId });
  if (error) {
    if (error.code === '42501') {
      return Response.json({ status: 'notFound' }, { status: 404, headers: NO_STORE });
    }
    reportError('projectorState', error);
    return Response.json({ status: 'error' }, { status: 500, headers: NO_STORE });
  }
  const state = liveStateSchema.safeParse(data);
  if (!state.success) {
    reportError('projectorState', { message: 'unreadable state' });
    return Response.json({ status: 'error' }, { status: 500, headers: NO_STORE });
  }
  return Response.json(state.data, { headers: NO_STORE });
}
