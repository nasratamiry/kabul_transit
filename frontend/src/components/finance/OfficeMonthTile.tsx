import { Wallet } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Tile } from '@/components/admin/Tile';
import { currentShamsiMonth } from '@/lib/date';
import { useApi } from '@/lib/api';
import { OFFICE_KEY } from '@/lib/finance';
import { formatMoney } from '@/lib/money';
import type { OfficeExpenseTotals, PaginatedWithTotals, OfficeExpense } from '@/types/api';
import { useQuery } from '@tanstack/react-query';

/**
 * «مصارف دفتر این ماه»: the AFN total of this Shamsi month's office expenses (salary
 * included), from the list's own totals block — all branches for the super admin, the
 * branch manager's own branch otherwise (API scoping). Shares the office-expenses query
 * prefix, so saving an expense refreshes it.
 */
export function OfficeMonthTile(): JSX.Element {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const month = currentShamsiMonth();
  const params = { date_from: month.from, date_to: month.to, page_size: 1 };
  const data = useQuery({
    queryKey: [...OFFICE_KEY, 'month-tile', params],
    queryFn: () =>
      api.get<PaginatedWithTotals<OfficeExpense, OfficeExpenseTotals>>('/office-expenses/', {
        params,
      }),
  });
  return (
    <Tile
      to="/finance/office-expenses"
      icon={Wallet}
      label={t('dashboard.tile_office_month')}
      value={data.data ? formatMoney(data.data.totals.afn ?? '0', 'AFN', i18n.language) : null}
      testId="tile-office-month"
    />
  );
}
