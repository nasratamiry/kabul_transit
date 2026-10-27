import { useQuery } from '@tanstack/react-query';
import { FileWarning, Files, Search, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { DateInput } from '@/components/ui/DateInput';
import { Input } from '@/components/ui/Input';
import { Pagination } from '@/components/ui/Pagination';
import { Select } from '@/components/ui/Select';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dualDateTime, toGregorian, toShamsiKey } from '@/lib/date';
import { toDariDigits, useDigitLocale } from '@/lib/digits';
import { DOC_KEY, typeName, useDocumentTypes } from '@/lib/documents';
import { useBranches } from '@/lib/finance';
import { useDebounced } from '@/lib/hooks';
import { TRADE_TYPES, TX_KEY } from '@/lib/transactionSections';
import { TRADE_TONE } from '@/pages/transactions/tradeTone';
import { useAuth } from '@/stores/auth';
import type { Paginated, Transaction, TxDocument } from '@/types/api';

const PAGE_SIZE = 25;
const FILTERS = ['doc_type', 'search', 'date_from', 'date_to', 'trade_type', 'branch'];

/**
 * /documents — every document of the user's branch (super admin: all branches), searchable by
 * number, and the tab «معاملات با سند ناقص»: transactions that still lack a document their
 * branch requires. Filters live in the URL.
 */
export function DocumentsRegister(): JSX.Element {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const navigate = useNavigate();
  const d = useDigitLocale();
  const isSuperAdmin = useAuth((s) => s.user?.role === 'super_admin');
  const [params, setParams] = useSearchParams();
  const { active, name } = useDocumentTypes();
  const { branches, name: branchName } = useBranches();

  const get = (k: string): string => params.get(k) ?? '';
  const tab = get('tab') === 'missing' ? 'missing' : 'all';
  const page = Number(get('page')) || 1;
  const [searchText, setSearchText] = useState(get('search'));
  const debouncedSearch = useDebounced(searchText);

  const setFilter = useCallback(
    (key: string, value: string | number | null): void => {
      setParams(
        (p) => {
          if (value === null || value === '') p.delete(key);
          else p.set(key, String(value));
          if (key !== 'page') p.delete('page');
          return p;
        },
        { replace: key === 'search' },
      );
    },
    [setParams],
  );

  const urlSearch = params.get('search') ?? '';
  useEffect(() => {
    if (debouncedSearch === searchText && debouncedSearch !== urlSearch) {
      setFilter('search', debouncedSearch);
    }
  }, [debouncedSearch, searchText, urlSearch, setFilter]);

  const branch = isSuperAdmin ? get('branch') || undefined : undefined;
  const docQuery = {
    page,
    page_size: PAGE_SIZE,
    doc_type: get('doc_type') || undefined,
    search: get('search') || undefined,
    date_from: toShamsiKey(get('date_from')) ?? undefined,
    date_to: toShamsiKey(get('date_to')) ?? undefined,
    trade_type: get('trade_type') || undefined,
    branch,
  };
  const docs = useQuery({
    queryKey: [...DOC_KEY, 'register', docQuery],
    queryFn: () => api.get<Paginated<TxDocument>>('/documents/', { params: docQuery }),
    placeholderData: (prev) => prev, // both tabs show their count, so both lists load
  });
  const missingQuery = {
    page,
    page_size: PAGE_SIZE,
    missing_documents: true,
    trade_type: get('trade_type') || undefined,
    branch,
  };
  const missing = useQuery({
    queryKey: [...TX_KEY, 'missing-documents', missingQuery],
    queryFn: () => api.get<Paginated<Transaction>>('/transactions/', { params: missingQuery }),
    placeholderData: (prev) => prev,
  });

  const serialLink = (id: number, serial: string): JSX.Element => (
    <Link
      to={`/transactions/${id}#documents`}
      onClick={(e) => e.stopPropagation()}
      className="font-mono text-xs text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:text-emerald-300"
      dir="ltr"
      data-testid="tx-link"
    >
      {serial}
    </Link>
  );

  const docColumns: Column<TxDocument>[] = [
    {
      key: 'type',
      header: t('documents.type'),
      cell: (r) => <Badge tone="brand">{typeName(r.doc_type_names, i18n.language)}</Badge>,
    },
    {
      key: 'number',
      header: t('documents.number'),
      cell: (r) =>
        r.doc_number ? (
          <code className="font-mono text-xs" dir="ltr" data-testid="register-number">
            {r.doc_number}
          </code>
        ) : (
          '—'
        ),
    },
    {
      key: 'issue_date',
      header: t('documents.issue_date'),
      cell: (r) =>
        r.issue_date ? (
          <span className="flex flex-col leading-tight">
            <span>{toDariDigits(r.issue_date)}</span>
            <span className="text-xs text-gray-500" dir="ltr">
              {toGregorian(r.issue_date)}
            </span>
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'transaction',
      header: t('documents.transaction'),
      cell: (r) => serialLink(r.transaction_info.id, r.transaction_info.serial_number),
    },
    {
      key: 'trade_type',
      header: t('transactions.trade_type'),
      cell: (r) => (
        <Badge className={TRADE_TONE[r.transaction_info.trade_type]}>
          {t(`trade_types.${r.transaction_info.trade_type}`)}
        </Badge>
      ),
    },
    ...(isSuperAdmin
      ? [
          {
            key: 'branch',
            header: t('transactions.branch'),
            cell: (r: TxDocument) => r.transaction_info.branch_name,
          },
        ]
      : []),
    {
      key: 'uploaded',
      header: t('documents.uploaded_col'),
      cell: (r) => {
        const when = dualDateTime(r.uploaded_at);
        return (
          <span className="flex flex-col text-xs leading-tight">
            <span>{r.uploaded_by_name || r.uploaded_by_username || '—'}</span>
            <span className="text-gray-500">
              {when.shamsi} <span dir="ltr">({when.gregorian})</span>
            </span>
          </span>
        );
      },
    },
  ];

  const missingColumns: Column<Transaction>[] = [
    {
      key: 'date',
      header: t('transactions.date'),
      cell: (r) => (
        <span className="flex flex-col leading-tight">
          <span>{toDariDigits(r.date)}</span>
          <span className="text-xs text-gray-500" dir="ltr">
            {toGregorian(r.date)}
          </span>
        </span>
      ),
    },
    {
      key: 'serial',
      header: t('transactions.serial_number'),
      cell: (r) => serialLink(r.id, r.serial_number),
    },
    {
      key: 'trade_type',
      header: t('transactions.trade_type'),
      cell: (r) => (
        <Badge className={TRADE_TONE[r.trade_type]}>{t(`trade_types.${r.trade_type}`)}</Badge>
      ),
    },
    ...(isSuperAdmin
      ? [
          {
            key: 'branch',
            header: t('transactions.branch'),
            cell: (r: Transaction) => branchName(r.branch),
          },
        ]
      : []),
    {
      key: 'missing',
      header: t('documents.missing_types'),
      cell: (r) => (
        <span className="flex flex-wrap gap-1" data-testid="missing-types">
          {r.documents_status.missing.map((code) => (
            <Badge key={code} tone="danger">
              {name(code)}
            </Badge>
          ))}
        </span>
      ),
    },
    {
      key: 'count',
      header: t('transactions.documents'),
      align: 'center',
      cell: (r) => d(r.documents_count),
    },
  ];

  const tabButton = (key: 'all' | 'missing', label: string, count?: number): JSX.Element => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === key}
      onClick={() =>
        setParams((p) => {
          if (key === 'missing') p.set('tab', 'missing');
          else p.delete('tab');
          p.delete('page');
          return p;
        })
      }
      className={cn(
        '-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
        tab === key
          ? 'border-brand text-brand dark:border-emerald-300 dark:text-emerald-300'
          : 'border-transparent text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100',
      )}
      data-testid={`tab-${key}`}
    >
      {key === 'missing' ? (
        <FileWarning className="h-4 w-4" aria-hidden />
      ) : (
        <Files className="h-4 w-4" aria-hidden />
      )}
      {label}
      {count !== undefined && (
        <Badge
          tone={key === 'missing' && count > 0 ? 'danger' : 'neutral'}
          data-testid={`tab-${key}-count`}
        >
          {d(count)}
        </Badge>
      )}
    </button>
  );

  const anyFilter = FILTERS.some((k) => params.has(k));

  return (
    <>
      <PageHeader
        title={t('documents.register_title')}
        description={t('documents.register_description')}
      />

      <div role="tablist" className="mb-4 flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {tabButton('all', t('documents.tab_all'), docs.data?.count)}
        {tabButton('missing', t('documents.tab_missing'), missing.data?.count)}
      </div>

      <section
        aria-label={t('transactions.filters')}
        className="mb-4 grid gap-3 rounded-xl border border-gray-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4 dark:border-gray-700 dark:bg-gray-800"
      >
        {tab === 'all' && (
          <>
            <div className="relative sm:col-span-2">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                type="search"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder={t('documents.search_placeholder')}
                aria-label={t('documents.search_placeholder')}
                className="ps-9"
                data-testid="register-search"
              />
            </div>
            <Select
              value={get('doc_type')}
              onChange={(e) => setFilter('doc_type', e.target.value)}
              aria-label={t('documents.type')}
              placeholder={t('documents.all_types')}
              options={active.map((x) => ({ value: x.code, label: typeName(x, i18n.language) }))}
              data-testid="register-type"
            />
            <DateInput
              value={get('date_from')}
              onChange={(e) => setFilter('date_from', e.target.value)}
              aria-label={t('documents.issue_from')}
              placeholder={t('documents.issue_from')}
              showGregorian={false}
              data-testid="register-date-from"
            />
            <DateInput
              value={get('date_to')}
              onChange={(e) => setFilter('date_to', e.target.value)}
              aria-label={t('documents.issue_to')}
              placeholder={t('documents.issue_to')}
              showGregorian={false}
              data-testid="register-date-to"
            />
          </>
        )}
        <Select
          value={get('trade_type')}
          onChange={(e) => setFilter('trade_type', e.target.value)}
          aria-label={t('transactions.trade_type')}
          placeholder={t('transactions.all_trade_types')}
          options={TRADE_TYPES.map((tt) => ({ value: tt, label: t(`trade_types.${tt}`) }))}
          data-testid="register-trade-type"
        />
        {isSuperAdmin && (
          <Select
            value={get('branch')}
            onChange={(e) => setFilter('branch', e.target.value)}
            aria-label={t('transactions.branch')}
            placeholder={t('transactions.all_branches')}
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
            data-testid="register-branch"
          />
        )}
        <Button
          variant="ghost"
          onClick={() => {
            setSearchText('');
            setParams(tab === 'missing' ? { tab: 'missing' } : {});
          }}
          disabled={!anyFilter}
        >
          <X className="h-4 w-4" />
          {t('transactions.clear_filters')}
        </Button>
      </section>

      {tab === 'all' ? (
        <>
          <DataTable
            columns={docColumns}
            rows={docs.data?.results}
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/transactions/${r.transaction}#documents`)}
            isLoading={docs.isFetching && !docs.data}
            caption={t('documents.tab_all')}
            emptyMessage={t('documents.register_empty')}
          />
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={docs.data?.count ?? 0}
            onPage={(p) => setFilter('page', p === 1 ? null : p)}
          />
        </>
      ) : (
        <>
          <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
            {t('documents.missing_hint')}
          </p>
          <DataTable
            columns={missingColumns}
            rows={missing.data?.results}
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/transactions/${r.id}#documents`)}
            isLoading={missing.isFetching && !missing.data}
            caption={t('documents.tab_missing')}
            emptyMessage={t('documents.missing_empty')}
          />
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={missing.data?.count ?? 0}
            onPage={(p) => setFilter('page', p === 1 ? null : p)}
          />
        </>
      )}
    </>
  );
}
