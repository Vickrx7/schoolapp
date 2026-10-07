'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';

/** A button that asks for confirmation before running a destructive action. */
export function ConfirmButton({
  label,
  message,
  confirmLabel,
  onConfirm,
  variant = 'secondary',
  size = 'sm',
  children,
  disabled,
}: {
  label: string;
  message: ReactNode;
  confirmLabel?: string;
  onConfirm: () => Promise<unknown> | void;
  variant?: 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'icon';
  children?: ReactNode;
  disabled?: boolean;
}) {
  const t = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={variant}
          size={size}
          disabled={disabled}
          aria-label={children ? label : undefined}
        >
          {children ?? label}
        </Button>
      </DialogTrigger>
      <DialogContent title={label} closeLabel={t('close')}>
        <p className="text-slate-700">{message}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                setOpen(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel ?? t('confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
