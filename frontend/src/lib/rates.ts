import type { UseQueryResult } from '@tanstack/react-query';

import type { ExchangeRate } from '@/types/api';

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
