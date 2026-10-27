import { useQuery } from '@tanstack/react-query';
import { FileText, Pencil, Plus, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { TodayRateDialog } from '@/components/finance/TodayRateDialog';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { DateInput } from '@/components/ui/DateInput';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Pagination } from '@/components/ui/Pagination';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { Select } from '@/components/ui/Select';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/cn';
import { currentShamsiMonth, toGregorian, toShamsiKey } from '@/lib/date';
import { toDariDigits, useDigitLocale } from '@/lib/digits';
import { useDebounced, useList } from '@/lib/hooks';
import { formatMoney } from '@/lib/money';
import { useTodayUsdRate } from '@/lib/rates';
import { TRADE_TYPES, TX_KEY } from '@/lib/transactionSections';
import { useAuth } from '@/stores/auth';
import type { Branch, Paginated, Transaction } from '@/types/api';

import { TRADE_TONE } from './tradeTone';

const PAGE_SIZE = 25;

/** Filter state lives in the URL (bookmarks and the back button work); empty = default. */
const FILTERS = [
  'date_from',
  'date_to',
  'trade_type',
  'branch',
  'trader',
  'transport_company',
  'search',
  'has_documents',
];

export function TransactionsList(): JSX.Element {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const navigate = useNavigate();
  const d = useDigitLocale();
  const isSuperAdmin = useAuth((s) => s.user?.role === 'super_admin');
  const [params, setParams] = useSearchParams();
  const month = currentShamsiMonth();
  const [rateDialog, setRateDialog] = useState(false);

  const get = (k: string): string => params.get(k) ?? '';
  const dateFrom = get('date_from') || month.from;
  const dateTo = get('date_to') || month.to;
  const page = Number(get('page')) || 1;
  const highlight = Number(get('highlight')) || null;

  // The serial box is typed into, so it is debounced before it reaches the URL.
  const [searchText, setSearchText] = useState(get('search'));
  const debouncedSearch = useDebounced(searchText);

  const setFilter = useCallback(
    (key: string, value: string | number | null): void => {
      setParams(
        (p) => {
          if (value === null || value === '') p.delete(key);
          else p.set(key, String(value));
          if (key !== 'page' && key !== 'highlight') p.delete('page');
          return p;
        },
        { replace: key === 'search' || key === 'highlight' },
      );
    },
    [setParams],
  );

  const urlSearch = params.get('search') ?? '';
  useEffect(() => {
    if (debouncedSearch !== urlSearch) setFilter('search', debouncedSearch);
  }, [debouncedSearch, urlSearch, setFilter]);

  // A just-saved row stays highlighted for 3 seconds, then the param goes away.
  useEffect(() => {
    if (!highlight) return;
    const id = window.setTimeout(() => setFilter('highlight', null), 3000);
    return () => window.clearTimeout(id);
  }, [highlight, setFilter]);

  const query = {
    date_from: toShamsiKey(dateFrom) ?? month.from,
    date_to: toShamsiKey(dateTo) ?? month.to,
    trade_type: get('trade_type') || undefined,
    branch: isSuperAdmin ? get('branch') || undefined : undefined,
    trader: get('trader') || undefined,
    transport_company: get('transport_company') || undefined,
    search: get('search') || undefined,
    has_documents: get('has_documents') || undefined,
    page,
    page_size: PAGE_SIZE,
  };
  const list = useQuery({
    queryKey: [...TX_KEY, query],
    queryFn: () => api.get<Paginated<Transaction>>('/transactions/', { params: query }),
    placeholderData: (prev) => prev,
  });
  const branches = useList<Branch>(['branches'], '/branches/');
  const branchName = useMemo(
    () => new Map((branches.data ?? []).map((b) => [b.id, b.name])),
    [branches.data],
  );
  const today = useTodayUsdRate();
  const rateMissing = !today.isPending && !today.rate;
  const anyFilter = FILTERS.some((k) => params.has(k));

  const columns: Column<Transaction>[] = [
    {
      key: 'date',
      header: t('transactions.date'),
      cell: (r) => (
        <span className="flex flex-col leading-tight">
          <span className="font-medium">{toDariDigits(r.date)}</span>
          <span className="text-xs text-gray-500" dir="ltr">
            {toGregorian(r.date)}
          </span>
        </span>
      ),
    },
    {
      key: 'serial',
      header: t('transactions.serial_number'),
      cell: (r) => (
        <code className="font-mono text-xs" dir="ltr">
          {r.serial_number}
        </code>
      ),
    },
    {
      key: 'trade_type',
      header: t('transactions.trade_type'),
      cell: (r) => (
        <Badge className={TRADE_TONE[r.trade_type]} data-testid="trade-badge">
          {t(`trade_types.${r.trade_type}`)}
        </Badge>
      ),
    },
    ...(isSuperAdmin
      ? [
          {
            key: 'branch',
            header: t('transactions.branch'),
            cell: (r: Transaction) => branchName.get(r.branch) ?? '…',
          },
        ]
      : []),
    { key: 'trader', header: t('transactions.trader'), cell: (r) => r.trader_name ?? '—' },
    {
      key: 'plate',
      header: t('transactions.plate'),
      cell: (r) => <span dir="ltr">{r.plate_afghan || r.plate_foreign || '—'}</span>,
    },
    {
      key: 'customer_payment',
      header: t('transactions.customer_payment'),
      align: 'end',
      cell: (r) => (
        <span className="tabular-nums">
          {formatMoney(r.customer_payment, r.currency, i18n.language)}
        </span>
      ),
    },
    {
      key: 'profit',
      header: t('transactions.profit_loss'),
      align: 'end',
      cell: (r) => {
        const value = Number(r.row_summary.profit_or_loss_afn);
        return (
          <span
            data-testid="profit"
            className={cn(
              'font-medium tabular-nums',
              value > 0 && 'text-emerald-700 dark:text-emerald-400',
              value < 0 && 'text-red-700 dark:text-red-400',
            )}
          >
            {formatMoney(r.row_summary.profit_or_loss_afn, 'AFN', i18n.language)}
            {/* USD at the USD rate of the row's own date (also for AFN rows since stage 12b) */}
            <span
              className="block text-xs font-normal text-gray-500"
              dir="ltr"
              data-testid="profit-usd"
            >
              {r.row_summary.profit_or_loss_usd === null
                ? '$ —'
                : formatMoney(r.row_summary.profit_or_loss_usd, 'USD', i18n.language)}
            </span>
          </span>
        );
      },
    },
    {
      key: 'documents',
      header: t('transactions.documents'),
      align: 'center',
      cell: (r) => (
        <Link
          to={`/transactions/${r.id}#documents`}
          onClick={(e) => e.stopPropagation()}
          aria-label={`${t('transactions.documents')}: ${d(r.documents_count)}`}
          className="inline-flex items-center gap-1 rounded px-1 text-gray-600 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:text-gray-300"
          data-testid="documents-link"
        >
          <FileText className="h-3.5 w-3.5" aria-hidden />
          {d(r.documents_count)}
        </Link>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('common.actions')}</span>,
      align: 'end',
      cell: (r) => (
        <IconButton label={t('common.edit')} onClick={() => navigate(`/transactions/${r.id}/edit`)}>
          <Pencil className="h-4 w-4" />
        </IconButton>
      ),
    },
  ];

  const addButton = (
    <Button
      onClick={() => navigate('/transactions/new')}
      disabled={rateMissing}
      title={rateMissing ? t('transactions.no_rate_today_tooltip') : undefined}
      aria-describedby={rateMissing ? 'no-rate-hint' : undefined}
      data-testid="add-transaction"
    >
      <Plus className="h-4 w-4" />
      {t('transactions.add_button')}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t('transactions.title')}
        description={t('transactions.description')}
        action={
          <div className="flex flex-col items-end gap-1">
            {addButton}
            {rateMissing && (
              <p
                id="no-rate-hint"
                role="status"
                className="text-xs text-red-700 dark:text-red-400"
                data-testid="no-rate-hint"
              >
                {t('transactions.no_rate_today_tooltip')}
                {' — '}
                {isSuperAdmin ? (
                  <Link to="/admin/exchange-rates/new" className="font-medium underline">
                    {t('transactions.set_rate_link')}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRateDialog(true)}
                    className="font-medium underline"
                    data-testid="open-rate-dialog"
                  >
                    {t('transactions.set_rate_link')}
                  </button>
                )}
              </p>
            )}
          </div>
        }
      />

      <section
        aria-label={t('transactions.filters')}
        className="sticky top-16 z-10 -mx-1 mb-4 grid gap-3 rounded-xl border border-gray-200 bg-white/95 p-3 backdrop-blur sm:grid-cols-2 lg:grid-cols-4 dark:border-gray-700 dark:bg-gray-800/95"
      >
        <DateInput
          value={dateFrom}
          onChange={(e) => setFilter('date_from', e.target.value)}
          aria-label={t('transactions.date_from')}
          placeholder={t('transactions.date_from')}
          showGregorian={false}
          data-testid="filter-date-from"
        />
        <DateInput
          value={dateTo}
          onChange={(e) => setFilter('date_to', e.target.value)}
          aria-label={t('transactions.date_to')}
          placeholder={t('transactions.date_to')}
          showGregorian={false}
          data-testid="filter-date-to"
        />
        <Select
          value={get('trade_type')}
          onChange={(e) => setFilter('trade_type', e.target.value)}
          aria-label={t('transactions.trade_type')}
          placeholder={t('transactions.all_trade_types')}
          options={TRADE_TYPES.map((tt) => ({ value: tt, label: t(`trade_types.${tt}`) }))}
          data-testid="filter-trade-type"
        />
        {isSuperAdmin && (
          <Select
            value={get('branch')}
            onChange={(e) => setFilter('branch', e.target.value)}
            aria-label={t('transactions.branch')}
            placeholder={t('transactions.all_branches')}
            options={(branches.data ?? []).map((b) => ({ value: b.id, label: b.name }))}
            data-testid="filter-branch"
          />
        )}
        <SearchSelect
          endpoint="/traders/"
          value={Number(get('trader')) || null}
          onChange={(id) => setFilter('trader', id)}
          placeholder={`${t('transactions.trader')}: ${t('transactions.all')}`}
          aria-label={t('transactions.trader')}
          data-testid="filter-trader"
        />
        <SearchSelect
          endpoint="/transport-companies/"
          value={Number(get('transport_company')) || null}
          onChange={(id) => setFilter('transport_company', id)}
          placeholder={`${t('transactions.transport_company')}: ${t('transactions.all')}`}
          aria-label={t('transactions.transport_company')}
          data-testid="filter-company"
        />
        <Select
          value={get('has_documents')}
          onChange={(e) => setFilter('has_documents', e.target.value)}
          aria-label={t('transactions.documents_filter')}
          placeholder={t('transactions.documents_any')}
          options={[
            { value: 'true', label: t('transactions.documents_only') },
            { value: 'false', label: t('transactions.documents_none') },
          ]}
          data-testid="filter-documents"
        />
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            type="search"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder={t('transactions.serial_search')}
            aria-label={t('transactions.serial_search')}
            className="ps-9"
            data-testid="filter-search"
          />
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            setSearchText('');
            setParams({});
          }}
          disabled={!anyFilter}
          data-testid="clear-filters"
        >
          <X className="h-4 w-4" />
          {t('transactions.clear_filters')}
        </Button>
      </section>

      <DataTable
        columns={columns}
        rows={list.data?.results}
        rowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/transactions/${r.id}`)}
        isLoading={list.isFetching && !list.data}
        caption={t('transactions.title')}
        // kc-row-highlight is a stable marker for tests, next to the visible colour.
        rowClassName={(r) =>
          r.id === highlight &&
          'kc-row-highlight !bg-orange-100 font-semibold dark:!bg-orange-900/40'
        }
        emptyMessage={
          <span className="flex flex-col items-center gap-3">
            {t('transactions.no_results_in_period')}
            {!rateMissing && (
              <Button size="sm" onClick={() => navigate('/transactions/new')}>
                <Plus className="h-4 w-4" />
                {t('transactions.add_button')}
              </Button>
            )}
          </span>
        }
      />
      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={list.data?.count ?? 0}
        onPage={(p) => setFilter('page', p === 1 ? null : p)}
      />
      <TodayRateDialog open={rateDialog} onClose={() => setRateDialog(false)} />
    </>
  );
}
