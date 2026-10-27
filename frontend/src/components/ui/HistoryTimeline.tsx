import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';
import { splitDualDate } from '@/lib/date';
import { isRtlLang, useDigitLocale } from '@/lib/digits';
import type { HistoryEntry } from '@/types/api';

import { Badge } from './Badge';
import { Spinner } from './Spinner';

interface HistoryTimelineProps {
  entries: HistoryEntry[] | undefined;
  loading?: boolean;
  /** Translates a field name; falls back to the backend's Dari label. */
  fieldLabel?: (field: string) => string | undefined;
}

/**
 * Change history from GET <resource>/<id>/history/ (api/history.py): newest first, each
 * entry with its user, Shamsi + Gregorian date, and only the fields that changed.
 */
export function HistoryTimeline({
  entries,
  loading,
  fieldLabel,
}: HistoryTimelineProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const d = useDigitLocale();
  // Numbers in Dari / Pashto digits with the Persian decimal mark (۶۰۰۰٫۰۰); other text as is.
  const show = (value: string | null): string => {
    if (value === null) return '—';
    const number = /^-?\d+(\.\d+)?$/.test(value);
    return number && isRtlLang(i18n.language) ? d(value).replace('.', '٫') : d(value);
  };
  if (loading && !entries) return <Spinner className="mx-auto h-6 w-6" />;
  if (!entries?.length) return <p className="text-sm text-gray-500">{t('history.empty')}</p>;

  return (
    <ol
      className="relative space-y-5 border-s border-gray-200 ps-5 dark:border-gray-700"
      data-testid="history-list"
    >
      {entries.map((entry, i) => {
        const when = splitDualDate(entry.date);
        const first = i === entries.length - 1;
        return (
          <li key={entry.history_id} className="relative" data-testid="history-item">
            <span
              className={cn(
                'absolute -start-[1.6rem] top-1 h-3 w-3 rounded-full ring-4 ring-white dark:ring-gray-800',
                first ? 'bg-brand' : 'bg-accent',
              )}
            />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={first ? 'brand' : 'accent'}>{entry.type}</Badge>
              <span className="font-medium" data-testid="history-user">
                {t('history.by')} {entry.user ?? '—'}
              </span>
              <span className="text-gray-500">
                {when.shamsi}
                {when.gregorian && (
                  <span className="ms-2 text-xs" dir="ltr">
                    ({when.gregorian})
                  </span>
                )}
              </span>
            </div>
            {entry.changes.length === 0 ? (
              <p className="mt-1 text-xs text-gray-500">
                {first ? t('history.initial') : t('history.no_changes')}
              </p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm" data-testid="history-changes">
                {entry.changes.map((c) => (
                  <li key={c.field} className="rounded-md bg-gray-50 px-2 py-1 dark:bg-gray-900/50">
                    <span className="text-gray-500">{fieldLabel?.(c.field) ?? c.label}: </span>
                    <del className="text-red-700/80 dark:text-red-400/80">{show(c.old)}</del>
                    <ArrowLeft
                      className="mx-1.5 inline h-3.5 w-3.5 text-gray-400 ltr:rotate-180"
                      aria-hidden
                    />
                    <ins className="font-medium text-emerald-700 no-underline dark:text-emerald-300">
                      {show(c.new)}
                    </ins>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
