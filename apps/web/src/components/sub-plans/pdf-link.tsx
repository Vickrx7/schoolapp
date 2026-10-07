import { FileDown, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * A link to a plan PDF or to the students' activity sheets (DECISIONS D-053). A plain <a>, never
 * next/link: nothing is prefetched, so a PDF is only rendered, and a print by direction, office
 * or the substitute only audited, when someone asks for it. `save` asks the route to send the
 * file as a download (the substitute's phone keeps a copy for the day). It is never the
 * `download` attribute: with it, a browser saves whatever comes back, an error page or the
 * « access ended » page included.
 */
export function PdfLink({
  href,
  label,
  save = false,
  variant = 'secondary',
  testId = 'plan-pdf',
}: {
  href: string;
  label: string;
  save?: boolean;
  variant?: 'primary' | 'secondary';
  testId?: string;
}) {
  const Icon = save ? FileDown : Printer;
  const target = save ? `${href}${href.includes('?') ? '&' : '?'}download=1` : href;
  return (
    <Button asChild variant={variant}>
      <a href={target} data-testid={testId}>
        <Icon aria-hidden />
        {label}
      </a>
    </Button>
  );
}
