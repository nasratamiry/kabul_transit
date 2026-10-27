import { zodResolver } from '@hookform/resolvers/zod';
import { isAxiosError } from 'axios';
import { Lock, User } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate, type Location } from 'react-router';
import { z } from 'zod';

import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { extractErrorMessage } from '@/lib/api';
import { isAuthenticated, useAuth } from '@/stores/auth';

const schema = z.object({
  username: z.string().trim().min(1, 'auth.username_required'),
  password: z.string().min(1, 'auth.password_required'),
});

type FormValues = z.infer<typeof schema>;

export function Login(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const login = useAuth((s) => s.login);
  const authed = useAuth(isAuthenticated);
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as { from?: Location } | null)?.from;
  const target =
    from && from.pathname !== '/login' ? `${from.pathname}${from.search}` : '/dashboard';

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  if (authed) return <Navigate to={target} replace />;

  async function onSubmit(values: FormValues): Promise<void> {
    setError(null);
    try {
      await login(values.username, values.password);
      navigate(target, { replace: true });
    } catch (err) {
      setError(loginErrorMessage(err, t));
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-brand-light via-gray-50 to-white dark:from-gray-900 dark:via-gray-900 dark:to-gray-800">
      <div className="flex justify-end p-4">
        <LanguageSwitcher />
      </div>
      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        <Card className="w-full max-w-sm overflow-hidden">
          <div className="bg-brand px-6 py-6 text-center text-white">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 text-2xl font-bold">
              K
            </div>
            <h1 className="text-xl font-bold">{t('app.name')}</h1>
            <p className="mt-1 text-sm text-white/80">{t('app.tagline')}</p>
          </div>
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 p-6">
            <div>
              <h2 className="text-lg font-semibold">{t('auth.login_title')}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('auth.login_subtitle')}</p>
            </div>

            {error && (
              <div
                role="alert"
                data-testid="login-error"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300"
              >
                {error}
              </div>
            )}

            <div>
              <Label htmlFor="username">{t('auth.username')}</Label>
              <div className="relative">
                <User className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  id="username"
                  autoComplete="username"
                  autoFocus
                  dir="ltr"
                  className="ps-9 text-start"
                  invalid={Boolean(errors.username)}
                  {...register('username')}
                />
              </div>
              {errors.username?.message && (
                <p className="mt-1 text-xs text-red-600">{t(errors.username.message)}</p>
              )}
            </div>

            <div>
              <Label htmlFor="password">{t('auth.password')}</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  dir="ltr"
                  className="ps-9 text-start"
                  invalid={Boolean(errors.password)}
                  {...register('password')}
                />
              </div>
              {errors.password?.message && (
                <p className="mt-1 text-xs text-red-600">{t(errors.password.message)}</p>
              )}
            </div>

            <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
              {t('auth.login')}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

function loginErrorMessage(err: unknown, t: (key: string) => string): string {
  if (!isAxiosError(err)) return t('errors.server');
  if (!err.response) return t('errors.network');
  switch (err.response.status) {
    case 400:
    case 401:
      return t('auth.login_failed');
    case 423:
      return t('auth.account_locked');
    case 429:
      return t('auth.too_many_attempts');
    default:
      return extractErrorMessage(err.response.data) ?? t('errors.server');
  }
}
