import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, History, Pencil, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMatch, useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import { FormField } from '@/components/ui/FormField';
import { IconButton } from '@/components/ui/IconButton';
import { InlineEdit } from '@/components/ui/InlineEdit';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Switch } from '@/components/ui/Switch';
import { fieldErrors } from '@/lib/api';
import { cn } from '@/lib/cn';
import { splitDualDate } from '@/lib/date';
import { normalizeNumber, useDigitLocale } from '@/lib/digits';
import { useChoices, useCreate, useItem, useList, useUpdate } from '@/lib/hooks';
import type { StatementLine, StatementLineHistory, StatementSection } from '@/types/api';

const KEY = ['statement-lines'] as const;
const BASE = '/admin/statement-lines';
const SECTIONS: StatementSection[] = ['REVENUE', 'COGS', 'OPEX', 'OTHER'];
const REVENUE_SOURCE = 'customer_payment';

const schema = z
  .object({
    section: z.enum(['REVENUE', 'COGS', 'OPEX', 'OTHER']),
    code: z
      .string()
      .trim()
      .min(1, 'common.required')
      .max(32)
      .regex(/^[A-Z][A-Z0-9_]*$/, 'statement_lines.code_invalid'),
    label_fa: z.string().trim().min(1, 'common.required').max(120),
    label_en: z.string().trim().max(120),
    source_field: z.string().min(1, 'common.required'),
    sort_order: z
      .string()
      .transform(normalizeNumber)
      .refine((v) => /^\d{1,5}$/.test(v) && Number(v) <= 32767, 'statement_lines.sort_invalid'),
    is_active: z.boolean(),
  })
  // Same rule as StatementLine.clean(): customer_payment is the only revenue, and only revenue.
  .superRefine((v, ctx) => {
    if (v.section === 'REVENUE' && v.source_field !== REVENUE_SOURCE) {
      ctx.addIssue({
        code: 'custom',
        path: ['source_field'],
        message: 'statement_lines.revenue_rule',
      });
    }
  });

type FormInput = z.input<typeof schema>;
type FormValues = z.output<typeof schema>;
type LinePayload = Omit<StatementLine, 'id'>;
type Patch = Partial<LinePayload>;

export function StatementLines(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const d = useDigitLocale();
  const isNew = Boolean(useMatch(`${BASE}/new`));
  const editId = Number(useMatch(`${BASE}/:id/edit`)?.params.id) || null;
  const historyId = Number(useMatch(`${BASE}/:id/history`)?.params.id) || null;

  const list = useList<StatementLine>([...KEY], '/statement-lines/');
  const sources = useChoices('/statement-lines/', 'source_field');
  const sourceLabel = useMemo(
    () => new Map((sources ?? []).map((s) => [s.value, s.display_name])),
    [sources],
  );
  const update = useUpdate<StatementLine, Patch>((id) => `/statement-lines/${id}/`, [[...KEY]], {
    success: (l) => t('statement_lines.saved', { code: l.code }),
  });
  const save = (line: StatementLine, data: Patch): Promise<StatementLine> =>
    update.mutateAsync({ id: line.id, data });

  const grouped = useMemo(() => {
    const bySection = new Map<StatementSection, StatementLine[]>(SECTIONS.map((s) => [s, []]));
    for (const line of list.data ?? []) bySection.get(line.section)?.push(line);
    for (const lines of bySection.values()) {
      lines.sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code));
    }
    return bySection;
  }, [list.data]);

  const columns: Column<StatementLine>[] = [
    {
      key: 'code',
      header: t('statement_lines.code'),
      cell: (l) => (
        <code className="font-mono text-xs" dir="ltr">
          {l.code}
        </code>
      ),
    },
    {
      key: 'label_fa',
      header: t('statement_lines.label_fa'),
      cell: (l) => (
        <InlineEdit
          value={l.label_fa}
          label={t('statement_lines.label_fa')}
          onSave={(label_fa) => save(l, { label_fa })}
          dir="rtl"
        />
      ),
    },
    {
      key: 'label_en',
      header: t('statement_lines.label_en'),
      cell: (l) => (
        <InlineEdit
          value={l.label_en}
          label={t('statement_lines.label_en')}
          onSave={(label_en) => save(l, { label_en })}
          dir="ltr"
        />
      ),
    },
    {
      key: 'source',
      header: t('statement_lines.source_field'),
      cell: (l) => (
        <span className="flex flex-col leading-tight">
          <span>{sourceLabel.get(l.source_field) ?? l.source_field}</span>
          <code className="text-[11px] text-gray-500" dir="ltr">
            {l.source_field}
          </code>
        </span>
      ),
    },
    {
      key: 'sort_order',
      header: t('statement_lines.sort_order'),
      align: 'center',
      cell: (l) => (
        <InlineEdit
          value={String(l.sort_order)}
          display={d(l.sort_order)}
          label={t('statement_lines.sort_order')}
          numeric
          onSave={(v) => save(l, { sort_order: Number(v) })}
        />
      ),
    },
    {
      key: 'is_active',
      header: t('statement_lines.is_active'),
      align: 'center',
      cell: (l) => (
        <Switch
          checked={l.is_active}
          label={`${t('statement_lines.is_active')}: ${l.code}`}
          onChange={(is_active) => void save(l, { is_active }).catch(() => {})}
          disabled={update.isPending}
        />
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('common.actions')}</span>,
      align: 'end',
      cell: (l) => (
        <div className="flex justify-end gap-1">
          <IconButton label={t('common.edit')} onClick={() => navigate(`${BASE}/${l.id}/edit`)}>
            <Pencil className="h-4 w-4" />
          </IconButton>
          <IconButton
            label={t('statement_lines.history_button')}
            onClick={() => navigate(`${BASE}/${l.id}/history`)}
            data-testid="history-button"
          >
            <History className="h-4 w-4" />
          </IconButton>
        </div>
      ),
    },
  ];

  const lineById = (id: number | null): StatementLine | undefined =>
    list.data?.find((l) => l.id === id);

  return (
    <>
      <PageHeader
        title={t('statement_lines.title')}
        description={t('statement_lines.description')}
        action={
          <Button onClick={() => navigate(`${BASE}/new`)} data-testid="add-line">
            <Plus className="h-4 w-4" />
            {t('statement_lines.add_button')}
          </Button>
        }
      />
      <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
        {t('statement_lines.inline_hint')}
      </p>
      <div className="space-y-6">
        {SECTIONS.map((section) => {
          const lines = grouped.get(section) ?? [];
          return (
            <Card key={section} className="overflow-hidden" data-testid={`section-${section}`}>
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3 dark:border-gray-700">
                <h2 className="font-semibold">{t(`statement_lines.sections.${section}`)}</h2>
                <Badge>{t('statement_lines.lines_count', { n: d(lines.length) })}</Badge>
              </div>
              <DataTable
                columns={columns}
                rows={lines}
                rowKey={(l) => l.id}
                isLoading={list.isPending}
                emptyMessage={t('common.no_results')}
                caption={t(`statement_lines.sections.${section}`)}
                className="rounded-none border-0"
                rowClassName={(l) => !l.is_active && 'opacity-50'}
              />
            </Card>
          );
        })}
      </div>
      {/* Wait for the source choices: a <select> must have its default value among its options. */}
      {(isNew || editId) &&
        (sources && (isNew || lineById(editId)) ? (
          <LineDrawer
            line={isNew ? undefined : lineById(editId)}
            sources={sources}
            onClose={() => navigate(BASE)}
          />
        ) : (
          <Drawer open onClose={() => navigate(BASE)} title={t('statement_lines.title')}>
            <Spinner className="mx-auto h-6 w-6" />
          </Drawer>
        ))}
      {historyId && (
        <HistoryModal
          id={historyId}
          code={lineById(historyId)?.code ?? ''}
          sourceLabel={sourceLabel}
          onClose={() => navigate(BASE)}
        />
      )}
    </>
  );
}

function LineDrawer({
  line,
  sources,
  onClose,
}: {
  line?: StatementLine;
  sources: { value: string; display_name: string }[];
  onClose(): void;
}): JSX.Element {
  const { t } = useTranslation();
  const create = useCreate<StatementLine, LinePayload>('/statement-lines/', [[...KEY]], {
    success: (l) => t('statement_lines.saved', { code: l.code }),
  });
  const update = useUpdate<StatementLine, Omit<LinePayload, 'code'>>(
    (id) => `/statement-lines/${id}/`,
    [[...KEY]],
    { success: (l) => t('statement_lines.saved', { code: l.code }) },
  );
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      section: line?.section ?? 'OPEX',
      code: line?.code ?? '',
      label_fa: line?.label_fa ?? '',
      label_en: line?.label_en ?? '',
      source_field: line?.source_field ?? '',
      sort_order: String(line?.sort_order ?? 100),
      is_active: line?.is_active ?? true,
    },
  });

  async function onSubmit(values: FormValues): Promise<void> {
    const { code, ...rest } = values;
    const data = { ...rest, sort_order: Number(values.sort_order) };
    try {
      // The code is a fixed key once created, so edits never send it.
      if (line) await update.mutateAsync({ id: line.id, data });
      else await create.mutateAsync({ ...data, code });
      onClose();
    } catch (err) {
      for (const [field, message] of Object.entries(fieldErrors(err))) {
        setError(field as keyof FormInput, { message });
      }
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={
        line
          ? t('statement_lines.edit_title', { code: line.code })
          : t('statement_lines.add_button')
      }
      onSubmit={(e) => void handleSubmit(onSubmit)(e)}
      submitting={create.isPending || update.isPending}
    >
      <FormField label={t('statement_lines.section')} error={errors.section?.message} required>
        <Select
          {...register('section')}
          options={SECTIONS.map((s) => ({ value: s, label: t(`statement_lines.sections.${s}`) }))}
          data-testid="line-section"
        />
      </FormField>
      <FormField
        label={t('statement_lines.code')}
        error={errors.code?.message}
        hint={t('statement_lines.code_hint')}
        required
      >
        <Input
          {...register('code', { setValueAs: (v: string) => v.toUpperCase() })}
          disabled={Boolean(line)}
          dir="ltr"
          className="font-mono uppercase"
        />
      </FormField>
      <FormField label={t('statement_lines.label_fa')} error={errors.label_fa?.message} required>
        <Input {...register('label_fa')} data-autofocus />
      </FormField>
      <FormField label={t('statement_lines.label_en')} error={errors.label_en?.message}>
        <Input {...register('label_en')} dir="ltr" className="text-start" />
      </FormField>
      <FormField
        label={t('statement_lines.source_field')}
        error={errors.source_field?.message}
        required
      >
        <Select
          {...register('source_field')}
          placeholder="—"
          options={sources.map((s) => ({
            value: s.value,
            label: `${s.display_name} (${s.value})`,
          }))}
          data-testid="line-source"
        />
      </FormField>
      <FormField
        label={t('statement_lines.sort_order')}
        error={errors.sort_order?.message}
        required
      >
        <Input {...register('sort_order')} inputMode="numeric" />
      </FormField>
      <Controller
        control={control}
        name="is_active"
        render={({ field }) => (
          <Switch
            checked={field.value}
            onChange={field.onChange}
            label={t('statement_lines.is_active')}
            showLabel
          />
        )}
      />
    </Drawer>
  );
}

const FIELDS: (keyof StatementLineHistory['values'])[] = [
  'section',
  'code',
  'label_fa',
  'label_en',
  'source_field',
  'sort_order',
  'is_active',
];

function HistoryModal({
  id,
  code,
  sourceLabel,
  onClose,
}: {
  id: number;
  code: string;
  sourceLabel: Map<string, string>;
  onClose(): void;
}): JSX.Element {
  const { t } = useTranslation();
  const d = useDigitLocale();
  const history = useItem<StatementLineHistory[]>(
    [...KEY, 'history'],
    `/statement-lines/${id}/history/`,
  );
  const records = history.data ?? [];

  function show(field: string, value: unknown): string {
    if (field === 'section') return t(`statement_lines.sections.${String(value)}`);
    if (field === 'source_field') return sourceLabel.get(String(value)) ?? String(value);
    if (field === 'is_active') return value ? t('common.yes') : t('common.no');
    if (field === 'sort_order') return d(String(value));
    return String(value ?? '') || '—';
  }

  return (
    <Modal open onClose={onClose} title={t('statement_lines.history_title', { code })} size="lg">
      {history.isPending ? (
        <Spinner className="mx-auto h-6 w-6" />
      ) : records.length === 0 ? (
        <p className="text-sm text-gray-500">{t('statement_lines.no_history')}</p>
      ) : (
        <ol
          className="relative space-y-5 border-s border-gray-200 ps-5 dark:border-gray-700"
          data-testid="history-list"
        >
          {records.map((rec, i) => {
            // Records come newest first; compare each with the one before it in time.
            const older = records[i + 1];
            const changes = older ? FIELDS.filter((f) => older.values[f] !== rec.values[f]) : [];
            const when = splitDualDate(rec.date);
            const created = !older;
            return (
              <li key={rec.history_id} className="relative" data-testid="history-item">
                <span
                  className={cn(
                    'absolute -start-[1.6rem] top-1 h-3 w-3 rounded-full ring-4 ring-white dark:ring-gray-800',
                    created ? 'bg-brand' : 'bg-accent',
                  )}
                />
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone={created ? 'brand' : 'accent'}>{rec.type}</Badge>
                  <span className="font-medium" data-testid="history-user">
                    {t('statement_lines.by')} {rec.user ?? '—'}
                  </span>
                  <span className="text-gray-500">
                    {when.shamsi}
                    {when.gregorian && (
                      <span className="ms-2 text-xs" dir="ltr">
                        ({when.gregorian})
                      </span>
                    )}
                  </span>
                </div>
                {created ? (
                  <p className="mt-1 text-xs text-gray-500">{t('statement_lines.initial')}</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-sm" data-testid="history-changes">
                    {changes.map((f) => (
                      <li key={f} className="rounded-md bg-gray-50 px-2 py-1 dark:bg-gray-900/50">
                        <span className="text-gray-500">{t(`statement_lines.${f}`)}: </span>
                        <del className="text-red-600/80">{show(f, older?.values[f])}</del>
                        <ArrowLeft className="mx-1.5 inline h-3.5 w-3.5 text-gray-400 ltr:rotate-180" />
                        <ins className="font-medium text-emerald-700 no-underline dark:text-emerald-300">
                          {show(f, rec.values[f])}
                        </ins>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Modal>
  );
}
