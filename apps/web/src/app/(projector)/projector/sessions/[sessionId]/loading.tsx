import { getTranslations } from 'next-intl/server';

/** « Connexion… » on a white screen while the projector's first state loads (no flash). */
export default async function ProjectorSessionLoading() {
  const t = await getTranslations('classMode.projector');
  return (
    <div className="flex h-dvh items-center justify-center bg-white" aria-busy="true">
      <p role="status" className="text-[length:clamp(1.5rem,0.75rem_+_2vw,3rem)] text-slate-700">
        {t('connecting')}
      </p>
    </div>
  );
}
