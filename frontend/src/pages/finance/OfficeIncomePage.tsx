import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Pencil, Plus, Trash2 } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useLocation, useMatch, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';

import {
  AfnUsd,
  DualDateCell,
  FinanceFilterBar,
  HistoryModal,
  RateLockPanel,
  RateNote,
} from '@/components/finance/shared';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useConfirm } from '@/components/ui/confirm-context';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { DateInput } from '@/components/ui/DateInput';
import { Drawer } from '@/components/ui/Drawer';
import { FormField } from '@/components/ui/FormField';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Pagination } from '@/components/ui/Pagination';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { fieldErrors, useApi } from '@/lib/api';
import { toShamsiKey, todayShamsi } from '@/lib/date';
import { isolateLtr, normalizeNumber, useDigitLocale } from '@/lib/digits';
import {
  OFFICE_INCOME_KEY,
  PAGE_SIZE,
  isMoney,
  money,
  useBranches,
  useFinanceFilters,
  useFinanceSave,
  useIncomeCategories,
  useRateLock,
} from '@/lib/finance';
import { toastError, useChoices, useDelete, useItem } from '@/lib/hooks';
import { formatRate } from '@/lib/money';
import { DASHBOARD_KEY } from '@/lib/reports';
import { moneyName } from '@/lib/transactionSections';
import { useAuth } from '@/stores/auth';
import type { AmountTotals, OfficeIncome, PaginatedWithTotals } from '@/types/api';

const BASE = '/finance/office-income';
const ENDPOINT = '/office-incomes/';
type IncomePageData = PaginatedWithTotals<OfficeIncome, AmountTotals>;

/**
 * /finance/office-income — an office's own income (commission, storage, ...), both roles,
 * branch-scoped by the API. Each category is one «سایر عواید» line of the income statement;
 * the summary strip shows the filtered set per category, the same figures as the statement.
 */
export function OfficeIncomePage(): JSX.Element {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const navigate = useNavigate();
  const { search } = useLocation();
  const confirm = useConfirm();
  const d = useDigitLocale();
  const isSuperAdmin = useAuth((s) => s.user?.role === 'super_admin');
  const isNew = Boolean(useMatch(`${BASE}/new`));
  const editId = Number(useMatch(`${BASE}/:id/edit`)?.params.id) || null;
  const historyId = Number(useMatch(`${BASE}/:id/history`)?.params.id) || null;
  const filters = useFinanceFilters(['currency', 'category']);
  const { name: branchName } = useBranches();
  const { categories } = useIncomeCategories();
  const lang = i18n.language;

  const list = useQuery({
    queryKey: [...OFFICE_INCOME_KEY, filters.query],
    queryFn: () => api.get<IncomePageData>(ENDPOINT, { params: filters.query }),
    placeholderData: (prev) => prev,
  });
  const remove = useDelete((id) => `${ENDPOINT}${id}/`, [[...OFFICE_INCOME_KEY]], {
    success: false,
  });
  const goList = (): void => {
    void navigate(`${BASE}${search}`);
  };
  const totals = list.data?.totals;
  const categoryName = (code: string): string => {
    const c = categories.find((x) => x.code === code);
    return c ? moneyName({ fa: c.name_fa, ps: c.name_ps, en: c.name_en }, lang) : code;
  };

  async function onDelete(row: OfficeIncome): Promise<void> {
    const ok = await confirm({
      title: t('office_income.delete_confirm_title', { name: moneyName(row.category_names, lang) }),
      message: t('office_income.delete_confirm'),
      variant: 'danger',
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(row.id);
      toast.success(t('office_income.deleted'));
    } catch {
      /* the backend's message is already toasted */
    }
  }

  const columns: Column<OfficeIncome>[] = [
    { key: 'date', header: t('finance.date'), cell: (r) => <DualDateCell date={r.date} /> },
    ...(isSuperAdmin
      ? [
          {
            key: 'branch',
            header: t('finance.branch'),
            cell: (r: OfficeIncome) => branchName(r.branch),
          },
        ]
      : []),
    {
      key: 'category',
      header: t('office_income.category'),
      cell: (r) => (
        <Badge tone="brand" data-testid="category">
          {moneyName(r.category_names, lang)}
        </Badge>
      ),
    },
    {
      key: 'person',
      header: t('office_income.person'),
      cell: (r) => (
        <span className="flex flex-col leading-tight">
          <span>{r.person || '—'}</span>
          {r.reference_number && (
            <span className="text-xs text-gray-500" dir="ltr">
              #{r.reference_number}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'amount',
      header: t('office_income.amount'),
      align: 'end',
      cell: (r) => (
        <span className="tabular-nums" data-testid="amount">
          {money(r.amount, r.currency, lang)}
        </span>
      ),
    },
    {
      key: 'rate_used',
      header: t('finance.rate_used'),
      align: 'end',
      cell: (r) => (
        <span className="tabular-nums" data-testid="rate-used">
          {r.currency === 'AFN' ? '—' : formatRate(r.rate_used, lang)}
        </span>
      ),
    },
    {
      key: 'amount_afn',
      header: t('finance.afn_equivalent'),
      align: 'end',
      cell: (r) => (
        <span className="tabular-nums" data-testid="amount-afn">
          {money(r.amount_afn, 'AFN', lang)}
        </span>
      ),
    },
    { key: 'created_by', header: t('finance.created_by'), cell: (r) => r.created_by_name || '—' },
    {
      key: 'actions',
      header: <span className="sr-only">{t('common.actions')}</span>,
      align: 'end',
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <IconButton
            label={t('finance.history')}
            onClick={() => navigate(`${BASE}/${r.id}/history${search}`)}
            data-testid="history-button"
          >
            <History className="h-4 w-4" />
          </IconButton>
          <IconButton
            label={t('common.edit')}
            onClick={() => navigate(`${BASE}/${r.id}/edit${search}`)}
          >
            <Pencil className="h-4 w-4" />
          </IconButton>
          <IconButton
            label={t('common.delete')}
            tone="danger"
            onClick={() => void onDelete(r)}
            data-testid="delete-button"
          >
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('office_income.title')}
        description={t('office_income.description')}
        action={
          <Button onClick={() => navigate(`${BASE}/new${search}`)} data-testid="add-record">
            <Plus className="h-4 w-4" />
            {t('office_income.add_button')}
          </Button>
        }
      />
      <FinanceFilterBar
        filters={filters}
        endpoint={ENDPOINT}
        searchPlaceholder={t('office_income.search_placeholder')}
      >
        <Select
          value={filters.get('category')}
          onChange={(e) => filters.setFilter('category', e.target.value)}
          aria-label={t('office_income.category')}
          placeholder={t('office_income.all_categories')}
          options={categories.map((c) => ({ value: c.code, label: categoryName(c.code) }))}
          data-testid="filter-category"
        />
      </FinanceFilterBar>

      {totals && (
        <section
          aria-label={t('office_income.summary_title')}
          className="mb-4"
          data-testid="category-summary"
        >
          <h2 className="mb-2 text-sm font-semibold text-gray-600 dark:text-gray-300">
            {t('office_income.summary_title')}
          </h2>
          <div className="flex flex-wrap gap-2">
            <div
              className="min-w-[9rem] rounded-lg border border-brand/30 bg-brand-light px-3 py-2 dark:border-brand dark:bg-brand/30"
              data-testid="summary-all"
            >
              <span className="block text-xs text-gray-600 dark:text-gray-300">
                {t('office_income.total')}
              </span>
              <AfnUsd afn={totals.afn} usd={totals.usd} testId="summary-all-value" />
            </div>
            {Object.entries(totals.groups).map(([code, value]) => (
              <div
                key={code}
                className="min-w-[9rem] rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-800"
                data-testid={`summary-${code}`}
              >
                <span className="block text-xs text-gray-600 dark:text-gray-300">
                  {categoryName(code)}
                </span>
                <AfnUsd afn={value.afn} usd={value.usd} testId={`summary-${code}-value`} />
              </div>
            ))}
          </div>
        </section>
      )}

      <DataTable
        columns={columns}
        rows={list.data?.results}
        rowKey={(r) => r.id}
        onRowClick={(r) => navigate(`${BASE}/${r.id}/edit${search}`)}
        isLoading={list.isFetching && !list.data}
        caption={t('office_income.title')}
        emptyMessage={t('office_income.no_results')}
      />
      <Pagination
        page={filters.page}
        pageSize={PAGE_SIZE}
        total={list.data?.count ?? 0}
        onPage={(p) => filters.setFilter('page', p === 1 ? null : p)}
      />
      {totals && (
        <Card className="mt-4 p-4" data-testid="totals">
          <h2 className="mb-3 text-sm font-semibold text-gray-600 dark:text-gray-300">
            {t('finance.totals_title')} —{' '}
            <span data-testid="totals-count">
              {t('finance.records', { n: d(list.data?.count ?? 0) })}
            </span>
          </h2>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-gray-500 dark:text-gray-400">
                {t('finance.by_currency')}
              </dt>
              <dd className="mt-1 space-y-0.5 tabular-nums" data-testid="totals-by-currency">
                {Object.entries(totals.by_currency).map(([cur, value]) => (
                  <span key={cur} className="block" data-currency={cur}>
                    {money(value, cur, lang)}
                  </span>
                ))}
                {!Object.keys(totals.by_currency).length && '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500 dark:text-gray-400">
                {t('office_income.total')}
              </dt>
              <dd className="mt-1">
                <AfnUsd afn={totals.afn} usd={totals.usd} testId="total-amount" />
              </dd>
            </div>
          </dl>
          {totals.unconverted > 0 && (
            <p className="mt-3 text-xs text-amber-800 dark:text-amber-300" role="note">
              {t('finance.unconverted', { n: d(totals.unconverted) })}
            </p>
          )}
        </Card>
      )}
      {isNew && <IncomeDrawer onClose={goList} />}
      {editId && <EditIncome id={editId} onClose={goList} />}
      {historyId && (
        <HistoryModal endpoint={ENDPOINT} id={historyId} ns="office_income" onClose={goList} />
      )}
    </>
  );
}

function EditIncome({ id, onClose }: { id: number; onClose(): void }): JSX.Element {
  const { t } = useTranslation();
  const item = useItem<OfficeIncome>([...OFFICE_INCOME_KEY, 'item'], `${ENDPOINT}${id}/`);
  if (!item.data) {
    return (
      <Drawer open onClose={onClose} title={t('office_income.edit_title')}>
        {item.isError ? (
          <p className="text-sm text-red-700 dark:text-red-400">{t('finance.not_found')}</p>
        ) : (
          <Spinner className="mx-auto h-6 w-6" />
        )}
      </Drawer>
    );
  }
  return <IncomeDrawer row={item.data} onClose={onClose} />;
}

const schema = z.object({
  branch: z.string(),
  date: z.string().refine((v) => toShamsiKey(v) !== null, 'date.invalid'),
  category: z.string().min(1, 'common.required'),
  amount: z.string().refine(isMoney, 'finance.amount_invalid'),
  currency: z.string().min(1, 'common.required'),
  person: z.string().trim().max(120, 'partners.too_long'),
  reference_number: z.string().trim().max(60, 'partners.too_long'),
  note: z.string().max(2000, 'partners.too_long'),
});
type Values = z.infer<typeof schema>;

function IncomeDrawer({ row, onClose }: { row?: OfficeIncome; onClose(): void }): JSX.Element {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const user = useAuth((s) => s.user);
  const isSuperAdmin = user?.role === 'super_admin';
  const { branches } = useBranches();
  const { categories } = useIncomeCategories();
  const currencies = useChoices(ENDPOINT, 'currency');
  const save = useFinanceSave(ENDPOINT);
  const { guard, blocked, unblock } = useRateLock();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      branch: String(row?.branch ?? params.get('branch') ?? ''),
      date: row?.date ?? todayShamsi(),
      category: row?.category ?? params.get('category') ?? '',
      amount: row?.amount ?? '',
      currency: row?.currency ?? 'AFN',
      person: row?.person ?? '',
      reference_number: row?.reference_number ?? '',
      note: row?.note ?? '',
    },
  });
  const [date, currency] = useWatch({ control, name: ['date', 'currency'] });
  // Active categories, plus this record's own one if it was deactivated since.
  const options = categories.filter((c) => c.is_active || c.code === row?.category);

  async function onSubmit(v: Values): Promise<void> {
    const branch = isSuperAdmin ? Number(v.branch) : user?.branch_id;
    if (!branch) {
      setError('branch', { message: 'finance.branch_required' });
      return;
    }
    const body = {
      branch,
      date: toShamsiKey(v.date),
      category: v.category,
      amount: normalizeNumber(v.amount),
      currency: v.currency,
      person: v.person.trim(),
      reference_number: v.reference_number.trim(),
      note: v.note,
    };
    try {
      await guard(async () => {
        await save<OfficeIncome>(row?.id ?? null, body);
        await qc.invalidateQueries({ queryKey: [...OFFICE_INCOME_KEY] });
        await qc.invalidateQueries({ queryKey: [...DASHBOARD_KEY] });
        toast.success(t(row ? 'office_income.updated' : 'office_income.created'));
        onClose();
      });
    } catch (err) {
      for (const [field, message] of Object.entries(fieldErrors(err)))
        setError(field as keyof Values, { message });
      toastError(err);
    }
  }

  const err = (k: keyof Values): string | undefined => errors[k]?.message;
  return (
    <Drawer
      open
      onClose={onClose}
      title={row ? t('office_income.edit_title') : t('office_income.add_button')}
      description={row ? isolateLtr(row.date) : undefined}
      onSubmit={(e) => void handleSubmit(onSubmit)(e)}
      submitting={isSubmitting}
    >
      <div data-testid="record-form" className="space-y-4">
        <RateLockPanel
          blocked={blocked}
          onRateSaved={() => {
            unblock();
            void handleSubmit(onSubmit)();
          }}
        />
        {isSuperAdmin && (
          <FormField label={t('finance.branch')} error={err('branch')} required>
            <Select
              {...register('branch')}
              placeholder="—"
              options={branches.map((b) => ({ value: b.id, label: b.name }))}
              data-testid="field-branch"
            />
          </FormField>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('finance.date')} error={err('date')} required>
            <DateInput {...register('date')} max={todayShamsi()} data-testid="field-date" />
          </FormField>
          <FormField label={t('office_income.category')} error={err('category')} required>
            <Select
              {...register('category')}
              placeholder="—"
              options={options.map((c) => ({
                value: c.code,
                label: moneyName({ fa: c.name_fa, ps: c.name_ps, en: c.name_en }, i18n.language),
              }))}
              data-autofocus
              data-testid="field-category"
            />
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('office_income.amount')} error={err('amount')} required>
            <Input
              {...register('amount')}
              inputMode="decimal"
              dir="ltr"
              className="text-start"
              data-testid="field-amount"
            />
          </FormField>
          <FormField label={t('finance.currency')} error={err('currency')} required>
            {currencies ? (
              <Select
                {...register('currency')}
                options={currencies.map((c) => ({
                  value: c.value,
                  label: t(`currencies.${c.value}`),
                }))}
                data-testid="field-currency"
              />
            ) : (
              <Spinner className="h-5 w-5" />
            )}
          </FormField>
        </div>
        <RateNote date={date} currency={currency} stored={row} />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('office_income.person')} error={err('person')}>
            <Input {...register('person')} maxLength={120} data-testid="field-person" />
          </FormField>
          <FormField label={t('office_income.reference_number')} error={err('reference_number')}>
            <Input
              {...register('reference_number')}
              maxLength={60}
              dir="ltr"
              className="text-start"
              data-testid="field-reference_number"
            />
          </FormField>
        </div>
        <FormField label={t('office_income.note')} error={err('note')}>
          <Textarea {...register('note')} rows={3} maxLength={2000} data-testid="field-note" />
        </FormField>
      </div>
    </Drawer>
  );
}
