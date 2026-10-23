import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound, Lock, Pencil, Plus, Search, Unlock, UserCheck, UserX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMatch, useNavigate } from 'react-router-dom';
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
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Switch } from '@/components/ui/Switch';
import { fieldErrors } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dualDateTime } from '@/lib/date';
import { normalizeDigits } from '@/lib/digits';
import { useCreate, useDebounced, useItem, useList, useUpdate } from '@/lib/hooks';
import { passwordStrength, type Strength } from '@/lib/password';
import { useAuth } from '@/stores/auth';
import type { Branch, Role, User } from '@/types/api';

const KEY = ['users'] as const;
const BASE = '/admin/users';

const baseSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, 'common.required')
    .max(150)
    .regex(/^[\w.@+-]+$/, 'users.username_invalid'),
  password: z.string(),
  first_name: z.string().trim().max(150),
  last_name: z.string().trim().max(150),
  email: z.union([z.literal(''), z.string().trim().email('users.email_invalid')]),
  phone: z
    .string()
    .trim()
    .max(40)
    .refine((v) => v === '' || /^\+?[\d\s-]+$/.test(normalizeDigits(v)), 'users.phone_invalid'),
  role: z.enum(['super_admin', 'branch_manager']),
  branch: z.string(),
  is_active: z.boolean(),
});

type FormValues = z.infer<typeof baseSchema>;

/** Mirrors UserSerializer.validate + User.clean: role ↔ branch, password on create. */
function schemaFor(creating: boolean) {
  return baseSchema.superRefine((v, ctx) => {
    if (v.role === 'branch_manager' && !v.branch) {
      ctx.addIssue({ code: 'custom', path: ['branch'], message: 'users.branch_required' });
    }
    if (creating && !v.password) {
      ctx.addIssue({ code: 'custom', path: ['password'], message: 'users.password_required' });
    } else if (v.password && v.password.length < 8) {
      ctx.addIssue({ code: 'custom', path: ['password'], message: 'users.password_too_short' });
    }
  });
}

interface UserPayload {
  username: string;
  password?: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  role: Role;
  branch: number | null;
  is_active: boolean;
}

function toPayload(v: FormValues): UserPayload {
  const { password, branch, ...rest } = v;
  return {
    ...rest,
    // A super admin never has a branch (DB constraint); send null whatever the form held.
    branch: v.role === 'super_admin' || !branch ? null : Number(branch),
    ...(password ? { password } : {}),
  };
}

export function Users(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const me = useAuth((s) => s.user);
  const isNew = Boolean(useMatch(`${BASE}/new`));
  const editId = Number(useMatch(`${BASE}/:id/edit`)?.params.id) || null;

  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [branch, setBranch] = useState('');
  const [active, setActive] = useState('');
  const query = useDebounced(search);
  const list = useList<User>([...KEY], '/users/', {
    search: query,
    role,
    branch,
    is_active: active,
  });
  const branches = useList<Branch>(['branches'], '/branches/');
  const branchName = useMemo(
    () => new Map((branches.data ?? []).map((b) => [b.id, b.name])),
    [branches.data],
  );

  const [resetFor, setResetFor] = useState<User | null>(null);
  const setActiveState = useUpdate<User, { is_active: boolean }>(
    (id) => `/users/${id}/`,
    [[...KEY]],
    {
      success: (u) =>
        t(u.is_active ? 'users.activated' : 'users.deactivated', { name: u.username }),
    },
  );

  async function toggleActive(user: User): Promise<void> {
    const deactivating = user.is_active;
    const ok = await confirm({
      title: t(deactivating ? 'users.deactivate_confirm_title' : 'users.activate_confirm_title', {
        name: user.username,
      }),
      message: t(deactivating ? 'users.deactivate_confirm' : 'users.activate_confirm'),
      variant: deactivating ? 'warning' : 'info',
      confirmLabel: t(deactivating ? 'users.deactivate' : 'users.activate'),
    });
    if (ok)
      await setActiveState
        .mutateAsync({ id: user.id, data: { is_active: !deactivating } })
        .catch(() => {});
  }

  const columns: Column<User>[] = [
    {
      key: 'username',
      header: t('users.username'),
      cell: (u) => (
        <span className="inline-flex items-center gap-2 font-medium" dir="ltr">
          {u.username}
          {u.is_locked && (
            <Badge tone="danger" data-testid="locked-badge">
              <Lock className="h-3 w-3" />
              {t('users.locked_badge')}
            </Badge>
          )}
        </span>
      ),
    },
    { key: 'full_name', header: t('users.full_name'), cell: (u) => u.full_name || '—' },
    {
      key: 'role',
      header: t('users.role'),
      cell: (u) => (
        <Badge tone={u.role === 'super_admin' ? 'brand' : 'accent'}>{t(`roles.${u.role}`)}</Badge>
      ),
    },
    {
      key: 'branch',
      header: t('users.branch'),
      cell: (u) => (u.branch ? (branchName.get(u.branch) ?? '…') : '—'),
    },
    {
      key: 'is_active',
      header: t('common.status'),
      cell: (u) =>
        u.is_active ? (
          <Badge tone="success">{t('common.active')}</Badge>
        ) : (
          <Badge>{t('common.inactive')}</Badge>
        ),
    },
    {
      key: 'last_login',
      header: t('users.last_login'),
      cell: (u) => {
        if (!u.last_login)
          return <span className="text-gray-500 dark:text-gray-400">{t('users.never')}</span>;
        const dt = dualDateTime(u.last_login);
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
      cell: (u) => (
        <div className="flex justify-end gap-1">
          <IconButton label={t('common.edit')} onClick={() => navigate(`${BASE}/${u.id}/edit`)}>
            <Pencil className="h-4 w-4" />
          </IconButton>
          <IconButton label={t('users.reset_password')} onClick={() => setResetFor(u)}>
            <KeyRound className="h-4 w-4" />
          </IconButton>
          {u.is_locked && <UnlockButton user={u} confirmUnlock={confirm} />}
          {u.id !== me?.id && (
            <IconButton
              label={t(u.is_active ? 'users.deactivate' : 'users.activate')}
              tone={u.is_active ? 'danger' : 'brand'}
              onClick={() => void toggleActive(u)}
              data-testid={u.is_active ? 'deactivate' : 'activate'}
            >
              {u.is_active ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
            </IconButton>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('users.title')}
        description={t('users.description')}
        action={
          <Button onClick={() => navigate(`${BASE}/new`)} data-testid="add-user">
            <Plus className="h-4 w-4" />
            {t('users.add_button')}
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
            placeholder={t('users.search_placeholder')}
            aria-label={t('common.search')}
            className="ps-9"
          />
        </div>
        <div className="w-40">
          <Select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            aria-label={t('users.role')}
            placeholder={t('users.all_roles')}
            options={[
              { value: 'super_admin', label: t('roles.super_admin') },
              { value: 'branch_manager', label: t('roles.branch_manager') },
            ]}
          />
        </div>
        <div className="w-44">
          <Select
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            aria-label={t('users.branch')}
            placeholder={t('users.all_branches')}
            options={(branches.data ?? []).map((b) => ({ value: b.id, label: b.name }))}
          />
        </div>
        <div className="w-36">
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
        rowKey={(u) => u.id}
        onRowClick={(u) => navigate(`${BASE}/${u.id}/edit`)}
        isLoading={list.isFetching && !list.data}
        emptyMessage={t('common.no_results')}
        caption={t('users.title')}
        rowClassName={(u) => !u.is_active && 'text-gray-500 dark:text-gray-400'}
      />
      {isNew && <UserDrawer branches={branches.data ?? []} onClose={() => navigate(BASE)} />}
      {editId && (
        <EditUser id={editId} branches={branches.data ?? []} onClose={() => navigate(BASE)} />
      )}
      {resetFor && <ResetPasswordDialog user={resetFor} onClose={() => setResetFor(null)} />}
    </>
  );
}

function UnlockButton({
  user,
  confirmUnlock,
}: {
  user: User;
  confirmUnlock: ReturnType<typeof useConfirm>;
}): JSX.Element {
  const { t } = useTranslation();
  const unlock = useCreate<{ detail: string }, Record<string, never>>(
    `/users/${user.id}/unlock/`,
    [[...KEY]],
    { success: () => t('users.unlocked', { name: user.username }) },
  );

  async function onClick(): Promise<void> {
    const ok = await confirmUnlock({
      title: t('users.unlock_confirm_title', { name: user.username }),
      message: t('users.unlock_confirm'),
      variant: 'info',
      confirmLabel: t('users.unlock_button'),
    });
    if (ok) await unlock.mutateAsync({}).catch(() => {});
  }

  return (
    <IconButton
      label={t('users.unlock_button')}
      tone="brand"
      onClick={() => void onClick()}
      disabled={unlock.isPending}
      data-testid="unlock"
    >
      <Unlock className="h-4 w-4" />
    </IconButton>
  );
}

function EditUser({
  id,
  branches,
  onClose,
}: {
  id: number;
  branches: Branch[];
  onClose(): void;
}): JSX.Element {
  const { t } = useTranslation();
  const item = useItem<User>([...KEY, 'item'], `/users/${id}/`);
  if (!item.data) {
    return (
      <Drawer open onClose={onClose} title={t('users.title')}>
        <Spinner className="mx-auto h-6 w-6" />
      </Drawer>
    );
  }
  return <UserDrawer user={item.data} branches={branches} onClose={onClose} />;
}

function UserDrawer({
  user,
  branches,
  onClose,
}: {
  user?: User;
  branches: Branch[];
  onClose(): void;
}): JSX.Element {
  const { t } = useTranslation();
  const create = useCreate<User, UserPayload>('/users/', [[...KEY], ['branches']], {
    success: (u) => t('users.created', { name: u.username }),
  });
  const update = useUpdate<User, UserPayload>((id) => `/users/${id}/`, [[...KEY], ['branches']], {
    success: (u) => t('users.updated', { name: u.username }),
  });
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schemaFor(!user)),
    defaultValues: {
      username: user?.username ?? '',
      password: '',
      first_name: user?.first_name ?? '',
      last_name: user?.last_name ?? '',
      email: user?.email ?? '',
      phone: user?.phone ?? '',
      role: user?.role ?? 'branch_manager',
      branch: user?.branch ? String(user.branch) : '',
      is_active: user?.is_active ?? true,
    },
  });
  const role = useWatch({ control, name: 'role' });
  const username = useWatch({ control, name: 'username' });
  const password = useWatch({ control, name: 'password' });
  // Active branches, plus the user's own branch even if it was deactivated since.
  const branchOptions = branches
    .filter((b) => b.is_active || b.id === user?.branch)
    .map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }));

  async function onSubmit(values: FormValues): Promise<void> {
    try {
      if (user) await update.mutateAsync({ id: user.id, data: toPayload(values) });
      else await create.mutateAsync(toPayload(values));
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
      title={user ? t('users.edit_title', { name: user.username }) : t('users.add_button')}
      onSubmit={(e) => void handleSubmit(onSubmit)(e)}
      submitting={create.isPending || update.isPending}
    >
      <FormField label={t('users.username')} error={errors.username?.message} required>
        <Input
          {...register('username')}
          dir="ltr"
          autoComplete="off"
          className="text-start"
          data-autofocus
        />
      </FormField>
      <FormField
        label={user ? t('users.change_password') : t('users.password')}
        error={errors.password?.message}
        hint={user ? t('users.change_password_hint') : t('users.password_rules')}
        required={!user}
      >
        <Input
          {...register('password')}
          type="password"
          dir="ltr"
          autoComplete="new-password"
          className="text-start"
        />
      </FormField>
      <PasswordMeter password={password} username={username} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('users.first_name')} error={errors.first_name?.message}>
          <Input {...register('first_name')} />
        </FormField>
        <FormField label={t('users.last_name')} error={errors.last_name?.message}>
          <Input {...register('last_name')} />
        </FormField>
      </div>
      <FormField label={t('users.email')} error={errors.email?.message}>
        <Input {...register('email')} type="email" dir="ltr" className="text-start" />
      </FormField>
      <FormField label={t('users.phone')} error={errors.phone?.message}>
        <Input {...register('phone')} dir="ltr" inputMode="tel" className="text-start" />
      </FormField>
      <FormField label={t('users.role')} error={errors.role?.message} required>
        <Select
          {...register('role')}
          options={[
            { value: 'branch_manager', label: t('roles.branch_manager') },
            { value: 'super_admin', label: t('roles.super_admin') },
          ]}
        />
      </FormField>
      {role === 'branch_manager' ? (
        <FormField label={t('users.branch')} error={errors.branch?.message} required>
          <Select
            {...register('branch')}
            placeholder={t('users.choose_branch')}
            options={branchOptions}
            data-testid="user-branch"
          />
        </FormField>
      ) : (
        <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
          {t('users.branch_not_needed')}
        </p>
      )}
      <Controller
        control={control}
        name="is_active"
        render={({ field }) => (
          <Switch
            checked={field.value}
            onChange={field.onChange}
            label={t('users.is_active')}
            showLabel
          />
        )}
      />
    </Drawer>
  );
}

const STRENGTH: Record<Strength, { width: string; color: string }> = {
  weak: { width: 'w-1/3', color: 'bg-red-500' },
  medium: { width: 'w-2/3', color: 'bg-amber-500' },
  strong: { width: 'w-full', color: 'bg-emerald-500' },
};

function PasswordMeter({
  password,
  username,
}: {
  password: string;
  username: string;
}): JSX.Element | null {
  const { t } = useTranslation();
  const strength = passwordStrength(password, username);
  if (!strength) return null;
  return (
    <div
      className="-mt-2"
      aria-live="polite"
      data-testid="password-strength"
      data-strength={strength}
    >
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            STRENGTH[strength].width,
            STRENGTH[strength].color,
          )}
        />
      </div>
      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
        {t('users.password_strength')}: {t(`users.password_strength_${strength}`)}
      </p>
    </div>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: User; onClose(): void }): JSX.Element {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const update = useUpdate<User, { password: string }>((id) => `/users/${id}/`, [[...KEY]], {
    success: () => t('users.reset_password_done', { name: user.username }),
  });

  async function submit(): Promise<void> {
    if (password.length < 8) {
      setError('users.password_too_short');
      return;
    }
    try {
      await update.mutateAsync({ id: user.id, data: { password } });
      onClose();
    } catch (err) {
      setError(fieldErrors(err).password);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('users.reset_password_title', { name: user.username })}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => void submit()}
            loading={update.isPending}
            data-testid="reset-submit"
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-3"
      >
        <FormField
          label={t('users.new_password')}
          error={error}
          hint={t('users.password_rules')}
          required
        >
          <Input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(undefined);
            }}
            dir="ltr"
            autoComplete="new-password"
            className="text-start"
            data-autofocus
            data-testid="reset-password-input"
          />
        </FormField>
        <PasswordMeter password={password} username={user.username} />
      </form>
    </Modal>
  );
}
