import type { MessageCatalog } from './phrases';

/**
 * Both message catalogues (loaded on demand): a message to families is written in French and in
 * English whatever the interface's language (DECISIONS D-136, amending D-033).
 */
export async function newsletterCatalogs(): Promise<{ fr: MessageCatalog; en: MessageCatalog }> {
  const [fr, en] = await Promise.all([
    import('../../../messages/fr-CA.json'),
    import('../../../messages/en-CA.json'),
  ]);
  return { fr: fr.default, en: en.default as MessageCatalog };
}
