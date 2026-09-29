import { FileDown, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * A link to a plan PDF (DECISIONS D-053). A plain <a>, never next/link: nothing is prefetched,
 * so a PDF is only rendered, and a print by direction, office or the substitute only audited,
 * when someone asks for it. `download` saves the file instead of opening it (the substitute's
 * phone keeps a copy for the day).
 */
export function PdfLink({
  href,
  label,
  download = false,
  variant = 'secondary',
}: {
  href: string;
  label: string;
  download?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  const Icon = download ? FileDown : Printer;
  return (
    <Button asChild variant={variant}>
      <a href={href} download={download || undefined} data-testid="plan-pdf">
        <Icon aria-hidden />
        {label}
      </a>
    </Button>
  );
}
