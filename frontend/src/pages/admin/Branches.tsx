import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
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
import { Spinner } from '@/components/ui/Spinner';
import { Switch } from '@/components/ui/Switch';
import { fieldErrors, useApi } from '@/lib/api';
import { normalizeDigits, useDigitLocale } from '@/lib/digits';
import { useCreate, useDebounced, useDelete, useItem, useList, useUpdate } from '@/lib/hooks';
import type { Branch } from '@/types/api';

const KEY = ['branches'] as const;
const BASE = '/admin/branches';

const schema = z.object({
  name: z.string().trim().min(1, 'common.required').max(120),
  code: z
    .string()
    .trim()
    .min(1, 'common.required')
    .regex(/^[A-Z0-9]{1,10}$/, 'branches.code_invalid'),
  city: z.string().trim().min(1, 'common.required').max(120),
  phone: z
    .string()
    .trim()
    .max(40)
    .refine((v) => v === '' || /^\+?[\d\s-]+$/.test(normalizeDigits(v)), 'branches.phone_invalid'),
  address: z.string().trim().max(255),
  is_active: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

export function Branches(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const d = useDigitLocale();
  const isNew = Boolean(useMatch(`${BASE}/new`));
  const editId = Number(useMatch(`${BASE}/:id/edit`)?.params.id) || null;

  const [search, setSearch] = useState('');
  const [active, setActive] = useState('');
  const query = useDebounced(search);
  const list = useList<Branch>([...KEY], '/branches/', { search: query, is_active: active });
  const remove = useDelete((id) => `/branches/${id}/`, [[...KEY]], { success: false });

  async function onDelete(branch: Branch): Promise<void> {
    const ok = await confirm({
      title: t('branches.delete_confirm_title', { name: branch.name }),
      message: t('branches.delete_confirm_message'),
      variant: 'danger',
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(branch.id);
      toast.success(t('branches.deleted', { name: branch.name }));
      if (editId === branch.id) navigate(BASE);
    } catch {
      /* toastError already showed the backend's Dari message (e.g. 409: has users) */
    }
  }

  const columns: Column<Branch>[] = [
    {
      key: 'name',
      header: t('branches.name'),
      cell: (b) => <span className="font-medium">{b.name}</span>,
    },
    {
      key: 'code',
      header: t('branches.code'),
      cell: (b) => (
        <code className="font-mono text-xs" dir="ltr">
          {b.code}
        </code>
      ),
    },
    { key: 'city', header: t('branches.city'), cell: (b) => b.city || '—' },
    {
      key: 'phone',
      header: t('branches.phone'),
      cell: (b) => (b.phone ? <span dir="ltr">{b.phone}</span> : '—'),
    },
    {
      key: 'is_active',
      header: t('common.status'),
      cell: (b) =>
        b.is_active ? (
          <Badge tone="success">{t('common.active')}</Badge>
        ) : (
          <Badge>{t('common.inactive')}</Badge>
        ),
    },
    {
      key: 'users',
      header: t('branches.user_count'),
      cell: (b) => d(b.user_count),
      align: 'center',
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('common.actions')}</span>,
      align: 'end',
      cell: (b) => (
        <div className="flex justify-end gap-1">
          <IconButton label={t('common.edit')} onClick={() => navigate(`${BASE}/${b.id}/edit`)}>
            <Pencil className="h-4 w-4" />
          </IconButton>
          <IconButton label={t('common.delete')} tone="danger" onClick={() => void onDelete(b)}>
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('branches.title')}
        description={t('branches.description')}
        action={
          <Button onClick={() => navigate(`${BASE}/new`)} data-testid="add-branch">
            <Plus className="h-4 w-4" />
            {t('branches.add_button')}
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('branches.search_placeholder')}
            aria-label={t('common.search')}
            className="ps-9"
          />
        </div>
        <div className="w-40">
          <Select
            value={active}
            onChange={(e) => setActive(e.target.value)}
            aria-label={t('common.status')}
            placeholder={t('common.all')}
            options={[
              { value: 'true', label: t('common.active') },
              { value: 'false', label: t('common.inactive') },
            ]}
          />
        </div>
      </div>
      <DataTable
        columns={columns}
        rows={list.data}
        rowKey={(b) => b.id}
        onRowClick={(b) => navigate(`${BASE}/${b.id}/edit`)}
        isLoading={list.isFetching && !list.data}
        emptyMessage={t('common.no_results')}
        caption={t('branches.title')}
        rowClassName={(b) => !b.is_active && 'text-gray-500 dark:text-gray-400'}
      />
      {isNew && <BranchDrawer onClose={() => navigate(BASE)} />}
      {editId && <EditBranch id={editId} onClose={() => navigate(BASE)} onDelete={onDelete} />}
    </>
  );
}

function EditBranch({
  id,
  onClose,
  onDelete,
}: {
  id: number;
  onClose(): void;
  onDelete(branch: Branch): Promise<void>;
}): JSX.Element {
  const { t } = useTranslation();
  const item = useItem<Branch>([...KEY, 'item'], `/branches/${id}/`);
  if (!item.data) {
    return (
      <Drawer open onClose={onClose} title={t('branches.edit_title')}>
        <Spinner className="mx-auto h-6 w-6" />
      </Drawer>
    );
  }
  return <BranchDrawer branch={item.data} onClose={onClose} onDelete={onDelete} />;
}

function BranchDrawer({
  branch,
  onClose,
  onDelete,
}: {
  branch?: Branch;
  onClose(): void;
  onDelete?(branch: Branch): Promise<void>;
}): JSX.Element {
  const { t } = useTranslation();
  const d = useDigitLocale();
  const api = useApi();
  const create = useCreate<Branch, FormValues>('/branches/', [[...KEY]], { success: false });
  const update = useUpdate<Branch, Omit<FormValues, 'code'>>(
    (id) => `/branches/${id}/`,
    [[...KEY]],
    {
      success: (b) => t('branches.updated', { name: b.name }),
    },
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
      name: branch?.name ?? '',
      code: branch?.code ?? '',
      city: branch?.city ?? '',
      phone: branch?.phone ?? '',
      address: branch?.address ?? '',
      is_active: branch?.is_active ?? true,
    },
  });

  async function onSubmit(values: FormValues): Promise<void> {
    try {
      if (branch) {
        // The code is fixed after creation, so it is never sent on edit.
        const { name, city, phone, address, is_active } = values;
        await update.mutateAsync({
          id: branch.id,
          data: { name, city, phone, address, is_active },
        });
      } else {
        const created = await create.mutateAsync(values);
        // The post_save signal has just seeded this branch's FieldConfig rows; count them.
        const rows = await api.get<unknown[]>('/field-configs/', {
          params: { branch: created.id },
        });
        toast.success(t('branches.created', { name: created.name, n: d(rows.length) }), {
          duration: 7000,
        });
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
      title={branch ? t('branches.edit_title') : t('branches.add_button')}
      description={branch ? `${branch.name} (${branch.code})` : t('branches.seed_notice')}
      onSubmit={(e) => void handleSubmit(onSubmit)(e)}
      submitting={create.isPending || update.isPending}
      footer={
        <div className="flex w-full items-center gap-2">
          {branch && onDelete && (
            <Button variant="ghost" className="text-red-600" onClick={() => void onDelete(branch)}>
              <Trash2 className="h-4 w-4" />
              {t('branches.delete')}
            </Button>
          )}
          <div className="ms-auto flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              loading={create.isPending || update.isPending}
              data-testid="drawer-submit"
            >
              {create.isPending || update.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </div>
      }
    >
      <FormField label={t('branches.name')} error={errors.name?.message} required>
        <Input {...register('name')} data-autofocus />
      </FormField>
      <FormField
        label={t('branches.code')}
        error={errors.code?.message}
        hint={branch ? t('branches.code_readonly') : t('branches.code_hint')}
        required
      >
        <Input
          {...register('code', { setValueAs: (v: string) => normalizeDigits(v).toUpperCase() })}
          readOnly={Boolean(branch)}
          disabled={Boolean(branch)}
          maxLength={10}
          dir="ltr"
          autoCapitalize="characters"
          className="font-mono uppercase"
        />
      </FormField>
      <FormField label={t('branches.city')} error={errors.city?.message} required>
        <Input {...register('city')} />
      </FormField>
      <FormField label={t('branches.phone')} error={errors.phone?.message}>
        <Input {...register('phone')} dir="ltr" inputMode="tel" className="text-start" />
      </FormField>
      <FormField label={t('branches.address')} error={errors.address?.message}>
        <Input {...register('address')} />
      </FormField>
      <Controller
        control={control}
        name="is_active"
        render={({ field }) => (
          <Switch
            checked={field.value}
            onChange={field.onChange}
            label={t('branches.is_active')}
            showLabel
            id="branch-active"
          />
        )}
      />
    </Drawer>
  );
}
