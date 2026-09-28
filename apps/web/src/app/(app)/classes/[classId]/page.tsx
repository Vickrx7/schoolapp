import { redirect } from 'next/navigation';

export default async function ClassIndex({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  redirect(`/classes/${classId}/students`);
}
