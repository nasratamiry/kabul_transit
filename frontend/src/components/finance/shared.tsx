import { AlertTriangle, Search, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { DateInput } from '@/components/ui/DateInput';
import { HistoryTimeline } from '@/components/ui/HistoryTimeline';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { cn } from '@/lib/cn';
import { toGregorian, toShamsiKey } from '@/lib/date';
import { toDariDigits } from '@/lib/digits';
import { useBranches, type FinanceFilters } from '@/lib/finance';
import { useChoices, useItem } from '@/lib/hooks';
import { formatMoney, formatRate } from '@/lib/money';
import { useDayRate } from '@/lib/rates';
import { useAuth } from '@/stores/auth';
import type { HistoryEntry } from '@/types/api';

import { TodayRateDialog } from './TodayRateDialog';

interface FilterBarProps {
  filters: FinanceFilters;
  /** OPTIONS endpoint whose `currency` choices fill the currency filter. */
  endpoint: string;
  searchPlaceholder: string;
  /** Page-specific filters (e.g. the office-expense category). */
  children?: ReactNode;
}

/** Date range (Shamsi), branch (super admin), currency, page extras, search, clear. */
export function FinanceFilterBar({
  filters: f,
  endpoint,
  searchPlaceholder,
  children,
}: FilterBarProps): JSX.Element {
  const { t } = useTranslation();
  const isSuperAdmin = useAuth((s) => s.user?.role === 'super_admin');
  const { branches } = useBranches();
  const currencies = useChoices(endpoint, 'currency') ?? [];
  return (
    <section
      aria-label={t('finance.filters')}
      className="sticky top-16 z-10 -mx-1 mb-4 grid gap-3 rounded-xl border border-gray-200 bg-white/95 p-3 backdrop-blur sm:grid-cols-2 lg:grid-cols-4 dark:border-gray-700 dark:bg-gray-800/95"
    >
      <DateInput
        value={f.dateFrom}
        onChange={(e) => f.setFilter('date_from', e.target.value)}
        aria-label={t('finance.date_from')}
        placeholder={t('finance.date_from')}
        showGregorian={false}
        data-testid="filter-date-from"
      />
      <DateInput
        value={f.dateTo}
        onChange={(e) => f.setFilter('date_to', e.target.value)}
        aria-label={t('finance.date_to')}
        placeholder={t('finance.date_to')}
        showGregorian={false}
        data-testid="filter-date-to"
      />
      {isSuperAdmin && (
        <Select
          value={f.get('branch')}
          onChange={(e) => f.setFilter('branch', e.target.value)}
          aria-label={t('finance.branch')}
          placeholder={t('finance.all_branches')}
          options={branches.map((b) => ({ value: b.id, label: b.name }))}
          data-testid="filter-branch"
        />
      )}
      <Select
        value={f.get('currency')}
        onChange={(e) => f.setFilter('currency', e.target.value)}
        aria-label={t('finance.currency')}
        placeholder={t('finance.all_currencies')}
        options={currencies.map((c) => ({ value: c.value, label: t(`currencies.${c.value}`) }))}
        data-testid="filter-currency"
      />
      {children}
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          type="search"
          value={f.searchText}
          onChange={(e) => f.setSearchText(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="ps-9"
          data-testid="filter-search"
        />
      </div>
      <Button variant="ghost" onClick={f.clear} disabled={!f.anyFilter} data-testid="clear-filters">
        <X className="h-4 w-4" />
        {t('finance.clear_filters')}
      </Button>
    </section>
  );
}

/** Shamsi date with the Gregorian one under it. */
export function DualDateCell({ date }: { date: string }): JSX.Element {
  return (
    <span className="flex flex-col leading-tight">
      <span className="font-medium">{toDariDigits(date)}</span>
      <span className="text-xs text-gray-500" dir="ltr">
        {toGregorian(date)}
      </span>
    </span>
  );
}

/** An AFN amount with its USD equivalent under it (both from the API's totals). */
export function AfnUsd({
  afn,
  usd,
  testId,
}: {
  afn: string | null | undefined;
  usd: string | null | undefined;
  testId?: string;
}): JSX.Element {
  const { i18n } = useTranslation();
  return (
    <span className="inline-flex flex-col items-start tabular-nums" data-testid={testId}>
      <span className="font-semibold" data-testid={testId && `${testId}-afn`}>
        {formatMoney(afn, 'AFN', i18n.language)}
      </span>
      <span
        className="text-xs text-gray-600 dark:text-gray-400"
        dir="ltr"
        data-testid={testId && `${testId}-usd`}
      >
        {usd === null || usd === undefined ? '$ —' : formatMoney(usd, 'USD', i18n.language)}
      </span>
    </span>
  );
}

/**
 * Which rate this record will be (or was) saved with. The record keeps the rate of its own
 * date (a snapshot); it is read again only when the date or currency changes.
 */
export function RateNote({
  date,
  currency,
  stored,
}: {
  date: string;
  currency: string;
  /** The saved record's date / currency / rate_used (edit). */
  stored?: { date: string; currency: string; rate_used: string | null };
}): JSX.Element {
  const { t, i18n } = useTranslation();
  const key = toShamsiKey(date) ?? '';
  const kept = stored?.rate_used && stored.date === key && stored.currency === currency;
  // A kept snapshot needs no lookup ('AFN' disables the query).
  const day = useDayRate(key, kept ? 'AFN' : currency);
  const name = t(`currencies.${currency}`);

  let text: string;
  let warn = false;
  if (currency === 'AFN') text = t('finance.rate_afn');
  else if (kept)
    text = t('finance.rate_kept', { rate: formatRate(stored.rate_used, i18n.language) });
  else if (!key || day.isPending) text = t('finance.rate_loading');
  else if (day.data)
    text = t('finance.rate_will_use', {
      currency: name,
      rate: formatRate(day.data.rate, i18n.language),
    });
  else {
    text = t('finance.rate_missing_day', { currency: name });
    warn = true;
  }
  return (
    <p
      className={cn(
        'rounded-lg px-3 py-2 text-sm',
        warn
          ? 'bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200'
          : 'bg-gray-50 text-gray-700 dark:bg-gray-900/50 dark:text-gray-300',
      )}
      role="status"
      data-testid="rate-note"
      data-warn={warn || undefined}
    >
      {text}
    </p>
  );
}

/**
 * Shown when a save got 428 (no USD rate today): enter today's rate here (both roles may
 * enter today's), then `onRateSaved` re-submits the form.
 */
export function RateLockPanel({
  blocked,
  onRateSaved,
}: {
  blocked: boolean;
  onRateSaved(): void;
}): JSX.Element | null {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState(false);
  if (!blocked) return null;
  return (
    <div
      role="alert"
      className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200"
      data-testid="rate-missing-panel"
    >
      <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
      <div className="space-y-2">
        <p className="font-semibold">{t('finance.rate_missing_title')}</p>
        <p>{t('finance.rate_missing_body')}</p>
        <Button
          size="sm"
          className="bg-red-600 hover:bg-red-700"
          onClick={() => setDialog(true)}
          data-testid="rate-missing-cta"
        >
          {t('finance.set_rate')}
        </Button>
      </div>
      <TodayRateDialog open={dialog} onClose={() => setDialog(false)} onSaved={onRateSaved} />
    </div>
  );
}

/** <resource>/<id>/history/ in a modal; field names translated from the page's i18n namespace. */
export function HistoryModal({
  endpoint,
  id,
  ns,
  title,
  onClose,
}: {
  endpoint: string;
  id: number;
  ns: string;
  /** What the history is of, shown after the dialog's title. */
  title?: string;
  onClose(): void;
}): JSX.Element {
  const { t, i18n } = useTranslation();
  const history = useItem<HistoryEntry[]>([ns, 'history'], `${endpoint}${id}/history/`);
  return (
    <Modal
      open
      onClose={onClose}
      title={title ? `${t('finance.history_title')} — ${title}` : t('finance.history_title')}
      size="lg"
    >
      <div data-testid="history-modal">
        {history.isError ? (
          <p className="text-sm text-red-700 dark:text-red-400">{t('finance.not_found')}</p>
        ) : (
          <HistoryTimeline
            entries={history.data}
            loading={history.isPending}
            fieldLabel={(f) => {
              // `${ns}.description` is the page's own description, hence `${field}_field` first.
              const key = [`${ns}.${f}_field`, `${ns}.${f}`].find((k) => i18n.exists(k));
              return key ? t(key) : undefined;
            }}
          />
        )}
      </div>
    </Modal>
  );
}
