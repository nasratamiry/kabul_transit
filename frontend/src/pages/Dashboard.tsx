import { useQuery } from '@tanstack/react-query';
import { Building2, CalendarDays, CheckCircle2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AdminOverview } from '@/components/admin/AdminOverview';
import { TodayRateBanner } from '@/components/admin/TodayRateBanner';
import { TodayRateDialog } from '@/components/finance/TodayRateDialog';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { useApi } from '@/lib/api';
import { dualDate, kabulToday } from '@/lib/date';
import { useAuth } from '@/stores/auth';
import type { Me } from '@/types/api';

export function Dashboard(): JSX.Element {
  const { t } = useTranslation();
  const api = useApi();
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const today = dualDate(kabulToday());
  const [rateDialog, setRateDialog] = useState(false);

  const me = useQuery({
    queryKey: ['auth', 'me', user?.id],
    queryFn: () => api.get<Me>('/auth/me/'),
    retry: false,
  });

  // Keep the header in step with the server (role or branch may have changed since login).
  useEffect(() => {
    if (me.data) setUser(me.data);
  }, [me.data, setUser]);

  if (!user) return <Spinner />;
  const isSuperAdmin = user.role === 'super_admin';

  return (
    <>
      {isSuperAdmin && <AdminOverview />}
      {!isSuperAdmin && (
        // A branch manager may enter today's rate (only today's); it unblocks new transactions.
        <div className="mb-6">
          <TodayRateBanner onAdd={() => setRateDialog(true)} />
          <TodayRateDialog open={rateDialog} onClose={() => setRateDialog(false)} />
        </div>
      )}
      <Card className="overflow-hidden">
        <div className="h-1.5 bg-gradient-to-l from-brand via-brand to-accent" />
        <CardBody className="space-y-6 p-6 sm:p-8">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold" data-testid="greeting">
              {t('dashboard.greeting', { name: user.full_name })}
            </h1>
            <Badge tone={isSuperAdmin ? 'brand' : 'accent'} data-testid="role-badge">
              {t(`roles.${user.role}`)}
            </Badge>
          </div>
          <p className="text-gray-600 dark:text-gray-400">{t('dashboard.intro')}</p>

          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-900/50">
              <dt className="mb-1 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <Building2 className="h-4 w-4" />
                {t('dashboard.branch')}
              </dt>
              <dd className="font-medium" data-testid="branch">
                {isSuperAdmin ? t('layout.all_branches') : (user.branch_name ?? '—')}
              </dd>
            </div>
            <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-900/50">
              <dt className="mb-1 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <CalendarDays className="h-4 w-4" />
                {t('dashboard.today')}
              </dt>
              <dd className="flex flex-wrap items-baseline gap-x-3 font-medium">
                <span data-testid="today-shamsi">
                  {today.shamsi}{' '}
                  <span className="text-xs text-gray-500">({t('dashboard.shamsi')})</span>
                </span>
                <span dir="ltr" data-testid="today-gregorian">
                  {today.gregorian}{' '}
                  <span className="text-xs text-gray-500">({t('dashboard.gregorian')})</span>
                </span>
              </dd>
            </div>
          </dl>

          <div
            data-testid="backend-status"
            data-state={me.isSuccess ? 'ok' : me.isError ? 'fail' : 'pending'}
          >
            {me.isPending ? (
              <Badge>
                <Spinner className="h-3 w-3" />
                {t('dashboard.backend_checking')}
              </Badge>
            ) : me.isSuccess ? (
              <Badge tone="success">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {t('dashboard.backend_ok')}
              </Badge>
            ) : (
              <Badge tone="danger">
                <XCircle className="h-3.5 w-3.5" />
                {t('dashboard.backend_fail')}
              </Badge>
            )}
          </div>
        </CardBody>
      </Card>
    </>
  );
}
