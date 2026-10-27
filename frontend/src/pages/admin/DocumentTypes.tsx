import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useMatch, useNavigate } from 'react-router';
import { z } from 'zod';

import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useConfirm } from '@/components/ui/confirm-context';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import { FormField } from '@/components/ui/FormField';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { fieldErrors } from '@/lib/api';
import { normalizeDigits, useDigitLocale } from '@/lib/digits';
import { DOC_REQUIREMENTS_KEY, DOC_TYPES_KEY, typeName, useDocumentTypes } from '@/lib/documents';
import { useCreate, useDelete, useUpdate } from '@/lib/hooks';
import type { DocumentType } from '@/types/api';

const BASE = '/admin/document-types';

/** Transaction fields a document's number can be compared with (DOCUMENT_NUMBER_FIELDS). */
const NUMBER_FIELDS = [
  't1_number',
  't2_number',
  'cmr_number',
  'mafi_number',
  'exit_slip_number',
  'bank_tariff_slip_number',
  'scale_ticket_number',
  'seal_number',
];

const schema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'common.required')
    .regex(/^[A-Z][A-Z0-9_]{0,29}$/, 'document_types.code_invalid'),
  name_fa: z.string().trim().min(1, 'common.required').max(100),
  name_ps: z.string().trim().max(100),
  name_en: z.string().trim().max(100),
  number_field: z.string(),
  sort_order: z
    .string()
    .trim()
    .refine((v) => /^\d{1,5}$/.test(normalizeDigits(v)), 'document_types.sort_invalid'),
  is_active: z.boolean(),
});

type FormValues = z.infer<typeof schema>;
type Payload = Omit<FormValues, 'sort_order'> & { sort_order: number };

/** «مدیریت → انواع اسناد»: the super admin adds, renames, re-orders or retires document types. */
export function DocumentTypes(): JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const d = useDigitLocale();
  const isNew = Boolean(useMatch(`${BASE}/new`));
  const editId = Number(useMatch(`${BASE}/:id/edit`)?.params.id) || null;
  const { types } = useDocumentTypes();
  const remove = useDelete((id) => `/document-types/${id}/`, [[...DOC_TYPES_KEY]], {
    success: false,
  });
  const editing = editId ? types?.find((x) => x.id === editId) : undefined;

  async function onDelete(row: DocumentType): Promise<void> {
    const ok = await confirm({
      title: t('document_types.delete_title', { name: typeName(row, i18n.language) }),
      message: t('document_types.delete_message'),
      variant: 'danger',
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(row.id);
      toast.success(t('common.deleted'));
      if (editId === row.id) void navigate(BASE);
    } catch {
      /* toastError showed the backend's Dari message (409: documents use this type) */
    }
  }

  const columns: Column<DocumentType>[] = [
    {
      key: 'code',
      header: t('document_types.code'),
      cell: (r) => (
        <code className="font-mono text-xs" dir="ltr">
          {r.code}
        </code>
      ),
    },
    { key: 'name_fa', header: t('document_types.name_fa'), cell: (r) => r.name_fa },
    { key: 'name_ps', header: t('document_types.name_ps'), cell: (r) => r.name_ps || '—' },
    {
      key: 'name_en',
      header: t('document_types.name_en'),
      cell: (r) => <span dir="ltr">{r.name_en || '—'}</span>,
    },
    {
      key: 'number_field',
      header: t('document_types.number_field'),
      cell: (r) => (r.number_field ? t(`form.${r.number_field}`) : '—'),
    },
    {
      key: 'sort',
      header: t('document_types.sort_order'),
      align: 'center',
      cell: (r) => d(r.sort_order),
    },
    {
      key: 'count',
      header: t('document_types.documents_count'),
      align: 'center',
      cell: (r) => d(r.documents_count),
    },
    {
      key: 'active',
      header: t('common.status'),
      cell: (r) =>
        r.is_active ? (
          <Badge tone="success">{t('common.active')}</Badge>
        ) : (
          <Badge>{t('common.inactive')}</Badge>
        ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('common.actions')}</span>,
      align: 'end',
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <IconButton
            label={t('common.edit')}
            onClick={() => void navigate(`${BASE}/${r.id}/edit`)}
          >
            <Pencil className="h-4 w-4" />
          </IconButton>
          <IconButton label={t('common.delete')} tone="danger" onClick={() => void onDelete(r)}>
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('document_types.title')}
        description={t('document_types.description')}
        action={
          <Button onClick={() => void navigate(`${BASE}/new`)} data-testid="add-document-type">
            <Plus className="h-4 w-4" />
            {t('document_types.add_button')}
          </Button>
        }
      />
      <DataTable
        columns={columns}
        rows={types}
        rowKey={(r) => r.id}
        onRowClick={(r) => void navigate(`${BASE}/${r.id}/edit`)}
        isLoading={!types}
        caption={t('document_types.title')}
        emptyMessage={t('common.no_results')}
        rowClassName={(r) => !r.is_active && 'text-gray-500 dark:text-gray-400'}
      />
      {isNew && <TypeDrawer onClose={() => void navigate(BASE)} />}
      {editing && <TypeDrawer key={editing.id} row={editing} onClose={() => void navigate(BASE)} />}
    </>
  );
}

function TypeDrawer({ row, onClose }: { row?: DocumentType; onClose(): void }): JSX.Element {
  const { t } = useTranslation();
  const invalidate = [[...DOC_TYPES_KEY], [...DOC_REQUIREMENTS_KEY]];
  const create = useCreate<DocumentType, Payload>('/document-types/', invalidate, {
    success: (x) => t('document_types.created', { name: x.name_fa }),
  });
  const update = useUpdate<DocumentType, Omit<Payload, 'code'>>(
    (id) => `/document-types/${id}/`,
    invalidate,
  );
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      code: row?.code ?? '',
      name_fa: row?.name_fa ?? '',
      name_ps: row?.name_ps ?? '',
      name_en: row?.name_en ?? '',
      number_field: row?.number_field ?? '',
      sort_order: String(row?.sort_order ?? 100),
      is_active: row?.is_active ?? true,
    },
  });
  const pending = create.isPending || update.isPending;

  async function onSubmit(values: FormValues): Promise<void> {
    const payload = { ...values, sort_order: Number(normalizeDigits(values.sort_order)) };
    try {
      if (row) {
        // The code is fixed once saved, so it is never sent on edit.
        const { name_fa, name_ps, name_en, number_field, sort_order, is_active } = payload;
        await update.mutateAsync({
          id: row.id,
          data: { name_fa, name_ps, name_en, number_field, sort_order, is_active },
        });
      } else {
        await create.mutateAsync(payload);
      }
      onClose();
    } catch (err) {
      for (const [field, message] of Object.entries(fieldErrors(err))) {
        setError(field as keyof FormValues, { message });
      }
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={row ? t('document_types.edit_title') : t('document_types.add_button')}
      description={row ? `${row.name_fa} (${row.code})` : t('document_types.new_hint')}
      onSubmit={(e) => void handleSubmit(onSubmit)(e)}
      submitting={pending}
      footer={
        <div className="ms-auto flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={pending} data-testid="drawer-submit">
            {pending ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      }
    >
      <FormField
        label={t('document_types.code')}
        error={errors.code?.message}
        hint={row ? t('document_types.code_readonly') : t('document_types.code_hint')}
        required
      >
        <Input
          {...register('code', { setValueAs: (v: string) => normalizeDigits(v).toUpperCase() })}
          readOnly={Boolean(row)}
          disabled={Boolean(row)}
          maxLength={30}
          dir="ltr"
          className="font-mono uppercase"
          data-autofocus
          data-testid="type-code"
        />
      </FormField>
      <FormField label={t('document_types.name_fa')} error={errors.name_fa?.message} required>
        <Input {...register('name_fa')} data-testid="type-name-fa" />
      </FormField>
      <FormField label={t('document_types.name_ps')} error={errors.name_ps?.message}>
        <Input {...register('name_ps')} />
      </FormField>
      <FormField label={t('document_types.name_en')} error={errors.name_en?.message}>
        <Input {...register('name_en')} dir="ltr" />
      </FormField>
      <FormField
        label={t('document_types.number_field')}
        hint={t('document_types.number_field_hint')}
        error={errors.number_field?.message}
      >
        <Select
          {...register('number_field')}
          placeholder={t('document_types.no_number_field')}
          options={NUMBER_FIELDS.map((f) => ({ value: f, label: t(`form.${f}`) }))}
        />
      </FormField>
      <FormField
        label={t('document_types.sort_order')}
        hint={t('document_types.sort_hint')}
        error={errors.sort_order?.message}
      >
        <Input {...register('sort_order')} inputMode="numeric" dir="ltr" className="text-start" />
      </FormField>
      <Controller
        control={control}
        name="is_active"
        render={({ field }) => (
          <Switch
            checked={field.value}
            onChange={field.onChange}
            label={t('document_types.is_active')}
            showLabel
            id="type-active"
          />
        )}
      />
    </Drawer>
  );
}
