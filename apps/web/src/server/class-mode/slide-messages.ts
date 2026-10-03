import 'server-only';
import type { DocLang } from '@lynx/content';
import type { SlideMessages } from '@/components/class-mode/presenter/slide-view';

const CATALOGS = {
  'fr-CA': () => import('../../../messages/fr-CA.json'),
  'en-CA': () => import('../../../messages/en-CA.json'),
} as const satisfies Record<DocLang, unknown>;

/**
 * The labels projected on the slides (`classPresenter.slide`) in the content's language, not the
 * interface's (DECISIONS D-090): students of a French class read « Étape 2 sur 6 » even when the
 * teacher's screens are in English, and an Anglais resource shows « Step 2 of 6 ». The player's
 * own controls stay in the interface language.
 */
export async function loadSlideMessages(lang: DocLang): Promise<SlideMessages> {
  const catalog = await CATALOGS[lang]();
  return catalog.default.classPresenter.slide;
}
