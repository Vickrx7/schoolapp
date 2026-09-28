'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import type { ClassFormOptions } from '@/server/queries/classes';
import { ClassForm } from './class-form';

export function NewClassButton({ options }: { options: ClassFormOptions }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          {t('classes.new')}
        </Button>
      </DialogTrigger>
      <DialogContent title={t('classes.new')} closeLabel={t('common.close')}>
        <ClassForm options={options} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
