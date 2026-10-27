import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Building2,
  Route,
  Stamp,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { PageHeader } from '@/components/layout/PageHeader';
import { FormField } from '@/components/ui/FormField';
import { Select } from '@/components/ui/Select';
import { cn } from '@/lib/cn';
import { useList } from '@/lib/hooks';
import { TRADE_TYPES, type TradeType } from '@/lib/transactionSections';
import { useAuth } from '@/stores/auth';
import type { Branch } from '@/types/api';

const ICONS: Record<TradeType, LucideIcon> = {
  IMPORT: ArrowDownToLine,
  EXPORT: ArrowUpFromLine,
  TRANSIT: Route,
  TIR_CARNET: Stamp,
};

/**
 * /transactions/new — step 1: the trade type decides which fields the form shows. A branch
 * manager always works in their own branch; a super admin picks the branch first (it also
 * decides the form, through that branch's FieldConfig).
 */
export function TradeTypePicker(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const isSuperAdmin = user?.role === 'super_admin';
  const [params, setParams] = useSearchParams();
  const branch = isSuperAdmin ? (params.get('branch') ?? '') : String(user?.branch_id ?? '');
  const branches = useList<Branch>(['branches'], '/branches/', { is_active: true });

  return (
    <>
      <PageHeader
        title={t('transactions.add_button')}
        description={t('transactions.pick_trade_type')}
      />
      {isSuperAdmin ? (
        <div className="mb-6 max-w-sm">
          <FormField
            label={t('transactions.branch')}
            required
            hint={!branch ? t('transactions.pick_branch_first') : undefined}
          >
            <Select
              value={branch}
              onChange={(e) =>
                setParams(e.target.value ? { branch: e.target.value } : {}, { replace: true })
              }
              placeholder={t('transactions.pick_branch_first')}
              options={(branches.data ?? []).map((b) => ({
                value: b.id,
                label: `${b.name} (${b.code})`,
              }))}
              data-testid="picker-branch"
            />
          </FormField>
        </div>
      ) : (
        <p
          className="mb-6 inline-flex items-center gap-2 rounded-lg bg-brand-light px-3 py-2 text-sm text-brand dark:bg-brand/30 dark:text-emerald-200"
          data-testid="picker-branch-context"
        >
          <Building2 className="h-4 w-4" />
          {t('transactions.branch_context', { name: user?.branch_name ?? '—' })}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {TRADE_TYPES.map((type) => {
          const Icon = ICONS[type];
          const disabled = !branch;
          return (
            <button
              key={type}
              type="button"
              disabled={disabled}
              onClick={() =>
                navigate(`/transactions/new/${type}${isSuperAdmin ? `?branch=${branch}` : ''}`)
              }
              data-testid={`trade-card-${type}`}
              className={cn(
                'flex items-start gap-4 rounded-xl border border-gray-200 bg-white p-5 text-start transition-shadow',
                'hover:border-brand hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-gray-200 disabled:hover:shadow-none',
                'dark:border-gray-700 dark:bg-gray-800',
              )}
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-light text-brand dark:bg-brand/30 dark:text-emerald-200">
                <Icon className="h-6 w-6" />
              </span>
              <span>
                <span className="block text-lg font-semibold">{t(`trade_types.${type}`)}</span>
                <span className="mt-1 block text-sm text-gray-600 dark:text-gray-400">
                  {t(`trade_type_hints.${type}`)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
