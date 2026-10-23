import axios, {
  type AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';
import toast from 'react-hot-toast';

import i18n from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { ApiErrorBody, RefreshResponse } from '@/types/api';

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Caller shows its own message; no global toast for this request. */
    skipErrorToast?: boolean;
  }
  interface InternalAxiosRequestConfig {
    _retried?: boolean;
  }
}

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

export const api = axios.create({ baseURL: API_URL, timeout: 30_000 });

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const { access } = useAuth.getState();
  if (access) config.headers.set('Authorization', `Bearer ${access}`);
  return config;
});

// ---------------------------------------------------------------------------
// Single-flight refresh: every 401 that arrives while a refresh is running waits
// for the same promise, so one expired access token causes exactly one refresh call.
// A 401 that arrives after the refresh already finished (the request went out with
// the old token) just retries with the new token instead of refreshing again.
// ---------------------------------------------------------------------------
let refreshing: Promise<string> | null = null;

function refreshAccess(sentWith: string | undefined): Promise<string> {
  const { access } = useAuth.getState();
  if (!refreshing && access && sentWith !== `Bearer ${access}`) return Promise.resolve(access);
  if (!refreshing) {
    const { refresh } = useAuth.getState();
    refreshing = (
      refresh
        ? axios.post<RefreshResponse>(`${API_URL}/auth/refresh/`, { refresh }).then(({ data }) => {
            useAuth.getState().updateAccess(data.access);
            return data.access;
          })
        : Promise.reject(new Error('no refresh token'))
    ).finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

/** `detail`, else the first field error of a DRF validation body. */
export function extractErrorMessage(data: unknown): string | null {
  if (!data) return null;
  if (typeof data === 'string') return data.length < 300 && !data.startsWith('<') ? data : null;
  if (Array.isArray(data)) return extractErrorMessage(data[0]);
  if (typeof data === 'object') {
    const body = data as ApiErrorBody;
    if (typeof body.detail === 'string') return body.detail;
    for (const [field, value] of Object.entries(body)) {
      if (field === 'code') continue;
      const msg = extractErrorMessage(value);
      if (msg) return field === 'non_field_errors' ? msg : `${field}: ${msg}`;
    }
  }
  return null;
}

function notify(error: AxiosError<ApiErrorBody>): void {
  const status = error.response?.status;
  const t = i18n.t.bind(i18n);
  // Fixed ids stop a burst of failing requests from stacking identical toasts.
  if (!error.response) {
    toast.error(t('errors.network'), { id: 'network' });
  } else if (status === 428) {
    toast.error(t('errors.today_rate_missing'), { id: 'today-rate' });
  } else if (status === 423) {
    toast.error(t('errors.account_locked'), { id: 'locked' });
  } else if (status === 429) {
    toast.error(t('errors.too_many_requests'), { id: 'rate-limit' });
  } else if (status === 403) {
    toast.error(extractErrorMessage(error.response.data) ?? t('errors.forbidden'), { id: '403' });
  } else if (status === 404) {
    toast.error(t('errors.not_found'), { id: '404' });
  } else if (status && status >= 500) {
    toast.error(t('errors.server'), { id: '5xx' });
  } else {
    toast.error(extractErrorMessage(error.response.data) ?? t('errors.validation'));
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const original = error.config as (InternalAxiosRequestConfig & AxiosRequestConfig) | undefined;

    if (error.response?.status === 401 && original && !original._retried) {
      original._retried = true;
      try {
        const access = await refreshAccess(
          original.headers.get('Authorization') as string | undefined,
        );
        original.headers.set('Authorization', `Bearer ${access}`);
        return await api(original);
      } catch {
        // Clearing auth makes <RequireAuth> send the user to /login and remember the page.
        if (useAuth.getState().user) toast.error(i18n.t('auth.session_expired'), { id: '401' });
        useAuth.getState().clear();
        return Promise.reject(error);
      }
    }

    if (!original?.skipErrorToast && error.response?.status !== 401) notify(error);
    return Promise.reject(error);
  },
);

export interface ApiMethods {
  get<T>(url: string, config?: AxiosRequestConfig): Promise<T>;
  delete<T = void>(url: string, config?: AxiosRequestConfig): Promise<T>;
  post<T, B = unknown>(url: string, body?: B, config?: AxiosRequestConfig): Promise<T>;
  put<T, B = unknown>(url: string, body?: B, config?: AxiosRequestConfig): Promise<T>;
  patch<T, B = unknown>(url: string, body?: B, config?: AxiosRequestConfig): Promise<T>;
}

const methods: ApiMethods = {
  get: (url, config) => api.get(url, config).then((r) => r.data),
  delete: (url, config) => api.delete(url, config).then((r) => r.data),
  post: (url, body, config) => api.post(url, body, config).then((r) => r.data),
  put: (url, body, config) => api.put(url, body, config).then((r) => r.data),
  patch: (url, body, config) => api.patch(url, body, config).then((r) => r.data),
};

/** Typed API calls that resolve to the response body. Stable across renders. */
export function useApi(): ApiMethods {
  return methods;
}
