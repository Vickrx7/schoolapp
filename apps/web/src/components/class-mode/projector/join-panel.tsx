import { getTranslations } from 'next-intl/server';
import { SLIDE_TYPE } from '@/components/class-mode/presenter/slide-view';
import { cn } from '@/lib/utils';
import { formatJoinCode } from '@/server/class-portal/code';

/**
 * « Rejoignez la partie » on the projector (DECISIONS D-084), rendered on the server: the join
 * page's address, the code in 120 px type at 1920 px wide in two groups (« K7M 4R9 »), and the
 * class link's QR code as SVG. Class devices that bookmarked the class link join by themselves;
 * the code is the fallback for any other device. The code and the QR code share the width (the
 * QR code at most a fifth of it, its caption wrapping under it); on a narrow screen the code's two
 * groups go one above the other.
 */
export async function JoinPanel({
  code,
  address,
  qrSvg,
}: {
  code: string;
  /** « ecole.example.ca/jouer ». */
  address: string;
  /** The class link's QR code (`qrSvg` in server/class-mode/links.ts), or null without a link. */
  qrSvg: string | null;
}) {
  const t = await getTranslations('classMode');
  const [first, second] = formatJoinCode(code).split(' ');
  return (
    <div className="flex items-start gap-[3vw]">
      <div className="min-w-0 flex-1 space-y-[1.5vh]">
        {/* As the slides' hero type, and no taller than 8vh on a short screen. */}
        <h2 className="text-[length:clamp(2rem,min(1rem_+_4vw,8vh),5rem)] leading-tight font-bold">
          {t('join.title')}
        </h2>
        <p className={cn(SLIDE_TYPE.small, 'text-slate-800')}>
          {t('join.address')} <span className="font-bold break-all text-slate-950">{address}</span>
        </p>
        <div className="space-y-[0.5vh]">
          <p className={cn(SLIDE_TYPE.small, 'font-semibold text-slate-700')}>{t('join.code')}</p>
          <p
            data-join-code={code}
            className="flex flex-wrap gap-x-[0.6em] gap-y-[0.1em] font-mono text-[length:clamp(2.75rem,min(1rem_+_5.5vw,11vh),7.5rem)] leading-none font-bold tracking-[0.12em] text-slate-950 tabular-nums"
          >
            {/* Read letter by letter by screen readers. */}
            <span className="sr-only">
              {t('join.codeSpoken', { code: code.split('').join(' ') })}
            </span>
            <span aria-hidden>{first}</span>
            <span aria-hidden>{second}</span>
          </p>
        </div>
      </div>
      {qrSvg ? (
        <figure className="w-[min(28vh,20vw)] shrink-0 space-y-[1vh] text-center">
          <div
            role="img"
            aria-label={t('join.qr')}
            className="size-[min(28vh,20vw)] rounded-xl border-2 border-slate-300 bg-white p-[0.5vw] [&>svg]:size-full"
            // Markup from the `qrcode` library, built on the server from the class link only.
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
          <figcaption className={cn(SLIDE_TYPE.small, 'text-slate-800')}>
            {t('join.scan')}
          </figcaption>
        </figure>
      ) : null}
    </div>
  );
}
