import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';

/**
 * Texts saved from « Texte différencié » are ordinary library resources (DECISIONS D-073): the old
 * address opens the resource in the library, where it is edited, shared and deleted.
 */
export default async function SavedDifferentiationPage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const { itemId } = await params;
  if (!z.uuid().safeParse(itemId).success) notFound();
  redirect(`/library/items/${itemId}`);
}
