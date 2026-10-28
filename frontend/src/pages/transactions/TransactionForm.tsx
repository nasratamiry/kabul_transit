import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { AlertTriangle, ArrowRight, Save, ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm, useWatch, type Control, type UseFormRegister } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { z } from 'zod';

import { TodayRateDialog } from '@/components/finance/TodayRateDialog';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useConfirm } from '@/components/ui/confirm-context';
import { DateInput } from '@/components/ui/DateInput';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Switch } from '@/components/ui/Switch';
import { Textarea } from '@/components/ui/Textarea';
import { fieldErrors, useApi } from '@/lib/api';
import { cn } from '@/lib/cn';
import { toShamsiKey, todayShamsi } from '@/lib/date';
import { isolateLtr, normalizeNumber } from '@/lib/digits';
import { clearDraft, loadDraft, saveDraft } from '@/lib/drafts';
import { toastError, useDebounced } from '@/lib/hooks';
import { formatMoney, formatRate } from '@/lib/money';
import { useDayRate } from '@/lib/rates';
import {
  FIELD_TYPES,
  FK_TARGETS,
  MAX_LENGTH,
  MONEY_SECTIONS,
  SECTIONS,
  TRADE_TYPES,
  TX_KEY,
  fieldType,
  isLineField,
  lineCode,
  moneyName,
  type TradeType,
} from '@/lib/transactionSections';
import { useAuth } from '@/stores/auth';
import type { FormConfig, PreviewSummary, Transaction } from '@/types/api';

type Values = Record<string, string | number | boolean | null>;
type ConfigField = FormConfig['form_fields'][number];

const CURRENCIES = ['AFN', 'USD', 'PKR', 'EUR', 'IRR'] as const;
const STATUSES = ['WAITING', 'SEALED', 'EXITED'] as const;
const MONEY = /^-?\d{1,12}(\.\d{1,2})?$/;
const RATE = /^\d{1,6}(\.\d{1,8})?$/;

/** '70.00000000' → '70', '0.00028571' stays: rates are shown as typed, not padded. */
const trimRate = (rate: string): string => rate.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');

/**
 * /transactions/new/:tradeType and /transactions/:id/edit. Loads the record (edit) and the
 * branch's form config, then renders <FormBody>. Which fields appear, required or not, and
 * in what order comes from /api/form-config/; how each is edited and its section comes from
 * lib/transactionSections.ts — except revenue / expense amounts, whose section is their kind.
 */
export function TransactionForm(): JSX.Element {
  const { t } = useTranslation();
  const api = useApi();
  const { id, tradeType: tradeParam } = useParams();
  const [params] = useSearchParams();
  const user = useAuth((s) => s.user);
  const isEdit = Boolean(id);

  const tx = useQuery({
    queryKey: [...TX_KEY, 'item', id],
    queryFn: () => api.get<Transaction>(`/transactions/${id}/`, { skipErrorToast: true }),
    enabled: isEdit,
    retry: false,
  });
  const branch = isEdit
    ? (tx.data?.branch ?? null)
    : user?.role === 'super_admin'
      ? Number(params.get('branch')) || null
      : (user?.branch_id ?? null);
  const tradeType = (isEdit ? tx.data?.trade_type : tradeParam) as TradeType | undefined;

  const config = useQuery({
    queryKey: ['form-config', branch, tradeType],
    queryFn: () =>
      api.get<FormConfig>('/form-config/', { params: { branch, trade_type: tradeType } }),
    enabled: Boolean(branch && tradeType && TRADE_TYPES.includes(tradeType)),
    staleTime: 60_000,
  });

  if (isEdit && tx.isError) return <NotAvailable />;
  if (!isEdit && (!tradeType || !TRADE_TYPES.includes(tradeType))) {
    return <Navigate to="/transactions/new" replace />;
  }
  if (!isEdit && !branch) return <Navigate to="/transactions/new" replace />;
  if ((isEdit && !tx.data) || !config.data || !branch || !tradeType) {
    return (
      <div className="flex justify-center py-20" aria-label={t('common.loading')}>
        <Spinner className="h-8 w-8" />
      </div>
    );
  }
  return (
    <FormBody
      key={id ?? `${branch}-${tradeType}`}
      config={config.data}
      tx={tx.data}
      branch={branch}
      tradeType={tradeType}
    />
  );
}

function NotAvailable(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-md py-16 text-center" data-testid="tx-not-available">
      <ShieldAlert className="mx-auto mb-4 h-12 w-12 text-accent" />
      <h1 className="mb-2 text-xl font-semibold">{t('errors.forbidden_title')}</h1>
      <p className="mb-6 text-gray-600 dark:text-gray-400">{t('transactions.not_found')}</p>
      <Link to="/transactions">
        <Button variant="secondary">{t('transactions.back_to_list')}</Button>
      </Link>
    </div>
  );
}

/** Values the form starts with: defaults ← saved record ← an unsaved draft ← a just-created partner. */
function initialValues(
  fields: string[],
  tx: Transaction | undefined,
  draft: Values | null,
  params: URLSearchParams,
): Values {
  const values: Values = {};
  for (const name of fields) {
    const type = fieldType(name);
    values[name] = type === 'fk' ? null : type === 'boolean' ? false : '';
  }
  // Set after the loop: currency / exchange_rate are always part of the form, shown or not.
  values.currency = 'AFN';
  values.exchange_rate = '';
  values.date = todayShamsi();
  if ('status' in values) values.status = 'WAITING';
  if (tx) {
    for (const name of Object.keys(values)) {
      if (isLineField(name)) {
        values[name] = tx.money_amounts[lineCode(name)] ?? '';
        continue;
      }
      const v = tx[name];
      if (v === undefined) continue;
      const type = fieldType(name);
      // The API returns some numbers as numbers (quantity); the inputs hold strings.
      values[name] =
        name === 'exchange_rate'
          ? trimRate(String(v))
          : type === 'fk' || type === 'boolean' || v === null
            ? (v as Values[string])
            : String(v);
    }
  }
  Object.assign(values, draft ?? {});
  // Back from «add new trader / transport company»: select the record just created.
  for (const [field, target] of Object.entries(FK_TARGETS)) {
    const created = Number(params.get(`new_${target.ns}`));
    if (created && field in values) values[field] = created;
  }
  return values;
}

/** Visible fields → zod schema. Messages are i18n keys (FormField translates them). */
function buildSchema(fields: ConfigField[]): z.ZodType<Values, Values> {
  const shape: Record<string, z.ZodType> = {
    currency: z.enum(CURRENCIES),
    exchange_rate: z.string(),
  };
  for (const f of fields) {
    const type = fieldType(f.field_name);
    const need = (s: z.ZodString): z.ZodString => (f.required ? s.min(1, 'common.required') : s);
    if (type === 'money' || type === 'decimal') {
      shape[f.field_name] = need(z.string().trim()).refine(
        (v) => v === '' || MONEY.test(normalizeNumber(v)),
        'transactions.number_invalid',
      );
    } else if (type === 'integer') {
      shape[f.field_name] = need(z.string().trim()).refine(
        (v) => v === '' || /^\d{1,9}$/.test(normalizeNumber(v)),
        'transactions.integer_invalid',
      );
    } else if (type === 'date') {
      shape[f.field_name] = z.string().refine((v) => toShamsiKey(v) !== null, 'date.invalid');
    } else if (type === 'fk') {
      shape[f.field_name] = f.required
        ? z.number({ message: 'common.required' })
        : z.number().nullable();
    } else if (type === 'boolean') {
      shape[f.field_name] = z.boolean();
    } else if (type === 'choice') {
      shape[f.field_name] = need(z.string());
    } else if (type !== 'rate') {
      shape[f.field_name] = need(z.string().trim()).pipe(
        z.string().max(MAX_LENGTH[f.field_name] ?? 2000, 'partners.too_long'),
      );
    }
  }
  return z.object(shape).superRefine((v, ctx) => {
    // AFN is always 1; any other currency needs its rate (whatever the config says).
    if (v.currency === 'AFN') return;
    const rate = normalizeNumber(String(v.exchange_rate ?? ''));
    if (!rate) {
      ctx.addIssue({
        code: 'custom',
        path: ['exchange_rate'],
        message: 'transactions.rate_required',
      });
    } else if (!RATE.test(rate) || Number(rate) <= 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['exchange_rate'],
        message: 'transactions.rate_invalid',
      });
    }
  }) as unknown as z.ZodType<Values, Values>;
}

/**
 * Form values → API body. Empty optional amounts are 0 (the model default), not ''. The
 * added types go together as money_amounts {code: amount} ('' = no amount).
 */
function toPayload(
  values: Values,
  fields: string[],
  branch: number,
  tradeType: TradeType,
): Record<string, unknown> {
  const body: Values = { branch, trade_type: tradeType };
  const amounts: Record<string, string> = {};
  for (const name of new Set([...fields, 'currency', 'exchange_rate'])) {
    const type = fieldType(name);
    const v = values[name];
    if (isLineField(name)) {
      amounts[lineCode(name)] = normalizeNumber(String(v ?? ''));
      continue;
    }
    if (type === 'money' || type === 'decimal' || type === 'integer' || type === 'rate') {
      const n = normalizeNumber(String(v ?? ''));
      body[name] = n === '' ? (type === 'rate' ? '1' : '0') : n;
    } else if (type === 'date') {
      body[name] = toShamsiKey(String(v)) ?? String(v);
    } else {
      body[name] = v ?? null;
    }
  }
  if (body.currency === 'AFN') body.exchange_rate = '1';
  return Object.keys(amounts).length ? { ...body, money_amounts: amounts } : body;
}

interface FormBodyProps {
  config: FormConfig;
  tx?: Transaction;
  branch: number;
  tradeType: TradeType;
}

function FormBody({ config, tx, branch, tradeType }: FormBodyProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const isSuperAdmin = useAuth((s) => s.user?.role === 'super_admin');

  const draftKey = tx ? `tx:edit:${tx.id}` : `tx:new:${branch}:${tradeType}`;
  const fields = useMemo(
    () => config.form_fields.filter((f) => fieldType(f.field_name)),
    [config.form_fields],
  );
  const names = fields.map((f) => f.field_name);
  const byName = new Map(fields.map((f) => [f.field_name, f]));
  const [draft] = useState(() => loadDraft<Values>(draftKey));
  const schema = useMemo(() => buildSchema(fields), [fields]);
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    getValues,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: initialValues(names, tx, draft, params),
  });
  const [rateMissing, setRateMissing] = useState(false);
  const [rateDialog, setRateDialog] = useState(false);

  // Announce a restored draft once; drop the «new partner» params once they are applied.
  const announced = useRef(false);
  useEffect(() => {
    if (draft && !announced.current) {
      announced.current = true;
      toast(t('transactions.draft_restored'), { id: 'draft-restored', icon: '↺' });
    }
    if ([...params.keys()].some((k) => k.startsWith('new_'))) {
      setParams(
        (p) => {
          for (const k of [...p.keys()]) if (k.startsWith('new_')) p.delete(k);
          return p;
        },
        { replace: true },
      );
    }
  }, [draft, params, setParams, t]);

  const values = useWatch({ control }) as Values;
  const currency = String(values.currency ?? 'AFN');
  const dateKey = toShamsiKey(String(values.date ?? '')) ?? todayShamsi();

  // The day's rate of this currency: shown under the field and used to pre-fill it.
  const dayRate = useDayRate(dateKey, currency);
  useEffect(() => {
    if (currency !== 'AFN' && dayRate.data && !getValues('exchange_rate')) {
      setValue('exchange_rate', trimRate(dayRate.data.rate), { shouldDirty: true });
    }
  }, [currency, dayRate.data, getValues, setValue]);

  // Live row summary: the server computes it with the model's own formulas (debounced).
  const previewBody = JSON.stringify({
    ...Object.fromEntries(
      [
        'currency',
        'exchange_rate',
        'customer_payment',
        ...names.filter((n) => !isLineField(n) && fieldType(n) === 'money'),
      ].map((n) => [n, values[n] ?? '']),
    ),
    money_amounts: Object.fromEntries(
      names.filter(isLineField).map((n) => [lineCode(n), values[n] ?? '']),
    ),
  });
  const debouncedBody = useDebounced(previewBody, 400);
  const preview = useQuery({
    queryKey: ['tx-preview', branch, debouncedBody],
    queryFn: () =>
      api.post<PreviewSummary>(
        '/transactions/preview-summary/',
        { branch, ...(JSON.parse(debouncedBody) as Record<string, unknown>) },
        { skipErrorToast: true },
      ),
    placeholderData: (prev) => prev,
  });

  async function onSubmit(v: Values): Promise<void> {
    const body = toPayload(v, names, branch, tradeType);
    try {
      const saved = tx
        ? await api.patch<Transaction>(`/transactions/${tx.id}/`, body, { skipErrorToast: true })
        : await api.post<Transaction>('/transactions/', body, { skipErrorToast: true });
      clearDraft(draftKey);
      await qc.invalidateQueries({ queryKey: [...TX_KEY] });
      toast.success(t('transactions.saved', { serial: isolateLtr(saved.serial_number) }));
      navigate(`/transactions?date_from=${saved.date}&date_to=${saved.date}&highlight=${saved.id}`);
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 428) {
        saveDraft(draftKey, getValues()); // survives going to the rates page and back
        setRateMissing(true);
        return;
      }
      for (const [field, message] of Object.entries(fieldErrors(err))) setError(field, { message });
      toastError(err);
    }
  }

  async function onCancel(): Promise<void> {
    if (isDirty) {
      const ok = await confirm({
        title: t('transactions.discard_title'),
        message: t('transactions.discard'),
        variant: 'warning',
        confirmLabel: t('transactions.leave'),
      });
      if (!ok) return;
    }
    clearDraft(draftKey);
    navigate('/transactions');
  }

  if (rateMissing) {
    return (
      <div
        className="mx-auto max-w-lg py-12 text-center"
        role="alert"
        data-testid="rate-missing-page"
      >
        <AlertTriangle className="mx-auto mb-4 h-14 w-14 text-red-600" />
        <h1 className="mb-2 text-2xl font-bold">{t('summary.missing_today_rate')}</h1>
        <p className="mb-6 text-gray-600 dark:text-gray-400">
          {t('summary.missing_today_rate_body')}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {isSuperAdmin ? (
            <Link to="/admin/exchange-rates/new" data-testid="rate-missing-cta">
              <Button size="lg" className="bg-red-600 hover:bg-red-700">
                {t('summary.missing_today_rate_cta')}
              </Button>
            </Link>
          ) : (
            <Button
              size="lg"
              className="bg-red-600 hover:bg-red-700"
              onClick={() => setRateDialog(true)}
              data-testid="rate-missing-cta"
            >
              {t('summary.missing_today_rate_cta')}
            </Button>
          )}
          <Button
            size="lg"
            variant="secondary"
            onClick={() => setRateMissing(false)}
            data-testid="back-to-form"
          >
            {t('summary.back_to_form')}
          </Button>
        </div>
        {/* A branch manager enters today's rate here; the blocked save is then retried at once. */}
        <TodayRateDialog
          open={rateDialog}
          onClose={() => setRateDialog(false)}
          onSaved={() => {
            setRateMissing(false);
            void handleSubmit(onSubmit)();
          }}
        />
      </div>
    );
  }

  const sections = visibleSections(byName, currency);

  // An «add new» trip saves the form first, and comes back here with the new id.
  const returnTo = encodeURIComponent(location.pathname + location.search);

  return (
    <>
      <PageHeader
        title={
          tx
            ? t('transactions.edit_title', { serial: isolateLtr(tx.serial_number) })
            : t('transactions.new_title', { type: t(`trade_types.${tradeType}`) })
        }
        description={config.trade_type_label}
      />
      <form
        onSubmit={(e) => void handleSubmit(onSubmit)(e)}
        noValidate
        className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]"
        data-testid="tx-form"
      >
        <div className="space-y-6">
          <FormSections
            sections={sections}
            renderField={(f) => (
              <Field
                key={f.field_name}
                field={f}
                required={f.required || (f.field_name === 'exchange_rate' && currency !== 'AFN')}
                register={register}
                control={control}
                error={errors[f.field_name]?.message as string | undefined}
                selectedLabel={
                  f.field_name === 'trader'
                    ? tx?.trader === values.trader
                      ? tx?.trader_name
                      : undefined
                    : f.field_name === 'transport_company' &&
                        tx?.transport_company === values.transport_company
                      ? tx?.transport_company_name
                      : undefined
                }
                addNewTo={
                  FK_TARGETS[f.field_name]
                    ? `${FK_TARGETS[f.field_name]?.base}/new?return=${returnTo}`
                    : undefined
                }
                onBeforeAddNew={() => saveDraft(draftKey, getValues())}
                hint={
                  f.field_name === 'exchange_rate'
                    ? dayRate.data
                      ? t('transactions.rate_hint', {
                          rate: formatRate(dayRate.data.rate, i18n.language),
                        })
                      : dayRate.isFetched
                        ? t('transactions.rate_hint_missing', { currency })
                        : undefined
                    : undefined
                }
              />
            )}
          />
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => void onCancel()} data-testid="tx-cancel">
              {t('common.cancel')}
            </Button>
            <Button type="submit" size="lg" loading={isSubmitting} data-testid="tx-submit">
              <Save className="h-4 w-4" />
              {isSubmitting ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </div>
        <SummaryPanel preview={preview.data} loading={preview.isFetching} lang={i18n.language} />
      </form>
    </>
  );
}

interface FormSection {
  key: string;
  fields: ConfigField[];
}

/**
 * The form's sections with the shown fields of each, in sort_order (never alphabetical).
 * exchange_rate only appears for a currency other than AFN. After «ارز و نرخ» come
 * «عواید» (customer_payment first, then every revenue type) and «مصارف»: each money field
 * goes by its kind, whatever it is called.
 */
function visibleSections(byName: Map<string, ConfigField>, currency: string): FormSection[] {
  const bySortOrder = (a: ConfigField, b: ConfigField): number => a.sort_order - b.sort_order;
  const money = (kind: 'REVENUE' | 'EXPENSE'): FormSection => ({
    key: MONEY_SECTIONS[kind],
    fields: [...byName.values()].filter((f) => f.money?.kind === kind).sort(bySortOrder),
  });
  return SECTIONS.flatMap((s) => {
    const section = {
      key: s.key,
      fields: s.fields
        .map((name) => byName.get(name))
        .filter((f): f is ConfigField => Boolean(f))
        .filter((f) => f.field_name !== 'exchange_rate' || currency !== 'AFN')
        .sort(bySortOrder),
    };
    return s.key === 'currency' ? [section, money('REVENUE'), money('EXPENSE')] : [section];
  }).filter((s) => s.fields.length > 0);
}

function FormSections({
  sections,
  renderField,
}: {
  sections: FormSection[];
  renderField(field: ConfigField): JSX.Element;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      {sections.map((section) => (
        <Card key={section.key} className="p-5" data-testid={`section-${section.key}`}>
          <h2 className="mb-4 font-semibold text-brand dark:text-emerald-300">
            {t(`sections.${section.key}`)}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">{section.fields.map(renderField)}</div>
        </Card>
      ))}
    </>
  );
}

/**
 * The transaction form exactly as a branch manager will see it for `config` (a new record,
 * currency AFN), read-only: the super admin's field settings and «عواید و مصارف» pages
 * preview unsaved settings with it (`only`: just these sections). Same sections, inputs and
 * required marks as <FormBody>.
 */
export function FormPreview({
  config,
  only,
}: {
  config: FormConfig;
  only?: string[];
}): JSX.Element {
  const { t } = useTranslation();
  const fields = config.form_fields.filter((f) => fieldType(f.field_name));
  const byName = new Map(fields.map((f) => [f.field_name, f]));
  const [defaults] = useState(() =>
    initialValues(Object.keys(FIELD_TYPES), undefined, null, new URLSearchParams()),
  );
  const { register, control } = useForm<Values>({ defaultValues: defaults });
  return (
    <fieldset disabled className="min-w-0 space-y-4" aria-label={t('field_settings.preview')}>
      <FormSections
        sections={visibleSections(byName, String(defaults.currency)).filter(
          (s) => !only || only.includes(s.key),
        )}
        renderField={(f) => (
          <Field
            key={f.field_name}
            field={f}
            required={f.required}
            register={register}
            control={control}
            onBeforeAddNew={() => undefined}
          />
        )}
      />
    </fieldset>
  );
}

interface FieldProps {
  field: ConfigField;
  required: boolean;
  register: UseFormRegister<Values>;
  control: Control<Values>;
  error?: string;
  hint?: string;
  selectedLabel?: string | null;
  addNewTo?: string;
  onBeforeAddNew(): void;
}

function Field({
  field,
  required,
  register,
  control,
  error,
  hint,
  selectedLabel,
  addNewTo,
  onBeforeAddNew,
}: FieldProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const name = field.field_name;
  const type = fieldType(name);
  const label = field.money ? moneyName(field.money.names, i18n.language) : t(`form.${name}`);
  const wide = type === 'textarea';

  let control_: JSX.Element;
  if (type === 'money' || type === 'decimal' || type === 'integer' || type === 'rate') {
    control_ = (
      <Input
        {...register(name)}
        inputMode={type === 'integer' ? 'numeric' : 'decimal'}
        placeholder={type === 'money' ? '0' : undefined}
        data-testid={`field-${name}`}
      />
    );
  } else if (type === 'date') {
    control_ = <DateInput {...register(name)} max={todayShamsi()} data-testid={`field-${name}`} />;
  } else if (type === 'textarea') {
    control_ = (
      <Textarea {...register(name)} maxLength={2000} rows={3} data-testid={`field-${name}`} />
    );
  } else if (type === 'choice') {
    const options =
      name === 'currency'
        ? CURRENCIES.map((c) => ({ value: c, label: t(`currencies.${c}`) }))
        : STATUSES.map((s) => ({ value: s, label: t(`statuses.${s}`) }));
    control_ = <Select {...register(name)} options={options} data-testid={`field-${name}`} />;
  } else if (type === 'boolean') {
    return (
      <div className="flex items-end pb-2">
        <Controller
          control={control}
          name={name}
          render={({ field: f }) => (
            <Switch
              checked={Boolean(f.value)}
              onChange={f.onChange}
              label={label}
              showLabel
              id={`field-${name}`}
            />
          )}
        />
      </div>
    );
  } else if (type === 'fk') {
    const target = FK_TARGETS[name];
    control_ = (
      <Controller
        control={control}
        name={name}
        render={({ field: f }) => (
          <SearchSelect
            endpoint={target?.endpoint ?? ''}
            value={(f.value as number | null) ?? null}
            onChange={(id) => f.onChange(id)}
            selectedLabel={selectedLabel}
            params={{ is_active: true }}
            data-testid={`field-${name}`}
            addNew={
              addNewTo
                ? {
                    to: addNewTo,
                    label: t(`${target?.ns}.add_button`),
                    onBeforeNavigate: onBeforeAddNew,
                  }
                : undefined
            }
          />
        )}
      />
    );
  } else {
    control_ = (
      <Input
        {...register(name)}
        maxLength={MAX_LENGTH[name]}
        dir={/number|plate|phone|serial/.test(name) ? 'ltr' : undefined}
        className={/number|plate|phone|serial/.test(name) ? 'text-start' : undefined}
        data-testid={`field-${name}`}
      />
    );
  }

  return (
    <FormField
      label={label}
      required={required}
      error={error}
      hint={hint}
      className={cn(wide && 'sm:col-span-2')}
    >
      {control_}
    </FormField>
  );
}

function SummaryPanel({
  preview,
  loading,
  lang,
}: {
  preview?: PreviewSummary;
  loading: boolean;
  lang: string;
}): JSX.Element {
  const { t } = useTranslation();
  const balance = Number(preview?.profit_or_loss_afn ?? 0);
  const row = (label: string, value: string | undefined, testId: string): JSX.Element => (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-gray-600 dark:text-gray-400">{label}</dt>
      <dd className="font-medium tabular-nums" data-testid={testId}>
        {preview ? (
          formatMoney(value, 'AFN', lang)
        ) : (
          <span className="inline-block h-4 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        )}
      </dd>
    </div>
  );
  return (
    <aside
      className="lg:sticky lg:top-20"
      aria-live="polite"
      aria-busy={loading}
      data-testid="summary-panel"
    >
      <Card className="p-5">
        <h2 className="mb-3 flex items-center justify-between font-semibold">
          {t('summary.title')}
          {loading && <Spinner className="h-4 w-4 text-gray-400" label={t('summary.loading')} />}
        </h2>
        <dl className="divide-y divide-gray-100 text-sm dark:divide-gray-700">
          {row(t('summary.revenue'), preview?.total_revenue_afn, 'summary-revenue')}
          {row(t('summary.expenses'), preview?.total_expense_afn, 'summary-expenses')}
          <div className="flex items-baseline justify-between gap-3 pt-3">
            <dt className="font-semibold">{t('summary.balance')}</dt>
            <dd
              className={cn(
                'text-lg font-bold tabular-nums',
                balance > 0 && 'text-emerald-700 dark:text-emerald-400',
                balance < 0 && 'text-red-700 dark:text-red-400',
                balance === 0 && 'text-gray-500',
              )}
              data-testid="summary-balance"
            >
              {preview
                ? `${balance > 0 ? '+' : ''}${formatMoney(preview.profit_or_loss_afn, 'AFN', lang)}`
                : '…'}
            </dd>
          </div>
        </dl>
        <p className="pt-1 text-end text-xs text-gray-500" data-testid="summary-usd">
          {preview?.profit_or_loss_usd != null ? (
            <span dir="ltr">≈ {formatMoney(preview.profit_or_loss_usd, 'USD', lang)}</span>
          ) : (
            <span title={t('summary.usd_unknown')}>$ —</span>
          )}
        </p>
        <p className="mt-4 flex gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 rtl:rotate-180" aria-hidden />
          {t('summary.note')}
        </p>
      </Card>
    </aside>
  );
}
