import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ExchangeRate, Paginated } from '@/types/api';

import { useApi } from './api';
import { todayShamsi } from './date';
import { useList } from './hooks';

export const RATES_KEY = ['exchange-rates'] as const;

/**
 * Today's USD rate (Kabul date), or null when it is missing — the state that makes every
 * transaction endpoint answer 428. Shares the exchange-rates cache key, so creating or
 * deleting a rate refreshes it.
 */
export function useTodayUsdRate(): UseQueryResult<ExchangeRate[]> & { rate: ExchangeRate | null } {
  const query = useList<ExchangeRate>([...RATES_KEY, 'today'], '/exchange-rates/', {
    currency: 'USD',
    date: todayShamsi(),
  });
  return { ...query, rate: query.data?.[0] ?? null };
}

/**
 * The stored rate of `currency` on one Shamsi day, or null (none entered). AFN needs none.
 * This is the rate a hawala / office expense / transaction saved for that day snapshots.
 */
export function useDayRate(date: string, currency: string): UseQueryResult<ExchangeRate | null> {
  const api = useApi();
  return useQuery({
    queryKey: [...RATES_KEY, 'day', date, currency],
    queryFn: async () => {
      const data = await api.get<ExchangeRate[] | Paginated<ExchangeRate>>('/exchange-rates/', {
        params: { date, currency },
      });
      return (Array.isArray(data) ? data : data.results)[0] ?? null;
    },
    enabled: currency !== 'AFN' && Boolean(date),
  });
}
