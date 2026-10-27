import { isAxiosError } from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useAuth } from '@/stores/auth';
import type { Branch, OfficeExpenseCategory } from '@/types/api';

import { useApi } from './api';
import { currentShamsiMonth, toShamsiKey } from './date';
import { normalizeNumber } from './digits';
import { useDebounced, useList } from './hooks';
import { formatMoney, type Currency } from './money';

export const HAWALA_KEY = ['hawala'] as const;
/** Also the prefix of the dashboard tile's query, so saving an expense refreshes it. */
export const OFFICE_KEY = ['office-expenses'] as const;

/** Model order (OfficeExpense.Category); salary is reported on its own income-statement line. */
export const CATEGORIES: OfficeExpenseCategory[] = [
  'SALARY',
  'RENT',
  'FUEL',
  'KITCHEN',
  'STATIONERY',
  'CREDIT',
  'OTHER',
];

export const PAGE_SIZE = 25;
/** A money field as typed (any digits, '٫' / '٬'): up to 12 integer digits and 2 decimals. */
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
export const isMoney = (v: string): boolean => MONEY.test(normalizeNumber(v));

/** Amount in its own currency (any of the five). */
export function money(amount: string | null, currency: string, lang: string): string {
  return formatMoney(amount, currency as Currency, lang);
}

export interface FinanceFilters {
  get(key: string): string;
  setFilter(key: string, value: string | number | null): void;
  clear(): void;
  anyFilter: boolean;
  page: number;
  dateFrom: string;
  dateTo: string;
  searchText: string;
  setSearchText(text: string): void;
  query: Record<string, string | number | undefined>;
}

/**
 * List filters kept in the URL (bookmarks and the back button work). The date range
 * defaults to the current Shamsi month; the branch filter is the super admin's only (a
 * branch manager's list is scoped by the API anyway). `keys` are the page's extra filters.
 */
export function useFinanceFilters(keys: string[]): FinanceFilters {
  const [params, setParams] = useSearchParams();
  const isSuperAdmin = useAuth((s) => s.user?.role === 'super_admin');
  const month = currentShamsiMonth();
  const get = (k: string): string => params.get(k) ?? '';
  const dateFrom = get('date_from') || month.from;
  const dateTo = get('date_to') || month.to;
  const page = Number(get('page')) || 1;

  const setFilter = useCallback(
    (key: string, value: string | number | null): void => {
      setParams(
        (p) => {
          if (value === null || value === '') p.delete(key);
          else p.set(key, String(value));
          if (key !== 'page') p.delete('page');
          return p;
        },
        { replace: key === 'search' },
      );
    },
    [setParams],
  );

  // The search box is typed into, so it reaches the URL debounced.
  const [searchText, setSearchText] = useState(get('search'));
  const debounced = useDebounced(searchText);
  const urlSearch = params.get('search') ?? '';
  useEffect(() => {
    if (debounced !== urlSearch) setFilter('search', debounced);
  }, [debounced, urlSearch, setFilter]);

  const query: Record<string, string | number | undefined> = {
    date_from: toShamsiKey(dateFrom) ?? month.from,
    date_to: toShamsiKey(dateTo) ?? month.to,
    branch: isSuperAdmin ? get('branch') || undefined : undefined,
    search: get('search') || undefined,
    page,
    page_size: PAGE_SIZE,
  };
  for (const k of keys) query[k] = get(k) || undefined;

  return {
    get,
    setFilter,
    clear: () => {
      setSearchText('');
      setParams({});
    },
    anyFilter: ['date_from', 'date_to', 'branch', 'search', ...keys].some((k) => params.has(k)),
    page,
    dateFrom,
    dateTo,
    searchText,
    setSearchText,
    query,
  };
}

/** Branch list and id → name (super admin lists and forms). */
export function useBranches(): { branches: Branch[]; name(id: number): string } {
  const list = useList<Branch>(['branches'], '/branches/');
  const branches = list.data ?? [];
  return { branches, name: (id) => branches.find((b) => b.id === id)?.name ?? '…' };
}

/** POST (id null) / PATCH a finance record without the api client's own error toast. */
export function useFinanceSave(
  endpoint: string,
): <T>(id: number | null, body: object) => Promise<T> {
  const api = useApi();
  return <T>(id: number | null, body: object) =>
    id
      ? api.patch<T>(`${endpoint}${id}/`, body, { skipErrorToast: true })
      : api.post<T>(endpoint, body, { skipErrorToast: true });
}

/**
 * Today's-rate soft lock for a save: `guard(save)` runs it, and a 428 from the API sets
 * `blocked` (the form shows <RateLockPanel>, whose rate dialog then re-submits the form).
 * Other errors are re-thrown for the form to show.
 */
export function useRateLock(): {
  guard(save: () => Promise<void>): Promise<void>;
  blocked: boolean;
  unblock(): void;
} {
  const [blocked, setBlocked] = useState(false);
  const guard = useCallback(async (save: () => Promise<void>): Promise<void> => {
    try {
      await save();
      setBlocked(false);
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 428) {
        setBlocked(true);
        return;
      }
      throw err;
    }
  }, []);
  return { guard, blocked, unblock: useCallback(() => setBlocked(false), []) };
}
