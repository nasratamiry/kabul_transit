import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useDigitLocale } from '@/lib/digits';

import { Button } from './Button';

interface PaginationProps {
  page: number; // 1-based
  pageSize: number;
  total: number;
  onPage(page: number): void;
}

export function Pagination({ page, pageSize, total, onPage }: PaginationProps): JSX.Element | null {
  const { t } = useTranslation();
  const d = useDigitLocale();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <nav
      aria-label={t('common.pagination')}
      className="mt-3 flex items-center justify-between gap-3 text-sm text-gray-600 dark:text-gray-400"
    >
      <span>{t('common.showing', { from: d(from), to: d(to), total: d(total) })}</span>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label={t('common.previous')}
        >
          <ChevronRight className="h-4 w-4 ltr:rotate-180" />
        </Button>
        <span className="px-2">
          {d(page)} / {d(pages)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          aria-label={t('common.next')}
        >
          <ChevronLeft className="h-4 w-4 ltr:rotate-180" />
        </Button>
      </div>
    </nav>
  );
}
