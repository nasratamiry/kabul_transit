import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Pencil, Plus, Trash2 } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useLocation, useMatch, useNavigate, useSearchParams } from 'react-router-dom';
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
import { cn } from '@/lib/cn';
import { toShamsiKey, todayShamsi } from '@/lib/date';
import { isolateLtr, normalizeNumber, useDigitLocale } from '@/lib/digits';
import {
  CATEGORIES,
  OFFICE_KEY,
  PAGE_SIZE,
  isMoney,
  money,
  useBranches,
  useFinanceFilters,
  useFinanceSave,
  useRateLock,
} from '@/lib/finance';
import { toastError, useChoices, useDelete, useItem } from '@/lib/hooks';
import { formatRate } from '@/lib/money';
import { useAuth } from '@/stores/auth';
import type { OfficeExpense, OfficeExpenseTotals, PaginatedWithTotals } from '@/types/api';

const BASE = '/finance/office-expenses';
const ENDPOINT = '/office-expenses/';
type OfficePageData = PaginatedWithTotals<OfficeExpense, OfficeExpenseTotals>;

/**
 * /finance/office-expenses — both roles, branch-scoped by the API. The summary strip splits
 * the filtered set the way the income statement does: OPEX_SALARY vs OPEX_OFFICE.
 */
export function OfficeExpensesPage(): JSX.Element {
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

  const list = useQuery({
    queryKey: [...OFFICE_KEY, filters.query],
    queryFn: () => api.get<OfficePageData>(ENDPOINT, { params: filters.query }),
    placeholderData: (prev) => prev,
  });
  const remove = useDelete((id) => `${ENDPOINT}${id}/`, [[...OFFICE_KEY]], { success: false });
  const goList = (): void => navigate(`${BASE}${search}`);
  const totals = list.data?.totals;
  const category = (c: string): string => t(`office_expenses.categories.${c}`);

  async function onDelete(row: OfficeExpense): Promise<void> {
    const ok = await confirm({
      title: t('office_expenses.delete_confirm_title', { name: category(row.category) }),
      message: t('office_expenses.delete_confirm'),
      variant: 'danger',
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(row.id);
      toast.success(t('office_expenses.deleted'));
    } catch {
      /* the backend's message is already toasted */
    }
  }

  const columns: Column<OfficeExpense>[] = [
    { key: 'date', header: t('finance.date'), cell: (r) => <DualDateCell date={r.date} /> },
    ...(isSuperAdmin
      ? [
          {
            key: 'branch',
            header: t('finance.branch'),
            cell: (r: OfficeExpense) => branchName(r.branch),
          },
        ]
      : []),
    {
      key: 'category',
      header: t('office_expenses.category'),
      cell: (r) => (
        <Badge
          tone={r.category === 'SALARY' ? 'neutral' : 'brand'}
          // Salary stands out (its own income-statement line); orange-900 on orange-100 for contrast.
          className={cn(
            r.category === 'SALARY' &&
              'bg-orange-100 text-orange-900 dark:bg-orange-900/50 dark:text-orange-200',
          )}
          data-testid="category"
        >
          {category(r.category)}
        </Badge>
      ),
    },
    {
      key: 'person',
      header: t('office_expenses.person'),
      cell: (r) => (
        <span className="flex flex-col leading-tight">
          <span>{r.person || '—'}</span>
          {r.bill_number && (
            <span className="text-xs text-gray-500" dir="ltr">
              #{r.bill_number}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'amount',
      header: t('office_expenses.amount'),
      align: 'end',
      cell: (r) => (
        <span className="tabular-nums" data-testid="amount">
          {money(r.amount, r.currency, i18n.language)}
        </span>
      ),
    },
    {
      key: 'rate_used',
      header: t('finance.rate_used'),
      align: 'end',
      cell: (r) => (
        <span className="tabular-nums" data-testid="rate-used">
          {r.currency === 'AFN' ? '—' : formatRate(r.rate_used, i18n.language)}
        </span>
      ),
    },
    {
      key: 'amount_afn',
      header: t('finance.afn_equivalent'),
      align: 'end',
      cell: (r) => (
        <span className="tabular-nums" data-testid="amount-afn">
          {money(r.amount_afn, 'AFN', i18n.language)}
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
        title={t('office_expenses.title')}
        description={t('office_expenses.description')}
        action={
          <Button onClick={() => navigate(`${BASE}/new${search}`)} data-testid="add-record">
            <Plus className="h-4 w-4" />
            {t('office_expenses.add_button')}
          </Button>
        }
      />
      <FinanceFilterBar
        filters={filters}
        endpoint={ENDPOINT}
        searchPlaceholder={t('office_expenses.search_placeholder')}
      >
        <Select
          value={filters.get('category')}
          onChange={(e) => filters.setFilter('category', e.target.value)}
          aria-label={t('office_expenses.category')}
          placeholder={t('office_expenses.all_categories')}
          options={CATEGORIES.map((c) => ({ value: c, label: category(c) }))}
          data-testid="filter-category"
        />
      </FinanceFilterBar>

      {totals && (
        <section
          aria-label={t('office_expenses.summary_title')}
          className="mb-4"
          data-testid="category-summary"
        >
          <h2 className="mb-2 text-sm font-semibold text-gray-600 dark:text-gray-300">
            {t('office_expenses.summary_title')}
          </h2>
          <div className="flex flex-wrap gap-2">
            <SummaryChip
              label={t('office_expenses.salary')}
              afn={totals.salary.afn}
              usd={totals.salary.usd}
              tone="salary"
              testId="summary-salary"
            />
            <SummaryChip
              label={t('office_expenses.non_salary')}
              afn={totals.non_salary.afn}
              usd={totals.non_salary.usd}
              tone="strong"
              testId="summary-non-salary"
            />
            {CATEGORIES.filter((c) => c !== 'SALARY' && totals.groups[c]).map((c) => (
              <SummaryChip
                key={c}
                label={category(c)}
                afn={totals.groups[c]?.afn ?? null}
                usd={totals.groups[c]?.usd ?? null}
                testId={`summary-${c}`}
              />
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
        caption={t('office_expenses.title')}
        emptyMessage={t('office_expenses.no_results')}
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
                    {money(value, cur, i18n.language)}
                  </span>
                ))}
                {!Object.keys(totals.by_currency).length && '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500 dark:text-gray-400">
                {t('office_expenses.total')}
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
      {isNew && <ExpenseDrawer onClose={goList} />}
      {editId && <EditExpense id={editId} onClose={goList} />}
      {historyId && (
        <HistoryModal endpoint={ENDPOINT} id={historyId} ns="office_expenses" onClose={goList} />
      )}
    </>
  );
}

function SummaryChip({
  label,
  afn,
  usd,
  tone,
  testId,
}: {
  label: string;
  afn: string | null;
  usd: string | null;
  tone?: 'salary' | 'strong';
  testId: string;
}): JSX.Element {
  return (
    <div
      className={cn(
        'min-w-[9rem] rounded-lg border px-3 py-2',
        tone === 'salary' &&
          'border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-900/30',
        tone === 'strong' && 'border-brand/30 bg-brand-light dark:border-brand dark:bg-brand/30',
        !tone && 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
      )}
      data-testid={testId}
    >
      <span className="block text-xs text-gray-600 dark:text-gray-300">{label}</span>
      <AfnUsd afn={afn} usd={usd} testId={`${testId}-value`} />
    </div>
  );
}

function EditExpense({ id, onClose }: { id: number; onClose(): void }): JSX.Element {
  const { t } = useTranslation();
  const item = useItem<OfficeExpense>([...OFFICE_KEY, 'item'], `${ENDPOINT}${id}/`);
  if (!item.data) {
    return (
      <Drawer open onClose={onClose} title={t('office_expenses.edit_title')}>
        {item.isError ? (
          <p className="text-sm text-red-700 dark:text-red-400">{t('finance.not_found')}</p>
        ) : (
          <Spinner className="mx-auto h-6 w-6" />
        )}
      </Drawer>
    );
  }
  return <ExpenseDrawer row={item.data} onClose={onClose} />;
}

const schema = z.object({
  branch: z.string(),
  date: z.string().refine((v) => toShamsiKey(v) !== null, 'date.invalid'),
  category: z.string().min(1, 'common.required'),
  amount: z.string().refine(isMoney, 'finance.amount_invalid'),
  currency: z.string().min(1, 'common.required'),
  person: z.string().trim().max(120, 'partners.too_long'),
  bill_number: z.string().trim().max(60, 'partners.too_long'),
  description: z.string().max(2000, 'partners.too_long'),
});
type Values = z.infer<typeof schema>;

function ExpenseDrawer({ row, onClose }: { row?: OfficeExpense; onClose(): void }): JSX.Element {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const user = useAuth((s) => s.user);
  const isSuperAdmin = user?.role === 'super_admin';
  const { branches } = useBranches();
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
      bill_number: row?.bill_number ?? '',
      description: row?.description ?? '',
    },
  });
  const [date, currency] = useWatch({ control, name: ['date', 'currency'] });

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
      bill_number: v.bill_number.trim(),
      description: v.description,
    };
    try {
      await guard(async () => {
        await save<OfficeExpense>(row?.id ?? null, body);
        await qc.invalidateQueries({ queryKey: [...OFFICE_KEY] });
        toast.success(t(row ? 'office_expenses.updated' : 'office_expenses.created'));
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
      title={row ? t('office_expenses.edit_title') : t('office_expenses.add_button')}
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
          <FormField label={t('office_expenses.category')} error={err('category')} required>
            <Select
              {...register('category')}
              placeholder="—"
              options={CATEGORIES.map((c) => ({
                value: c,
                label: t(`office_expenses.categories.${c}`),
              }))}
              data-autofocus
              data-testid="field-category"
            />
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('office_expenses.amount')} error={err('amount')} required>
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
          <FormField label={t('office_expenses.person')} error={err('person')}>
            <Input {...register('person')} maxLength={120} data-testid="field-person" />
          </FormField>
          <FormField label={t('office_expenses.bill_number')} error={err('bill_number')}>
            <Input
              {...register('bill_number')}
              maxLength={60}
              dir="ltr"
              className="text-start"
              data-testid="field-bill_number"
            />
          </FormField>
        </div>
        <FormField label={t('office_expenses.description_field')} error={err('description')}>
          <Textarea
            {...register('description')}
            rows={3}
            maxLength={2000}
            data-testid="field-description"
          />
        </FormField>
      </div>
    </Drawer>
  );
}
