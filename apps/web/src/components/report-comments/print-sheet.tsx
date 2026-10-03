'use client';

/**
 * What « Imprimer » prints (DECISIONS D-130): the browser's own print, never a server PDF (that
 * would send the comments to the server). One student per page: the first name, the subject and
 * the period, and the comment as copied. Hidden on screen.
 */
export function PrintSheet({
  sheets,
  subjectLabel,
  periodLabel,
}: {
  sheets: { id: string; firstName: string; text: string }[];
  subjectLabel: string;
  periodLabel: string;
}) {
  if (sheets.length === 0) return null;
  return (
    <div className="hidden text-black print:block" data-testid="report-print">
      {sheets.map((s) => (
        <section key={s.id} className="break-after-page space-y-3 font-serif">
          <h2 className="text-xl font-bold">{s.firstName}</h2>
          <p className="text-sm">
            {subjectLabel} · {periodLabel}
          </p>
          <p lang="fr-CA" className="leading-relaxed whitespace-pre-wrap">
            {s.text}
          </p>
        </section>
      ))}
    </div>
  );
}
