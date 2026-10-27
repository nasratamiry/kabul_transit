import { useQuery } from '@tanstack/react-query';
import { FileWarning } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Tile } from '@/components/admin/Tile';
import { useApi } from '@/lib/api';
import { useDigitLocale } from '@/lib/digits';
import { TX_KEY } from '@/lib/transactionSections';
import type { Paginated, Transaction } from '@/types/api';

/**
 * «معاملات با سند ناقص»: transactions of any date that still lack a document their branch
 * requires (all branches for the super admin, the manager's own otherwise — API scoping).
 * Under the transactions query prefix, so an upload or a matrix change refreshes it.
 */
export function MissingDocumentsTile(): JSX.Element {
  const { t } = useTranslation();
  const api = useApi();
  const d = useDigitLocale();
  const params = { missing_documents: true, page_size: 1 };
  const data = useQuery({
    queryKey: [...TX_KEY, 'missing-tile', params],
    queryFn: () => api.get<Paginated<Transaction>>('/transactions/', { params }),
  });
  const count = data.data?.count;
  return (
    <Tile
      to="/documents?tab=missing"
      icon={FileWarning}
      label={t('dashboard.tile_missing_documents')}
      value={count === undefined ? null : d(count)}
      tone={count === undefined ? 'default' : count > 0 ? 'bad' : 'ok'}
      testId="tile-missing-documents"
    />
  );
}
