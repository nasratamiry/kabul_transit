import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil, Plus, Search, Trash2, UserCheck, UserX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Controller, useForm, type FieldValues } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useLocation, useMatch, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';

import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useConfirm } from '@/components/ui/confirm-context';
import { DataTable, type Column, type SortState } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import { FormField } from '@/components/ui/FormField';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Switch } from '@/components/ui/Switch';
import { Textarea } from '@/components/ui/Textarea';
import { fieldErrors } from '@/lib/api';
import { dualDateTime } from '@/lib/date';
import { normalizeDigits } from '@/lib/digits';
import { useCreate, useDebounced, useDelete, useItem, useList, useUpdate } from '@/lib/hooks';

/** What every partner type has; the rest comes from `fields`. */
export interface PartnerBase {
  id: number;
  name: string;
  phone: string;
  is_active: boolean;
  created_at: string;
}

export interface PartnerField {
  /** Serializer field name; also the i18n key `${ns}.${name}`. */
  name: string;
  kind?: 'text' | 'phone' | 'digits' | 'textarea';
  required?: boolean;
  /** The model's max_length (TextField: 2000, the stage-7 sanitizer limit). */
  maxLength: number;
  ltr?: boolean;
}

export interface PartnerPageConfig {
  /** i18n namespace: title, add_button, created, delete_confirm… and one key per field. */
  ns: string;
  /** API collection, e.g. '/traders/'. */
  endpoint: string;
  /** Route of the list page, e.g. '/partners/traders'. */
  base: string;
  /** Form fields in display order (is_active is always added). */
  fields: PartnerField[];
  /** The one extra list column besides name / phone, e.g. address or country. */
  extraColumn: string;
}

type Row = PartnerBase & Record<string, unknown>;
type FormValues = Record<string, string | boolean>;

const PHONE = /^\+?[\d\s-]*$/;

/** Field list → zod schema. Messages are i18n keys (FormField translates them). */
function buildSchema(fields: PartnerField[]): z.ZodType<FormValues, FormValues> {
  const shape: Record<string, z.ZodType> = { is_active: z.boolean() };
  for (const f of fields) {
    let s = z.string().trim().max(f.maxLength, 'partners.too_long');
    if (f.required) s = s.min(1, 'common.required');
    shape[f.name] =
      f.kind === 'phone'
        ? s.refine((v) => PHONE.test(normalizeDigits(v)), 'partners.phone_invalid')
        : s;
  }
  return z.object(shape) as unknown as z.ZodType<FormValues, FormValues>;
}

const byName = (a: Row, b: Row): number => a.name.localeCompare(b.name, 'fa');

/**
 * Company-wide partner list (traders, transport companies, …): search, active filter
 * (kept in the URL, so `?is_active=true` deep-links), sortable name / created columns,
 * drawer create / edit, activate / deactivate, delete (a 409 from the API explains why a
 * partner with transactions cannot go). Both roles get every action.
 */
export function PartnerPage({
  ns,
  endpoint,
  base,
  fields,
  extraColumn,
}: PartnerPageConfig): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { search: query } = useLocation();
  const confirm = useConfirm();
  const isNew = Boolean(useMatch(`${base}/new`));
  const editId = Number(useMatch(`${base}/:id/edit`)?.params.id) || null;
  const key = [ns];

  const [params, setParams] = useSearchParams();
  const active = params.get('is_active') ?? '';
  // Only same-app paths are followed, never an absolute or protocol-relative URL
  // ('//host', '/\host') from the query string.
  const returnParam = params.get('return');
  const returnTo = returnParam && /^\/(?![/\\])/.test(returnParam) ? returnParam : null;
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' });
  const debounced = useDebounced(search);
  const list = useList<Row>(key, endpoint, { search: debounced, is_active: active });
  const update = useUpdate<Row, { is_active: boolean }>((id) => `${endpoint}${id}/`, [key], {
    success: (r) => t(r.is_active ? `${ns}.activated` : `${ns}.deactivated`, { name: r.name }),
  });
  const remove = useDelete((id) => `${endpoint}${id}/`, [key], { success: false });

  const rows = useMemo(() => {
    const sorted = [...(list.data ?? [])].sort(
      sort.key === 'created_at' ? (a, b) => a.created_at.localeCompare(b.created_at) : byName,
    );
    return sort.dir === 'asc' ? sorted : sorted.reverse();
  }, [list.data, sort]);

  const goList = (): void => navigate(`${base}${query}`);

  function setActive(value: string): void {
    setParams((p) => {
      if (value) p.set('is_active', value);
      else p.delete('is_active');
      return p;
    });
  }

  function onSort(column: string): void {
    setSort((s) => ({ key: column, dir: s.key === column && s.dir === 'asc' ? 'desc' : 'asc' }));
  }

  async function toggleActive(row: Row): Promise<void> {
    const off = row.is_active;
    const ok = await confirm({
      title: t(off ? `${ns}.deactivate_confirm_title` : `${ns}.activate_confirm_title`, {
        name: row.name,
      }),
      message: t(off ? `${ns}.deactivate_confirm` : `${ns}.activate_confirm`),
      variant: off ? 'warning' : 'info',
      confirmLabel: t(off ? 'partners.deactivate' : 'partners.activate'),
    });
    if (ok) await update.mutateAsync({ id: row.id, data: { is_active: !off } }).catch(() => {});
  }

  async function onDelete(row: Row): Promise<void> {
    const ok = await confirm({
      title: t(`${ns}.delete_confirm_title`, { name: row.name }),
      message: t(`${ns}.delete_confirm`),
      variant: 'danger',
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(row.id);
      toast.success(t(`${ns}.deleted`, { name: row.name }));
      if (editId === row.id) goList();
    } catch {
      /* 409: the backend's Dari message (has transactions) is already toasted */
    }
  }

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: t(`${ns}.name`),
      sortable: true,
      cell: (r) => <span className="font-medium">{r.name}</span>,
    },
    {
      key: 'phone',
      header: t(`${ns}.phone`),
      cell: (r) => (r.phone ? <span dir="ltr">{r.phone}</span> : '—'),
    },
    {
      key: extraColumn,
      header: t(`${ns}.${extraColumn}`),
      cell: (r) => (
        <span className="block max-w-[16rem] truncate" title={String(r[extraColumn] ?? '')}>
          {String(r[extraColumn] ?? '') || '—'}
        </span>
      ),
    },
    {
      key: 'is_active',
      header: t('common.status'),
      cell: (r) =>
        r.is_active ? (
          <Badge tone="success">{t('common.active')}</Badge>
        ) : (
          <Badge>{t('common.inactive')}</Badge>
        ),
    },
    {
      key: 'created_at',
      header: t('partners.created_at'),
      sortable: true,
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
        <div className="flex justify-end gap-1">
          <IconButton
            label={t('common.edit')}
            onClick={() => navigate(`${base}/${r.id}/edit${query}`)}
          >
            <Pencil className="h-4 w-4" />
          </IconButton>
          <IconButton
            label={t(r.is_active ? 'partners.deactivate' : 'partners.activate')}
            tone={r.is_active ? 'danger' : 'brand'}
            onClick={() => void toggleActive(r)}
            data-testid={r.is_active ? 'deactivate' : 'activate'}
          >
            {r.is_active ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
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
        title={t(`${ns}.title`)}
        description={t(`${ns}.description`)}
        action={
          <Button onClick={() => navigate(`${base}/new${query}`)} data-testid="add-partner">
            <Plus className="h-4 w-4" />
            {t(`${ns}.add_button`)}
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
            placeholder={t(`${ns}.search_placeholder`)}
            aria-label={t('common.search')}
            className="ps-9"
            data-testid="partner-search"
          />
        </div>
        <div className="w-44">
          <Select
            value={active}
            onChange={(e) => setActive(e.target.value)}
            aria-label={t('common.status')}
            placeholder={t('partners.all')}
            options={[
              { value: 'true', label: t('partners.active_only') },
              { value: 'false', label: t('partners.inactive_only') },
            ]}
            data-testid="active-filter"
          />
        </div>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={(r) => navigate(`${base}/${r.id}/edit${query}`)}
        isLoading={list.isFetching && !list.data}
        emptyMessage={t(`${ns}.no_results`)}
        caption={t(`${ns}.title`)}
        rowClassName={(r) => !r.is_active && 'text-gray-500 dark:text-gray-400'}
        sort={sort}
        onSort={onSort}
      />
      {isNew && (
        <PartnerDrawer
          ns={ns}
          endpoint={endpoint}
          fields={fields}
          onClose={returnTo ? () => navigate(returnTo) : goList}
          onCreated={(r) => {
            // Opened from another form's «add new» link: go back there with the new id.
            if (returnTo)
              navigate(`${returnTo}${returnTo.includes('?') ? '&' : '?'}new_${ns}=${r.id}`);
            else goList();
          }}
        />
      )}
      {editId && (
        <EditPartner ns={ns} endpoint={endpoint} fields={fields} id={editId} onClose={goList} />
      )}
    </>
  );
}

interface DrawerProps {
  ns: string;
  endpoint: string;
  fields: PartnerField[];
  onClose(): void;
}

function EditPartner({ id, ...props }: DrawerProps & { id: number }): JSX.Element {
  const { t } = useTranslation();
  const item = useItem<Row>([props.ns, 'item'], `${props.endpoint}${id}/`);
  if (!item.data) {
    return (
      <Drawer open onClose={props.onClose} title={t(`${props.ns}.edit_title`)}>
        <Spinner className="mx-auto h-6 w-6" />
      </Drawer>
    );
  }
  return <PartnerDrawer {...props} row={item.data} />;
}

function PartnerDrawer({
  ns,
  endpoint,
  fields,
  row,
  onClose,
  onCreated,
}: DrawerProps & { row?: Row; onCreated?: (row: Row) => void }): JSX.Element {
  const { t } = useTranslation();
  const key = [ns];
  const create = useCreate<Row, FieldValues>(endpoint, [key], {
    success: (r) => t(`${ns}.created`, { name: r.name }),
  });
  const update = useUpdate<Row, FieldValues>((id) => `${endpoint}${id}/`, [key], {
    success: (r) => t(`${ns}.updated`, { name: r.name }),
  });
  const schema = useMemo(() => buildSchema(fields), [fields]);
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      ...Object.fromEntries(fields.map((f) => [f.name, String(row?.[f.name] ?? '')])),
      is_active: row?.is_active ?? true,
    },
  });

  async function onSubmit(values: FormValues): Promise<void> {
    try {
      if (row) {
        await update.mutateAsync({ id: row.id, data: values });
        onClose();
      } else {
        const created = await create.mutateAsync(values);
        (onCreated ?? onClose)(created);
      }
    } catch (err) {
      for (const [field, message] of Object.entries(fieldErrors(err))) setError(field, { message });
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={row ? t(`${ns}.edit_title`) : t(`${ns}.add_button`)}
      description={row?.name}
      onSubmit={(e) => void handleSubmit(onSubmit)(e)}
      submitting={create.isPending || update.isPending}
    >
      {fields.map((f, i) => {
        const error = errors[f.name]?.message;
        const digits = f.kind === 'phone' || f.kind === 'digits';
        const reg = register(f.name, {
          // Dari / Arabic digits → English as soon as the field is left (the API does it too).
          onBlur: digits
            ? (e: { target: { value: string } }) =>
                setValue(f.name, normalizeDigits(e.target.value), { shouldValidate: true })
            : undefined,
        });
        return (
          <FormField
            key={f.name}
            label={t(`${ns}.${f.name}`)}
            error={typeof error === 'string' ? error : undefined}
            required={f.required}
          >
            {f.kind === 'textarea' ? (
              <Textarea {...reg} maxLength={f.maxLength} rows={4} />
            ) : (
              <Input
                {...reg}
                maxLength={f.maxLength}
                dir={f.ltr || digits ? 'ltr' : undefined}
                inputMode={f.kind === 'phone' ? 'tel' : undefined}
                className={f.ltr || digits ? 'text-start' : undefined}
                data-autofocus={i === 0 || undefined}
              />
            )}
          </FormField>
        );
      })}
      <Controller
        control={control}
        name="is_active"
        render={({ field }) => (
          <Switch
            checked={Boolean(field.value)}
            onChange={field.onChange}
            label={t('common.active')}
            showLabel
            id="partner-active"
          />
        )}
      />
    </Drawer>
  );
}
