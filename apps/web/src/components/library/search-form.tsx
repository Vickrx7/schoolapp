'use client';

import { Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import {
  MAX_QUERY_LENGTH,
  libraryHref,
  toSearchParams,
  withChanges,
  type LibrarySearch,
} from '@/server/library/search-params';
import { useSearchNavigation } from './search-navigation';

/** Results follow the words typed once typing pauses this long. */
const DEBOUNCE_MS = 400;

const words = (value: string) => value.replace(/\s+/g, ' ').trim();

/**
 * « Rechercher une ressource » (D-068): results follow the words as they are typed (after a
 * short pause, replacing the address so « Précédent » does not step through every letter), and
 * right away on Entrée. The other filters are kept. Without JavaScript it is an ordinary GET
 * form to `/library` carrying the same filters.
 */
export function SearchForm({ search }: { search: LibrarySearch }) {
  const t = useTranslations('library.search');
  const id = useId();
  const { navigate, pending } = useSearchNavigation();
  const [value, setValue] = useState(search.q);
  // The words last sent to the address, and the address's words last seen.
  const [sent, setSent] = useState(search.q);
  const [seen, setSeen] = useState(search.q);

  // The address changed: after our own search, keep what is being typed; after « Précédent »
  // or a link, show the address's words.
  if (search.q !== seen) {
    setSeen(search.q);
    if (search.q !== sent) {
      setValue(search.q);
      setSent(search.q);
    }
  }

  const send = (q: string) => {
    setSent(q);
    navigate(libraryHref(withChanges(search, { q })));
  };

  useEffect(() => {
    const q = words(value);
    if (q === sent) return;
    const timer = setTimeout(() => {
      setSent(q);
      navigate(libraryHref(withChanges(search, { q })));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, sent, search, navigate]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = words(value);
    if (q !== sent) send(q);
  };

  // The other filters, for the form sent without JavaScript.
  const hidden = [...toSearchParams({ ...search, q: '', page: 1 }).entries()];

  return (
    <form role="search" action="/library" method="get" onSubmit={onSubmit} aria-busy={pending}>
      {hidden.map(([name, v], i) => (
        <input key={`${name}-${i}`} type="hidden" name={name} value={v} />
      ))}
      <label htmlFor={id} className="sr-only">
        {t('label')}
      </label>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <Input
            id={id}
            type="search"
            name="q"
            value={value}
            maxLength={MAX_QUERY_LENGTH}
            placeholder={t('placeholder')}
            autoComplete="off"
            enterKeyHint="search"
            onChange={(e) => setValue(e.target.value)}
            className="pr-12 pl-10 [&::-webkit-search-cancel-button]:hidden"
          />
          {value ? (
            <button
              type="button"
              onClick={() => {
                setValue('');
                if (sent !== '') send('');
              }}
              aria-label={t('clear')}
              className="absolute top-1/2 right-0 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:text-slate-900"
            >
              <X className="size-5" aria-hidden />
            </button>
          ) : null}
        </div>
        <Button type="submit" variant="secondary" size="icon" aria-label={t('submit')}>
          <Search aria-hidden />
        </Button>
      </div>
    </form>
  );
}
