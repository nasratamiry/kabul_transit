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
  HAWALA_KEY,
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
import type { Hawala, HawalaTotals, PaginatedWithTotals } from '@/types/api';

const BASE = '/finance/hawala';
const ENDPOINT = '/hawala/';

type HawalaPageData = PaginatedWithTotals<Hawala, HawalaTotals>;

/**
 * /finance/hawala — both roles (a branch manager sees only their branch: API queryset).
 * Only the fee is an expense (OPEX_HAWALA_FEE); the amount is money moved.
 */
export function HawalaPage(): JSX.Element {
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
  const filters = useFinanceFilters(['currency']);
  const { name: branchName } = useBranches();

  const list = useQuery({
    queryKey: [...HAWALA_KEY, filters.query],
    queryFn: () => api.get<HawalaPageData>(ENDPOINT, { params: filters.query }),
    placeholderData: (prev) => prev,
  });
  const remove = useDelete((id) => `${ENDPOINT}${id}/`, [[...HAWALA_KEY]], { success: false });
  const goList = (): void => navigate(`${BASE}${search}`);
  const totals = list.data?.totals;

  async function onDelete(row: Hawala): Promise<void> {
    const ok = await confirm({
      title: t('hawala.delete_confirm_title', { name: `${row.from_party} ← ${row.to_party}` }),
      message: t('hawala.delete_confirm'),
      variant: 'danger',
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(row.id);
      toast.success(t('hawala.deleted'));
    } catch {
      /* the backend's message is already toasted */
    }
  }

  const columns: Column<Hawala>[] = [
    { key: 'date', header: t('finance.date'), cell: (r) => <DualDateCell date={r.date} /> },
    ...(isSuperAdmin
      ? [{ key: 'branch', header: t('finance.branch'), cell: (r: Hawala) => branchName(r.branch) }]
      : []),
    {
      key: 'parties',
      header: t('hawala.parties'),
      cell: (r) => (
        <span className="flex flex-col leading-tight">
          <span className="font-medium">{r.from_party}</span>
          <span className="text-xs text-gray-500">← {r.to_party}</span>
        </span>
      ),
    },
    {
      key: 'amount',
      header: t('hawala.amount'),
      align: 'end',
      cell: (r) => (
        <span className="tabular-nums" data-testid="amount">
          {money(r.amount, r.currency, i18n.language)}
        </span>
      ),
    },
    {
      key: 'fee',
      header: t('hawala.fee'),
      align: 'end',
      cell: (r) => (
        <span className="tabular-nums" data-testid="fee">
          {money(r.fee, r.currency, i18n.language)}
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
        title={t('hawala.title')}
        description={t('hawala.description')}
        action={
          <Button onClick={() => navigate(`${BASE}/new${search}`)} data-testid="add-record">
            <Plus className="h-4 w-4" />
            {t('hawala.add_button')}
          </Button>
        }
      />
      <FinanceFilterBar
        filters={filters}
        endpoint={ENDPOINT}
        searchPlaceholder={t('hawala.search_placeholder')}
      />
      <DataTable
        columns={columns}
        rows={list.data?.results}
        rowKey={(r) => r.id}
        onRowClick={(r) => navigate(`${BASE}/${r.id}/edit${search}`)}
        isLoading={list.isFetching && !list.data}
        caption={t('hawala.title')}
        emptyMessage={t('hawala.no_results')}
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
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-gray-500 dark:text-gray-400">
                {t('finance.by_currency')}
              </dt>
              <dd className="mt-1 space-y-0.5 tabular-nums" data-testid="totals-by-currency">
                {Object.entries(totals.amount.by_currency).map(([cur, value]) => (
                  <span key={cur} className="block" data-currency={cur}>
                    {money(value, cur, i18n.language)}
                  </span>
                ))}
                {!Object.keys(totals.amount.by_currency).length && '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500 dark:text-gray-400">
                {t('hawala.amount_total')}
              </dt>
              <dd className="mt-1">
                <AfnUsd afn={totals.amount.afn} usd={totals.amount.usd} testId="total-amount" />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500 dark:text-gray-400">{t('hawala.fee_total')}</dt>
              <dd className="mt-1">
                <AfnUsd afn={totals.fee.afn} usd={totals.fee.usd} testId="total-fee" />
              </dd>
            </div>
          </dl>
          {totals.amount.unconverted > 0 && (
            <p className="mt-3 text-xs text-amber-800 dark:text-amber-300" role="note">
              {t('finance.unconverted', { n: d(totals.amount.unconverted) })}
            </p>
          )}
        </Card>
      )}
      {isNew && <HawalaDrawer onClose={goList} />}
      {editId && <EditHawala id={editId} onClose={goList} />}
      {historyId && (
        <HistoryModal endpoint={ENDPOINT} id={historyId} ns="hawala" onClose={goList} />
      )}
    </>
  );
}

function EditHawala({ id, onClose }: { id: number; onClose(): void }): JSX.Element {
  const { t } = useTranslation();
  const item = useItem<Hawala>([...HAWALA_KEY, 'item'], `${ENDPOINT}${id}/`);
  if (!item.data) {
    return (
      <Drawer open onClose={onClose} title={t('hawala.edit_title')}>
        {item.isError ? (
          <p className="text-sm text-red-700 dark:text-red-400">{t('finance.not_found')}</p>
        ) : (
          <Spinner className="mx-auto h-6 w-6" />
        )}
      </Drawer>
    );
  }
  return <HawalaDrawer row={item.data} onClose={onClose} />;
}

const schema = z.object({
  branch: z.string(),
  date: z.string().refine((v) => toShamsiKey(v) !== null, 'date.invalid'),
  from_party: z.string().trim().min(1, 'common.required').max(120, 'partners.too_long'),
  to_party: z.string().trim().min(1, 'common.required').max(120, 'partners.too_long'),
  amount: z.string().refine(isMoney, 'finance.amount_invalid'),
  currency: z.string().min(1, 'common.required'),
  fee: z.string().refine((v) => !v.trim() || isMoney(v), 'finance.amount_invalid'),
  note: z.string().max(2000, 'partners.too_long'),
});
type Values = z.infer<typeof schema>;

function HawalaDrawer({ row, onClose }: { row?: Hawala; onClose(): void }): JSX.Element {
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
      from_party: row?.from_party ?? '',
      to_party: row?.to_party ?? '',
      amount: row?.amount ?? '',
      currency: row?.currency ?? 'USD',
      fee: row?.fee ?? '',
      note: row?.note ?? '',
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
      from_party: v.from_party.trim(),
      to_party: v.to_party.trim(),
      amount: normalizeNumber(v.amount),
      currency: v.currency,
      fee: normalizeNumber(v.fee) || '0',
      note: v.note,
    };
    try {
      await guard(async () => {
        await save<Hawala>(row?.id ?? null, body);
        await qc.invalidateQueries({ queryKey: [...HAWALA_KEY] });
        toast.success(t(row ? 'hawala.updated' : 'hawala.created'));
        onClose();
      });
    } catch (err) {
      const errors = fieldErrors(err);
      for (const [field, message] of Object.entries(errors))
        setError(field as keyof Values, { message });
      toastError(err);
    }
  }

  const err = (k: keyof Values): string | undefined => errors[k]?.message;
  return (
    <Drawer
      open
      onClose={onClose}
      title={row ? t('hawala.edit_title') : t('hawala.add_button')}
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
        <FormField label={t('finance.date')} error={err('date')} required>
          <DateInput {...register('date')} max={todayShamsi()} data-testid="field-date" />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('hawala.from_party')} error={err('from_party')} required>
            <Input
              {...register('from_party')}
              maxLength={120}
              data-autofocus
              data-testid="field-from_party"
            />
          </FormField>
          <FormField label={t('hawala.to_party')} error={err('to_party')} required>
            <Input {...register('to_party')} maxLength={120} data-testid="field-to_party" />
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('hawala.amount')} error={err('amount')} required>
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
        <FormField label={t('hawala.fee')} error={err('fee')}>
          <Input
            {...register('fee')}
            inputMode="decimal"
            dir="ltr"
            className="text-start"
            placeholder="0"
            data-testid="field-fee"
          />
        </FormField>
        <RateNote date={date} currency={currency} stored={row} />
        <FormField label={t('hawala.note')} error={err('note')}>
          <Textarea {...register('note')} rows={3} maxLength={2000} data-testid="field-note" />
        </FormField>
      </div>
    </Drawer>
  );
}
