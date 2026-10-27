import { zodResolver } from '@hookform/resolvers/zod';
import { Info, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMatch, useNavigate } from 'react-router';
import { z } from 'zod';

import { TodayRateBanner } from '@/components/admin/TodayRateBanner';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
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
import { fieldErrors } from '@/lib/api';
import { dualDateTime, toGregorian, toShamsiKey, todayShamsi } from '@/lib/date';
import { isolateLtr, normalizeNumber, toDariDigits } from '@/lib/digits';
import { useChoices, useCreate, useDelete, useList } from '@/lib/hooks';
import { formatRate } from '@/lib/money';
import { RATES_KEY } from '@/lib/rates';
import type { ExchangeRate, User } from '@/types/api';

const BASE = '/admin/exchange-rates';
const PAGE_SIZE = 25;

const schema = z.object({
  date: z.string().refine((v) => toShamsiKey(v) !== null, 'date.invalid'),
  currency: z.string().min(1, 'common.required'),
  rate: z
    .string()
    .transform(normalizeNumber)
    .refine((v) => /^\d{1,6}(\.\d{1,8})?$/.test(v) && Number(v) > 0, 'rates.rate_invalid'),
});

type FormInput = z.input<typeof schema>;
type FormValues = z.output<typeof schema>;

/** Typing R opens the create drawer — but never while the user is typing somewhere. */
function useShortcut(key: string, action: () => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent): void {
      const el = e.target as HTMLElement;
      const typing = el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
      if (typing || e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== key) return;
      e.preventDefault();
      action();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key, action, enabled]);
}

export function ExchangeRates(): JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const isNew = Boolean(useMatch(`${BASE}/new`));
  const openCreate = useMemo(() => () => navigate(`${BASE}/new`), [navigate]);
  useShortcut('r', openCreate, !isNew);

  const [filters, setFilters] = useState({ currency: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const { currency, from, to } = filters;
  // Any filter change starts again from page 1.
  const setFilter = (name: keyof typeof filters, value: string): void => {
    setFilters((f) => ({ ...f, [name]: value }));
    setPage(1);
  };
  const currencyChoices = useChoices('/exchange-rates/', 'currency');
  const currencies = (currencyChoices ?? []).map((c) => ({
    value: c.value,
    label: c.display_name,
  }));
  const list = useList<ExchangeRate>([...RATES_KEY], '/exchange-rates/', { currency });
  const users = useList<User>(['users'], '/users/');
  const userName = useMemo(
    () => new Map((users.data ?? []).map((u) => [u.id, u.full_name || u.username])),
    [users.data],
  );
  const remove = useDelete((id) => `/exchange-rates/${id}/`, [[...RATES_KEY]], {
    success: () => t('rates.deleted'),
  });

  // The API filters one exact date only, so the Shamsi range is applied here. Shamsi keys
  // are zero-padded 'YYYY-MM-DD', so string comparison is date order.
  const fromKey = from ? toShamsiKey(from) : null;
  const toKey = to ? toShamsiKey(to) : null;
  const rangeInvalid = Boolean(fromKey && toKey && fromKey > toKey);
  const rows = useMemo(
    () =>
      (list.data ?? []).filter(
        (r) => (!fromKey || r.date >= fromKey) && (!toKey || r.date <= toKey),
      ),
    [list.data, fromKey, toKey],
  );
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  async function onDelete(rate: ExchangeRate): Promise<void> {
    const ok = await confirm({
      title: t('rates.delete_confirm_title', {
        currency: rate.currency,
        date: isolateLtr(toDariDigits(rate.date)),
      }),
      message: t('rates.delete_confirm'),
      variant: 'warning',
      confirmLabel: t('common.delete'),
    });
    if (ok) await remove.mutateAsync(rate.id).catch(() => {});
  }

  const columns: Column<ExchangeRate>[] = [
    {
      key: 'date',
      header: t('rates.date'),
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
      key: 'currency',
      header: t('rates.currency'),
      cell: (r) => <span className="font-mono font-semibold">{r.currency}</span>,
    },
    {
      key: 'rate',
      header: t('rates.rate'),
      align: 'end',
      cell: (r) => (
        <span className="tabular-nums" dir="ltr" data-testid="rate-value">
          {formatRate(r.rate, i18n.language)}
        </span>
      ),
    },
    {
      key: 'created_by',
      header: t('rates.created_by'),
      cell: (r) => (r.created_by ? (userName.get(r.created_by) ?? `#${r.created_by}`) : '—'),
    },
    {
      key: 'created_at',
      header: t('rates.created_at'),
      cell: (r) => {
        const dt = dualDateTime(r.created_at);
        return (
          <span className="flex flex-col leading-tight">
            <span>{dt.shamsi}</span>
            <span className="text-xs text-gray-500" dir="ltr">
              {dt.gregorian}
            </span>
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('common.actions')}</span>,
      align: 'end',
      cell: (r) => (
        <IconButton label={t('common.delete')} tone="danger" onClick={() => void onDelete(r)}>
          <Trash2 className="h-4 w-4" />
        </IconButton>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('rates.title')}
        description={t('rates.description')}
        action={
          <Button
            onClick={openCreate}
            title={t('rates.shortcut_hint')}
            aria-keyshortcuts="R"
            data-testid="add-rate"
          >
            <Plus className="h-4 w-4" />
            {t('rates.add_button')}
            <kbd className="ms-1 rounded border border-white/40 px-1 font-mono text-[10px]">R</kbd>
          </Button>
        }
      />
      <TodayRateBanner onAdd={openCreate} className="mb-6" />
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <div className="w-44">
          <Select
            value={currency}
            onChange={(e) => setFilter('currency', e.target.value)}
            aria-label={t('rates.currency')}
            placeholder={t('rates.all_currencies')}
            options={currencies}
            data-testid="currency-filter"
          />
        </div>
        <div className="w-48">
          <DateInput
            value={from}
            onChange={(e) => setFilter('from', e.target.value)}
            aria-label={t('date.from')}
            placeholder={t('date.from')}
            invalid={rangeInvalid}
            data-testid="date-from"
          />
        </div>
        <div className="w-48">
          <DateInput
            value={to}
            onChange={(e) => setFilter('to', e.target.value)}
            aria-label={t('date.to')}
            placeholder={t('date.to')}
            invalid={rangeInvalid}
            data-testid="date-to"
          />
        </div>
        {rangeInvalid && <p className="pt-2 text-sm text-red-600">{t('rates.range_invalid')}</p>}
      </div>
      <DataTable
        columns={columns}
        rows={pageRows}
        rowKey={(r) => r.id}
        isLoading={list.isFetching && !list.data}
        emptyMessage={t('common.no_results')}
        caption={t('rates.title')}
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={rows.length} onPage={setPage} />
      <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <Info className="h-3.5 w-3.5" />
        {t('rates.immutable_note')}
      </p>
      {isNew &&
        (currencyChoices ? (
          <RateDrawer currencies={currencies} onClose={() => navigate(BASE)} />
        ) : (
          <Drawer open onClose={() => navigate(BASE)} title={t('rates.add_button')}>
            <Spinner className="mx-auto h-6 w-6" />
          </Drawer>
        ))}
    </>
  );
}

function RateDrawer({
  currencies,
  onClose,
}: {
  currencies: { value: string; label: string }[];
  onClose(): void;
}): JSX.Element {
  const { t } = useTranslation();
  const create = useCreate<ExchangeRate, FormValues>('/exchange-rates/', [[...RATES_KEY]], {
    success: (r) => t('rates.created', { date: isolateLtr(toDariDigits(r.date)) }),
  });
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(schema),
    // Defaults to today + USD: the rate the 428 soft lock waits for.
    defaultValues: { date: todayShamsi(), currency: 'USD', rate: '' },
  });

  async function onSubmit(values: FormValues): Promise<void> {
    try {
      await create.mutateAsync({ ...values, date: toShamsiKey(values.date) ?? values.date });
      onClose();
    } catch (err) {
      // Backend Dari messages: future date, AFN, duplicate (date, currency), rate <= 0.
      const errors = fieldErrors(err);
      for (const [field, message] of Object.entries(errors)) {
        const target = field === 'non_field_errors' ? 'date' : field;
        setError(target as keyof FormInput, { message });
      }
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t('rates.add_button')}
      description={t('rates.immutable_note')}
      onSubmit={(e) => void handleSubmit(onSubmit)(e)}
      submitting={create.isPending}
    >
      <FormField label={t('rates.date')} error={errors.date?.message} required>
        <DateInput {...register('date')} max={todayShamsi()} data-testid="rate-date" />
      </FormField>
      <FormField label={t('rates.currency')} error={errors.currency?.message} required>
        <Select {...register('currency')} options={currencies} data-testid="rate-currency" />
      </FormField>
      <FormField
        label={t('rates.rate')}
        error={errors.rate?.message}
        hint={t('rates.rate_hint')}
        required
      >
        <Input
          {...register('rate')}
          inputMode="decimal"
          placeholder="70.00"
          data-autofocus
          data-testid="rate-input"
        />
      </FormField>
    </Drawer>
  );
}
