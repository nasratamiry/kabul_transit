import { Building2, Coins, ListOrdered, Users, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { cn } from '@/lib/cn';
import { useDigitLocale } from '@/lib/digits';
import { useList } from '@/lib/hooks';
import { useTodayUsdRate } from '@/lib/rates';
import type { Branch, StatementLine, User } from '@/types/api';

import { TodayRateBanner } from './TodayRateBanner';

interface TileProps {
  to: string;
  icon: LucideIcon;
  label: string;
  value: string | null;
  tone?: 'default' | 'ok' | 'bad';
  testId: string;
}

function Tile({ to, icon: Icon, label, value, tone = 'default', testId }: TileProps): JSX.Element {
  return (
    <Link
      to={to}
      data-testid={testId}
      className="group flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:border-gray-700 dark:bg-gray-800"
    >
      <span
        className={cn(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
          tone === 'ok' &&
            'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
          tone === 'bad' && 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
          tone === 'default' && 'bg-brand-light text-brand dark:bg-brand/30 dark:text-emerald-200',
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm text-gray-500 dark:text-gray-400">{label}</span>
        {value === null ? (
          <span className="mt-1 block h-6 w-12 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        ) : (
          <span className="block text-xl font-bold" data-testid={`${testId}-value`}>
            {value}
          </span>
        )}
      </span>
    </Link>
  );
}

/** Super admin dashboard header: today's USD rate status + one tile per admin page. */
export function AdminOverview(): JSX.Element {
  const { t } = useTranslation();
  const d = useDigitLocale();
  const branches = useList<Branch>(['branches'], '/branches/');
  const users = useList<User>(['users'], '/users/');
  const lines = useList<StatementLine>(['statement-lines'], '/statement-lines/');
  const today = useTodayUsdRate();

  const count = (rows: unknown[] | undefined): string | null => (rows ? d(rows.length) : null);

  return (
    <section className="mb-6 space-y-4" aria-label={t('nav.admin')}>
      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-500 dark:text-gray-400">
          {t('dashboard.rate_card_title')}
        </h2>
        <TodayRateBanner to="/admin/exchange-rates" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          to="/admin/branches"
          icon={Building2}
          label={t('dashboard.tile_branches')}
          value={count(branches.data)}
          testId="tile-branches"
        />
        <Tile
          to="/admin/users"
          icon={Users}
          label={t('dashboard.tile_users')}
          value={count(users.data)}
          testId="tile-users"
        />
        <Tile
          to="/admin/exchange-rates"
          icon={Coins}
          label={t('dashboard.tile_rate')}
          value={
            today.isPending ? null : t(today.rate ? 'dashboard.rate_set' : 'dashboard.rate_missing')
          }
          tone={today.isPending ? 'default' : today.rate ? 'ok' : 'bad'}
          testId="tile-rate"
        />
        <Tile
          to="/admin/statement-lines"
          icon={ListOrdered}
          label={t('dashboard.tile_lines')}
          value={lines.data ? d(lines.data.filter((l) => l.is_active).length) : null}
          testId="tile-lines"
        />
      </div>
    </section>
  );
}
