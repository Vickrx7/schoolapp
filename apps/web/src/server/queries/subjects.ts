import 'server-only';
import type { BoardSettings } from '@lynx/domain';
import { createSupabaseServerClient } from '../supabase';

export interface SubjectOption {
  id: string;
  code: string;
  label: string;
  color: string | null;
}

/** Subjects offered for a class's grades, applying board settings (e.g. Anglais start grade). */
export async function loadSubjectsForGrades(
  gradeOrdinals: number[],
  boardSettings: BoardSettings | undefined,
): Promise<SubjectOption[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('subjects')
    .select('id, code, label_fr, color, grade_min, grade_max, sort_order')
    .eq('active', true)
    .order('sort_order');
  const min = Math.min(...gradeOrdinals);
  const max = Math.max(...gradeOrdinals);
  return (data ?? [])
    .filter((s) => s.grade_min <= max && s.grade_max >= min)
    .filter((s) => s.code !== 'ang' || !boardSettings || max >= boardSettings.anglaisStartGrade)
    .map((s) => ({ id: s.id, code: s.code, label: s.label_fr, color: s.color }));
}
