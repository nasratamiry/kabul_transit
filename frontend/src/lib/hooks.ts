import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

import i18n from '@/i18n';
import type { Choice, OptionsMeta, Paginated } from '@/types/api';

import { extractErrorMessage, useApi } from './api';

type Params = Record<string, string | number | boolean | null | undefined>;

/** Drop empty filter values so `?is_active=&search=` never reaches the API. */
function cleanParams(params?: Params): Record<string, string | number | boolean> | undefined {
  if (!params) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(params))
    if (v !== '' && v !== null && v !== undefined) out[k] = v;
  return out;
}

/**
 * GET a list. The API has no pagination today (plain arrays); a DRF page envelope is
 * unwrapped too, so pages keep working if pagination is switched on later.
 */
export function useList<T>(key: QueryKey, url: string, params?: Params): UseQueryResult<T[]> {
  const api = useApi();
  const query = cleanParams(params);
  return useQuery({
    queryKey: [...key, query ?? {}],
    queryFn: async () => {
      const data = await api.get<T[] | Paginated<T>>(url, { params: query });
      return Array.isArray(data) ? data : data.results;
    },
    placeholderData: (previous) => previous, // keep rows on screen while a filter refetches
  });
}

export function useItem<T>(key: QueryKey, url: string | null): UseQueryResult<T> {
  const api = useApi();
  return useQuery({
    queryKey: [...key, url],
    queryFn: () => api.get<T>(url as string),
    enabled: url !== null,
  });
}

/**
 * Choices of one field from DRF OPTIONS metadata (`actions.POST.<field>.choices`);
 * undefined until loaded, so a form can wait before rendering a <select> whose default
 * value must exist among its options.
 */
export function useChoices(url: string, field: string): Choice[] | undefined {
  const api = useApi();
  const { data } = useQuery({
    queryKey: ['options', url],
    queryFn: () => api.options<OptionsMeta>(url),
    staleTime: Infinity,
  });
  if (!data) return undefined;
  return data.actions?.POST?.[field]?.choices ?? [];
}

type Message<T, I> = string | false | ((data: T, input: I) => string);

interface MutationOptions<T, I> {
  /** Success toast; `false` for none. Default: common.saved / common.deleted. */
  success?: Message<T, I>;
}

function toastSuccess<T, I>(
  msg: Message<T, I> | undefined,
  fallback: string,
  data: T,
  input: I,
): void {
  if (msg === false) return;
  toast.success(typeof msg === 'function' ? msg(data, input) : (msg ?? i18n.t(fallback)));
}

/**
 * Error toast for mutations: the backend's Dari message for a 4xx (validation, 409
 * protected delete, 403), the generic messages otherwise. Requests are sent with
 * skipErrorToast so the api client does not toast a second time.
 */
export function toastError(error: unknown): void {
  const err = error as { response?: { status: number; data: unknown } };
  const status = err.response?.status;
  if (!status) toast.error(i18n.t('errors.network'));
  else if (status === 428) toast.error(i18n.t('errors.today_rate_missing'), { id: 'today-rate' });
  else if (status === 429) toast.error(i18n.t('errors.too_many_requests'), { id: 'rate-limit' });
  else if (status >= 500) toast.error(i18n.t('errors.server'));
  else toast.error(extractErrorMessage(err.response?.data) ?? i18n.t('errors.validation'));
}

function useInvalidate(keys: QueryKey[]): () => Promise<void> {
  const qc = useQueryClient();
  return async () => {
    await Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
  };
}

export function useCreate<T, I>(
  url: string,
  invalidate: QueryKey[],
  options: MutationOptions<T, I> = {},
): UseMutationResult<T, unknown, I> {
  const api = useApi();
  const refresh = useInvalidate(invalidate);
  return useMutation({
    mutationFn: (input: I) => api.post<T, I>(url, input, { skipErrorToast: true }),
    onSuccess: async (data, input) => {
      toastSuccess(options.success, 'common.saved', data, input);
      await refresh();
    },
    onError: toastError,
  });
}

export function useUpdate<T, I>(
  url: (id: number) => string,
  invalidate: QueryKey[],
  options: MutationOptions<T, { id: number; data: I }> = {},
): UseMutationResult<T, unknown, { id: number; data: I }> {
  const api = useApi();
  const refresh = useInvalidate(invalidate);
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: I }) =>
      api.patch<T, I>(url(id), data, { skipErrorToast: true }),
    onSuccess: async (data, input) => {
      toastSuccess(options.success, 'common.saved', data, input);
      await refresh();
    },
    onError: toastError,
  });
}

export function useDelete(
  url: (id: number) => string,
  invalidate: QueryKey[],
  options: MutationOptions<void, number> = {},
): UseMutationResult<void, unknown, number> {
  const api = useApi();
  const refresh = useInvalidate(invalidate);
  return useMutation({
    mutationFn: (id: number) => api.delete(url(id), { skipErrorToast: true }),
    onSuccess: async (data, id) => {
      toastSuccess(options.success, 'common.deleted', data, id);
      await refresh();
    },
    onError: toastError,
  });
}

/** `value`, updated only after it has stopped changing for `delay` ms (search boxes). */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
