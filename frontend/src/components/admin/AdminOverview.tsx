import { Building2, Coins, Handshake, ListOrdered, Truck, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useDigitLocale } from '@/lib/digits';
import { useList } from '@/lib/hooks';
import { useTodayUsdRate } from '@/lib/rates';
import type { Branch, StatementLine, Trader, TransportCompany, User } from '@/types/api';

import { OfficeMonthTile } from '../finance/OfficeMonthTile';

import { Tile } from './Tile';
import { TodayRateBanner } from './TodayRateBanner';

/** Super admin dashboard header: today's USD rate status + one tile per admin page. */
export function AdminOverview(): JSX.Element {
  const { t } = useTranslation();
  const d = useDigitLocale();
  const branches = useList<Branch>(['branches'], '/branches/');
  const users = useList<User>(['users'], '/users/');
  const lines = useList<StatementLine>(['statement-lines'], '/statement-lines/');
  const today = useTodayUsdRate();
  // Same query keys as the partner pages, so creating a trader refreshes the tile.
  const traders = useList<Trader>(['traders'], '/traders/', { is_active: true });
  const companies = useList<TransportCompany>(['transport_companies'], '/transport-companies/', {
    is_active: true,
  });

  const count = (rows: unknown[] | undefined): string | null => (rows ? d(rows.length) : null);

  return (
    <section className="mb-6 space-y-4" aria-label={t('nav.admin')}>
      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-500 dark:text-gray-400">
          {t('dashboard.rate_card_title')}
        </h2>
        <TodayRateBanner to="/admin/exchange-rates" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
        <Tile
          to="/partners/traders?is_active=true"
          icon={Handshake}
          label={t('dashboard.tile_traders')}
          value={count(traders.data)}
          testId="tile-traders"
        />
        <Tile
          to="/partners/transport-companies?is_active=true"
          icon={Truck}
          label={t('dashboard.tile_companies')}
          value={count(companies.data)}
          testId="tile-companies"
        />
        <OfficeMonthTile />
      </div>
    </section>
  );
}
