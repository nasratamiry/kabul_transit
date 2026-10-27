import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Plus, X } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useApi } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useDebounced } from '@/lib/hooks';
import type { Paginated } from '@/types/api';

import { Spinner } from './Spinner';

interface Option {
  id: number;
  name: string;
}

export interface SearchSelectProps {
  /** Collection endpoint with DRF SearchFilter, e.g. '/traders/'. */
  endpoint: string;
  value: number | null;
  onChange(id: number | null): void;
  /** Name of the selected record when the caller already knows it (saves one request). */
  selectedLabel?: string | null;
  /** Extra list params, e.g. { is_active: true } for forms. */
  params?: Record<string, string | number | boolean>;
  /** Shown when nothing is selected (e.g. «همه» in a filter). */
  placeholder?: string;
  /** «Add new» link at the bottom of the results. */
  addNew?: { to: string; label: string; onBeforeNavigate?: () => void };
  id?: string;
  invalid?: boolean;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'data-testid'?: string;
}

const LIMIT = 10;

/**
 * Searchable single select for long lists (traders, transport companies). ARIA combobox:
 * type to search (debounced 300 ms, server-side), arrows + Enter to pick, Esc to close,
 * × to clear. Shows up to 10 matches; «more…» asks for a more precise query.
 */
export function SearchSelect({
  endpoint,
  value,
  onChange,
  selectedLabel,
  params,
  placeholder,
  addNew,
  id,
  invalid,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
  'data-testid': testId,
}: SearchSelectProps): JSX.Element {
  const { t } = useTranslation();
  const api = useApi();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const debounced = useDebounced(query);

  const results = useQuery({
    queryKey: ['search-select', endpoint, debounced, params ?? {}],
    queryFn: async () => {
      const data = await api.get<Option[] | Paginated<Option>>(endpoint, {
        params: { search: debounced || undefined, ...params },
      });
      return Array.isArray(data) ? data : data.results;
    },
    enabled: open,
    staleTime: 15_000,
  });
  // The selected record's name, when the caller did not pass it (e.g. an id from the URL).
  const selected = useQuery({
    queryKey: ['search-select', endpoint, 'item', value],
    queryFn: () => api.get<Option>(`${endpoint}${value}/`),
    enabled: value !== null && !selectedLabel,
    staleTime: 60_000,
  });
  const label = value === null ? '' : (selectedLabel ?? selected.data?.name ?? '…');

  const options = (results.data ?? []).slice(0, LIMIT);
  const more = (results.data?.length ?? 0) > LIMIT;

  function pick(option: Option | null): void {
    onChange(option?.id ?? null);
    setOpen(false);
    setQuery('');
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) setOpen(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => Math.max(0, Math.min(options.length - 1, a + step)));
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      const option = options[active];
      if (option) pick(option);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation(); // close the list, not the drawer or dialog around it
      setOpen(false);
      setQuery('');
    }
  }

  const activeId = open && options[active] ? `${listId}-${options[active].id}` : undefined;

  return (
    <div className="relative" data-testid={testId}>
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        value={open ? query : label}
        placeholder={value === null ? (placeholder ?? t('search_select.placeholder')) : undefined}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setQuery('');
        }}
        onKeyDown={onKey}
        className={cn(
          'block h-10 w-full rounded-lg border border-gray-300 bg-white pe-16 ps-3 text-sm text-gray-900 placeholder:text-gray-500',
          'focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30',
          'dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-400',
          invalid &&
            'border-red-500 focus:border-red-500 focus:ring-red-500/30 dark:border-red-400',
        )}
      />
      <div className="absolute inset-y-0 end-0 flex items-center gap-0.5 pe-2">
        {results.isFetching && open && <Spinner className="h-3.5 w-3.5 text-gray-400" />}
        {value !== null && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              pick(null);
              inputRef.current?.focus();
            }}
            aria-label={t('search_select.clear')}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:hover:bg-gray-700"
            data-testid={testId ? `${testId}-clear` : undefined}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <ChevronDown className="pointer-events-none h-4 w-4 text-gray-400" aria-hidden />
      </div>
      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
          <ul
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            className="max-h-64 overflow-y-auto py-1"
          >
            {options.map((o, i) => (
              <li
                key={o.id}
                id={`${listId}-${o.id}`}
                role="option"
                aria-selected={o.id === value}
                onMouseDown={(e) => e.preventDefault()} // keep focus: blur would close the list first
                onClick={() => pick(o)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'cursor-pointer px-3 py-2 text-sm',
                  i === active && 'bg-brand-light dark:bg-brand/30',
                  o.id === value && 'font-semibold text-brand dark:text-emerald-300',
                )}
              >
                {o.name}
              </li>
            ))}
            {!results.isFetching && options.length === 0 && (
              <li className="px-3 py-2 text-sm text-gray-500" role="presentation">
                {t('search_select.no_results')}
              </li>
            )}
            {more && (
              <li className="px-3 py-1.5 text-xs text-gray-500" role="presentation">
                {t('search_select.more')}
              </li>
            )}
          </ul>
          {addNew && (
            <Link
              to={addNew.to}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => addNew.onBeforeNavigate?.()}
              className="flex items-center gap-1.5 border-t border-gray-100 px-3 py-2 text-sm font-medium text-brand hover:bg-brand-light dark:border-gray-700 dark:text-emerald-300 dark:hover:bg-brand/30"
              data-testid={testId ? `${testId}-add-new` : undefined}
            >
              <Plus className="h-4 w-4" />
              {addNew.label}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
