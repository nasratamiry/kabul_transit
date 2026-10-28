import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  GripVertical,
  History,
  Lock,
  Pencil,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useBlocker, useMatch, useNavigate, useSearchParams } from 'react-router';

import { HistoryModal } from '@/components/finance/shared';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useConfirm } from '@/components/ui/confirm-context';
import { FormField } from '@/components/ui/FormField';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Switch } from '@/components/ui/Switch';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/cn';
import { normalizeNumber, useDigitLocale } from '@/lib/digits';
import {
  INCOME_CATEGORIES_KEY,
  MONEY_TYPES_KEY,
  useBranches,
  useIncomeCategories,
  useMoneyTypes,
} from '@/lib/finance';
import { toastError } from '@/lib/hooks';
import { REPORT_KEY } from '@/lib/reports';
import { TRADE_TYPES, moneyName, type TradeType } from '@/lib/transactionSections';
import { FormPreview } from '@/pages/transactions/TransactionForm';
import type {
  FieldVisibility,
  FormConfig,
  MoneyFieldType,
  MoneyKind,
  MoneySection,
  MoneyVisibilityRow,
  OfficeIncomeCategory,
} from '@/types/api';

const BASE = '/admin/money-settings';
const VIS_KEY = ['money-visibility'] as const;
const VISIBILITIES: FieldVisibility[] = ['REQUIRED', 'OPTIONAL', 'HIDDEN'];
const EXPENSE_SECTIONS: MoneySection[] = ['COGS', 'OPEX', 'OTHER'];
const TABS = ['revenue', 'expenses', 'categories'] as const;
type Tab = (typeof TABS)[number];
const KIND_OF: Record<Exclude<Tab, 'categories'>, MoneyKind> = {
  revenue: 'REVENUE',
  expenses: 'EXPENSE',
};

type Editable = Pick<
  MoneyFieldType,
  'name_fa' | 'name_ps' | 'name_en' | 'section' | 'sort_order' | 'is_active' | 'kind'
>;
type TypeEdit = Partial<Editable>;
const EDITABLE: (keyof Editable)[] = [
  'name_fa',
  'name_ps',
  'name_en',
  'section',
  'sort_order',
  'is_active',
  'kind',
];

const names = (
  t: Pick<MoneyFieldType, 'name_fa' | 'name_ps' | 'name_en'>,
): {
  fa: string;
  ps: string;
  en: string;
} => ({ fa: t.name_fa, ps: t.name_ps, en: t.name_en });

/**
 * «مدیریت → عواید و مصارف» (super admin): every revenue and expense type of the transaction
 * form, built-in or added — names, order, revenue / expense, income-statement section, active,
 * and per branch × trade type «لازم / اختیاری / مخفی». Edits are staged and saved together
 * (POST /money-types/bulk/: all or nothing); adding and deleting a type are immediate. A
 * type's kind changes only while no transaction holds an amount of it (the API says 409
 * otherwise); customer_payment is always revenue. The third tab manages the office-income
 * categories. The preview shows the form's «عواید» and «مصارف» sections with staged settings.
 */
export function MoneySettings(): JSX.Element {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const d = useDigitLocale();
  const [params, setParams] = useSearchParams();
  const { branches, name: branchName } = useBranches();
  const tabParam = params.get('tab') as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : 'revenue';
  const branch = Number(params.get('branch')) || null;
  const typeParam = params.get('type') as TradeType | null;
  const tradeType: TradeType = typeParam && TRADE_TYPES.includes(typeParam) ? typeParam : 'IMPORT';
  const historyId = Number(useMatch(`${BASE}/:id/history`)?.params.id) || null;
  const lang = i18n.language;

  useEffect(() => {
    const first = branches[0];
    if (!branch && first) {
      setParams((p) => {
        p.set('branch', String(first.id));
        return p;
      });
    }
  }, [branch, branches, setParams]);

  const { types } = useMoneyTypes();
  const scope = { branch, trade_type: tradeType };
  const visibility = useQuery({
    queryKey: [...VIS_KEY, scope],
    queryFn: () => api.get<MoneyVisibilityRow[]>('/money-types/visibility/', { params: scope }),
    enabled: branch !== null,
  });
  const savedVis = useMemo(
    () => new Map((visibility.data ?? []).map((r) => [r.money_type, r])),
    [visibility.data],
  );

  // Unsaved edits: per type (names, order, kind, section, active) and per type's visibility
  // in the selected branch × trade type. A value set back to the saved one is dropped.
  const [typeEdits, setTypeEdits] = useState<Record<number, TypeEdit>>({});
  const [visEdits, setVisEdits] = useState<Record<number, FieldVisibility>>({});
  const [allBranches, setAllBranches] = useState(false);
  const [allTypes, setAllTypes] = useState(false);
  const saved = useMemo(() => new Map(types.map((x) => [x.id, x])), [types]);
  const current = useMemo(
    () => types.map((x) => ({ ...x, ...typeEdits[x.id] })),
    [types, typeEdits],
  );
  const typeChanges = Object.entries(typeEdits).map(([id, edit]) => ({ id: Number(id), ...edit }));
  const visChanges = Object.entries(visEdits).map(([id, v]) => ({
    money_type: Number(id),
    visibility: v,
  }));
  const changeCount = typeChanges.length + visChanges.length;
  const dirty = changeCount > 0;
  const vis = (id: number): FieldVisibility =>
    visEdits[id] ?? savedVis.get(id)?.visibility ?? 'OPTIONAL';

  function stageType(id: number, edit: TypeEdit): void {
    const before = saved.get(id);
    if (!before) return;
    setTypeEdits((prev) => {
      const merged: TypeEdit = { ...prev[id], ...edit };
      for (const key of EDITABLE) {
        if (key in merged && merged[key] === before[key]) delete merged[key];
      }
      const next = { ...prev };
      if (Object.keys(merged).length) next[id] = merged;
      else delete next[id];
      return next;
    });
  }

  async function stageVisibility(row: MoneyFieldType, v: FieldVisibility): Promise<void> {
    const count = savedVis.get(row.id)?.count ?? 0;
    if (v === 'HIDDEN' && count > 0) {
      const ok = await confirm({
        title: t('money_settings.hide_title', { name: moneyName(names(row), lang) }),
        message: t('money_settings.hide_message', { count: d(count) }),
        variant: 'warning',
        confirmLabel: t('money_settings.hide_confirm'),
      });
      if (!ok) return;
    }
    setVisEdits((prev) => {
      const next = { ...prev };
      if (v === (savedVis.get(row.id)?.visibility ?? 'OPTIONAL')) delete next[row.id];
      else next[row.id] = v;
      return next;
    });
  }

  async function stageActive(row: MoneyFieldType, active: boolean): Promise<void> {
    const count = row.amounts_count ?? 0;
    if (!active && count > 0) {
      const ok = await confirm({
        title: t('money_settings.deactivate_title', { name: moneyName(names(row), lang) }),
        message: t('money_settings.deactivate_message', { count: d(count) }),
        variant: 'warning',
        confirmLabel: t('money_settings.deactivate_confirm'),
      });
      if (!ok) return;
    }
    stageType(row.id, { is_active: active });
  }

  async function stageKind(row: MoneyFieldType): Promise<void> {
    const to: MoneyKind = row.kind === 'REVENUE' ? 'EXPENSE' : 'REVENUE';
    const ok = await confirm({
      title: t('money_settings.kind_title', { name: moneyName(names(row), lang) }),
      message: t(
        to === 'REVENUE' ? 'money_settings.kind_to_revenue' : 'money_settings.kind_to_expense',
      ),
      variant: 'warning',
      confirmLabel: t(
        to === 'REVENUE' ? 'money_settings.make_revenue' : 'money_settings.make_expense',
      ),
    });
    if (!ok) return;
    const before = saved.get(row.id);
    stageType(row.id, {
      kind: to,
      section: to === 'REVENUE' ? 'REVENUE' : before?.kind === 'EXPENSE' ? before.section : 'COGS',
    });
  }

  /** Moves a type within its list and renumbers that list's own sort_order values. */
  function move(list: MoneyFieldType[], from: number, to: number): void {
    if (from === to || to < 0 || to >= list.length) return;
    const order = [...list];
    const [moved] = order.splice(from, 1);
    if (!moved) return;
    order.splice(to, 0, moved);
    const slots = list.map((x) => x.sort_order).sort((a, b) => a - b);
    for (let i = 1; i < slots.length; i++) {
      if ((slots[i] ?? 0) <= (slots[i - 1] ?? 0)) slots[i] = (slots[i - 1] ?? 0) + 1;
    }
    order.forEach((x, i) => stageType(x.id, { sort_order: slots[i] ?? x.sort_order }));
  }

  function discard(): void {
    setTypeEdits({});
    setVisEdits({});
  }

  const leaveMessage = (): Promise<boolean> =>
    confirm({
      title: t('field_settings.leave_title'),
      message: t('field_settings.leave_message', { count: changeCount }),
      variant: 'warning',
      confirmLabel: t('field_settings.leave_confirm'),
    });

  // Leaving the page (not opening a type's history) with unsaved changes asks first.
  const blocker = useBlocker(
    ({ nextLocation }) => dirty && !nextLocation.pathname.startsWith(BASE),
  );
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    void leaveMessage().then((ok) => (ok ? blocker.proceed() : blocker.reset()));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per blocked navigation
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent): void => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function setParam(key: 'branch' | 'type' | 'tab', value: string): Promise<void> {
    // Visibility edits belong to one branch × trade type; changing it drops them.
    if (key !== 'tab' && visChanges.length && !(await leaveMessage())) return;
    if (key !== 'tab') setVisEdits({});
    setParams((p) => {
      p.set(key, value);
      return p;
    });
  }

  async function refresh(): Promise<void> {
    await Promise.all([
      qc.invalidateQueries({ queryKey: [...MONEY_TYPES_KEY] }),
      qc.invalidateQueries({ queryKey: [...VIS_KEY] }),
      qc.invalidateQueries({ queryKey: ['form-config'] }),
      qc.invalidateQueries({ queryKey: ['statement-lines'] }),
      qc.invalidateQueries({ queryKey: [...REPORT_KEY] }),
    ]);
  }

  const save = useMutation({
    mutationFn: () =>
      api.post<{ changed: number }>(
        '/money-types/bulk/',
        {
          types: typeChanges,
          visibility: visChanges.length
            ? {
                branch,
                trade_type: tradeType,
                all_branches: allBranches,
                all_trade_types: allTypes,
                rows: visChanges,
              }
            : undefined,
        },
        { skipErrorToast: true },
      ),
    onError: toastError,
    onSuccess: async (data) => {
      discard();
      toast.success(t('money_settings.saved', { count: data.changed, n: d(data.changed) }), {
        id: 'ms-saved',
      });
      await refresh();
    },
  });

  const [adding, setAdding] = useState(false);
  const [editingNames, setEditingNames] = useState<MoneyFieldType | null>(null);

  async function onDelete(row: MoneyFieldType): Promise<void> {
    const ok = await confirm({
      title: t('money_settings.delete_title', { name: moneyName(names(row), lang) }),
      message: t('money_settings.delete_message'),
      variant: 'danger',
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    try {
      await api.delete(`/money-types/${row.id}/`, { skipErrorToast: true });
      stageType(row.id, {});
      toast.success(t('money_settings.deleted'));
      await refresh();
    } catch (err) {
      toastError(err);
    }
  }

  const kind = tab === 'categories' ? null : KIND_OF[tab];
  const list = kind
    ? current.filter((x) => x.kind === kind).sort((a, b) => a.sort_order - b.sort_order)
    : [];

  // The two money sections of the form, as the branch manager will see them after saving.
  const previewConfig: FormConfig | null = branch
    ? {
        branch,
        trade_type: tradeType,
        trade_type_label: t(`trade_types.${tradeType}`),
        form_fields: current
          .filter((x) => x.is_active && vis(x.id) !== 'HIDDEN')
          .map((x) => ({
            field_name: x.source,
            label_fa: x.name_fa,
            visibility: vis(x.id) as 'REQUIRED' | 'OPTIONAL',
            required: vis(x.id) === 'REQUIRED',
            sort_order: x.sort_order,
            money: { code: x.code, kind: x.kind, section: x.section, names: names(x) },
          })),
      }
    : null;

  const scopeLabel = branch
    ? `${branchName(branch)} — ${t(`trade_types.${tradeType}`)}`
    : t(`trade_types.${tradeType}`);
  const historyType = types.find((x) => x.id === historyId);

  return (
    <>
      <PageHeader
        title={t('money_settings.title')}
        description={t('money_settings.description')}
        action={
          tab !== 'categories' && (
            <Button onClick={() => setAdding(true)} data-testid="ms-add">
              <Plus className="h-4 w-4" />
              {t(tab === 'revenue' ? 'money_settings.add_revenue' : 'money_settings.add_expense')}
            </Button>
          )
        }
      />

      <div
        role="tablist"
        aria-label={t('money_settings.title')}
        className="mb-4 flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800"
      >
        {TABS.map((x) => (
          <button
            key={x}
            type="button"
            role="tab"
            aria-selected={x === tab}
            onClick={() => x !== tab && void setParam('tab', x)}
            className={cn(
              'rounded-md px-4 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
              x === tab
                ? 'bg-white text-brand shadow-sm dark:bg-gray-700 dark:text-emerald-200'
                : 'text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white',
            )}
            data-testid={`ms-tab-${x}`}
          >
            {t(`money_settings.tab_${x}`)}
          </button>
        ))}
      </div>

      {tab === 'categories' ? (
        <CategoriesPanel />
      ) : (
        <>
          <p className="mb-4 text-sm text-gray-700 dark:text-gray-300">
            {t(tab === 'revenue' ? 'money_settings.revenue_rule' : 'money_settings.expense_rule')}
          </p>
          <Card className="mb-4 flex flex-wrap items-end gap-4 p-4">
            <div className="w-full max-w-xs">
              <label className="block space-y-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                <span>{t('money_settings.scope_branch')}</span>
                <Select
                  value={branch ?? ''}
                  onChange={(e) => void setParam('branch', e.target.value)}
                  options={branches.map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))}
                  data-testid="ms-branch"
                />
              </label>
            </div>
            <div className="w-full max-w-xs">
              <label className="block space-y-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                <span>{t('money_settings.scope_type')}</span>
                <Select
                  value={tradeType}
                  onChange={(e) => void setParam('type', e.target.value)}
                  options={TRADE_TYPES.map((x) => ({ value: x, label: t(`trade_types.${x}`) }))}
                  data-testid="ms-trade-type"
                />
              </label>
            </div>
            <div className="flex flex-col gap-2 pb-1">
              <Switch
                checked={allBranches}
                onChange={setAllBranches}
                label={t('money_settings.apply_all_branches')}
                showLabel
                id="ms-all-branches"
              />
              <Switch
                checked={allTypes}
                onChange={setAllTypes}
                label={t('money_settings.apply_all_types')}
                showLabel
                id="ms-all-types"
              />
            </div>
            <p className="w-full text-xs text-gray-600 dark:text-gray-400">
              {t('money_settings.scope_hint', { scope: scopeLabel })}
            </p>
          </Card>

          {!types.length || !visibility.data ? (
            <div className="flex justify-center p-10">
              <Spinner className="h-6 w-6" label={t('common.loading')} />
            </div>
          ) : (
            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
              <TypeList
                list={list}
                saved={saved}
                visibility={vis}
                counts={savedVis}
                lang={lang}
                onMove={(from, to) => move(list, from, to)}
                onVisibility={(row, v) => void stageVisibility(row, v)}
                onActive={(row, v) => void stageActive(row, v)}
                onSection={(row, s) => stageType(row.id, { section: s })}
                onKind={(row) => void stageKind(row)}
                onNames={setEditingNames}
                onDelete={(row) => void onDelete(row)}
                onHistory={(row) => void navigate(`${BASE}/${row.id}/history?${params.toString()}`)}
              />
              <aside
                className="xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto"
                aria-labelledby="ms-preview-title"
                data-testid="ms-preview"
              >
                <div className="mb-3 rounded-xl border border-dashed border-brand/40 bg-brand-light/40 p-3 dark:border-emerald-700 dark:bg-brand/10">
                  <h2
                    id="ms-preview-title"
                    className="font-semibold text-brand dark:text-emerald-300"
                  >
                    {t('money_settings.preview')}
                  </h2>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    {t('field_settings.preview_hint', { scope: scopeLabel })}
                  </p>
                </div>
                {previewConfig && (
                  <FormPreview
                    key={`${branch}-${tradeType}`}
                    config={previewConfig}
                    only={['revenue', 'expenses']}
                  />
                )}
              </aside>
            </div>
          )}
        </>
      )}

      {dirty && (
        <div
          className="sticky bottom-0 z-20 -mx-4 mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur dark:border-gray-700 dark:bg-gray-900/95"
          role="status"
          data-testid="ms-unsaved-bar"
        >
          <span className="font-medium text-accent-dark dark:text-orange-300">
            {t('money_settings.unsaved', { count: changeCount, n: d(changeCount) })}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={discard} data-testid="ms-cancel">
              {t('common.cancel')}
            </Button>
            <Button onClick={() => save.mutate()} loading={save.isPending} data-testid="ms-save">
              <Save className="h-4 w-4" />
              {t('common.save')}
            </Button>
          </div>
        </div>
      )}

      {adding && kind && (
        <AddTypeDialog
          kind={kind}
          list={list}
          onClose={() => setAdding(false)}
          onCreated={async () => {
            setAdding(false);
            await refresh();
          }}
        />
      )}
      {editingNames && (
        <NamesDialog
          row={{ ...editingNames, ...typeEdits[editingNames.id] }}
          onClose={() => setEditingNames(null)}
          onApply={(edit) => {
            stageType(editingNames.id, edit);
            setEditingNames(null);
          }}
        />
      )}
      {historyId && (
        <HistoryModal
          endpoint="/money-types/"
          id={historyId}
          ns="money_settings"
          title={historyType ? moneyName(names(historyType), lang) : undefined}
          onClose={() => void navigate(`${BASE}?${params.toString()}`)}
        />
      )}
    </>
  );
}

interface TypeListProps {
  list: MoneyFieldType[];
  saved: Map<number, MoneyFieldType>;
  visibility(id: number): FieldVisibility;
  counts: Map<number, MoneyVisibilityRow>;
  lang: string;
  onMove(from: number, to: number): void;
  onVisibility(row: MoneyFieldType, v: FieldVisibility): void;
  onActive(row: MoneyFieldType, active: boolean): void;
  onSection(row: MoneyFieldType, section: MoneySection): void;
  onKind(row: MoneyFieldType): void;
  onNames(row: MoneyFieldType): void;
  onDelete(row: MoneyFieldType): void;
  onHistory(row: MoneyFieldType): void;
}

/** One kind's types in form order: drag (or the arrow buttons) to reorder. */
function TypeList({
  list,
  saved,
  visibility,
  counts,
  lang,
  onMove,
  onVisibility,
  onActive,
  onSection,
  onKind,
  onNames,
  onDelete,
  onHistory,
}: TypeListProps): JSX.Element {
  const { t } = useTranslation();
  const d = useDigitLocale();
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  if (!list.length) {
    return (
      <Card className="p-6 text-center text-sm text-gray-600 dark:text-gray-400">
        {t('money_settings.empty')}
      </Card>
    );
  }
  return (
    <Card className="p-4" data-testid="ms-list">
      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
        {list.map((row, i) => {
          const label = moneyName(names(row), lang);
          const before = saved.get(row.id);
          const changed = before && EDITABLE.some((key) => before[key] !== row[key]);
          const amounts = row.amounts_count ?? 0;
          const inScope = counts.get(row.id)?.count ?? 0;
          const v = visibility(row.id);
          const visChanged = v !== (counts.get(row.id)?.visibility ?? 'OPTIONAL');
          const kindBlocked = row.locked || amounts > 0;
          return (
            <li
              key={row.id}
              draggable
              onDragStart={(e) => {
                setDragging(i);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', row.code);
              }}
              onDragOver={(e) => {
                if (dragging === null) return;
                e.preventDefault();
                setOver(i);
              }}
              onDragLeave={() => setOver((o) => (o === i ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging !== null) onMove(dragging, i);
                setDragging(null);
                setOver(null);
              }}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              className={cn(
                'space-y-2 py-3',
                dragging === i && 'opacity-50',
                over === i && dragging !== i && 'bg-brand-light/60 dark:bg-brand/20',
                !row.is_active && 'opacity-70',
              )}
              data-testid={`ms-row-${row.code}`}
              data-visibility={v}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-gray-400" aria-hidden />
                <div className="min-w-[10rem] flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 font-medium">
                    <span data-testid="ms-name">{label}</span>
                    {(changed || visChanged) && (
                      <span
                        className="h-2 w-2 rounded-full bg-accent"
                        title={t('field_settings.changed')}
                        aria-label={t('field_settings.changed')}
                        role="img"
                      />
                    )}
                    {row.locked && (
                      <span
                        className="text-gray-500 dark:text-gray-400"
                        title={t('money_settings.locked')}
                      >
                        <Lock className="h-3.5 w-3.5" aria-hidden />
                        <span className="sr-only">{t('money_settings.locked')}</span>
                      </span>
                    )}
                    {row.is_builtin && <Badge>{t('money_settings.builtin')}</Badge>}
                    {!row.is_active && <Badge tone="neutral">{t('money_settings.inactive')}</Badge>}
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    <code className="font-mono" dir="ltr">
                      {row.code}
                    </code>{' '}
                    · {t('money_settings.amounts', { count: amounts, n: d(amounts) })}
                    {inScope > 0 && ` · ${t('money_settings.in_scope', { n: d(inScope) })}`}
                  </span>
                </div>
                <div className="flex items-center">
                  <IconButton
                    label={t('field_settings.move_up', { field: label })}
                    disabled={i === 0}
                    onClick={() => onMove(i, i - 1)}
                    data-testid={`ms-up-${row.code}`}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    label={t('field_settings.move_down', { field: label })}
                    disabled={i === list.length - 1}
                    onClick={() => onMove(i, i + 1)}
                    data-testid={`ms-down-${row.code}`}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    label={t('money_settings.edit_names', { name: label })}
                    onClick={() => onNames(row)}
                    data-testid={`ms-names-${row.code}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    label={t('money_settings.history')}
                    onClick={() => onHistory(row)}
                    data-testid={`ms-history-${row.code}`}
                  >
                    <History className="h-4 w-4" />
                  </IconButton>
                  {!row.is_builtin && (
                    <IconButton
                      label={t('common.delete')}
                      tone="danger"
                      disabled={amounts > 0}
                      title={amounts > 0 ? t('money_settings.delete_blocked') : undefined}
                      onClick={() => onDelete(row)}
                      data-testid={`ms-delete-${row.code}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </IconButton>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 ps-7">
                <div
                  role="radiogroup"
                  aria-label={t('field_settings.visibility_of', { field: label })}
                  title={row.locked ? t('money_settings.locked') : undefined}
                  className={cn(
                    'inline-flex rounded-lg border border-gray-300 p-0.5 dark:border-gray-600',
                    row.locked && 'opacity-60',
                  )}
                >
                  {VISIBILITIES.map((option) => (
                    <label
                      key={option}
                      className={cn(
                        'cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium focus-within:ring-2 focus-within:ring-brand',
                        row.locked && 'cursor-not-allowed',
                        v === option
                          ? option === 'HIDDEN'
                            ? 'bg-gray-700 text-white dark:bg-gray-200 dark:text-gray-900'
                            : option === 'REQUIRED'
                              ? 'bg-brand text-white'
                              : 'bg-brand-light text-brand dark:bg-brand/40 dark:text-emerald-100'
                          : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700',
                      )}
                      data-testid={`ms-vis-${row.code}-${option}`}
                    >
                      <input
                        type="radio"
                        className="sr-only"
                        name={`ms-vis-${row.id}`}
                        value={option}
                        checked={v === option}
                        disabled={row.locked}
                        onChange={() => onVisibility(row, option)}
                      />
                      {t(`field_settings.visibility.${option}`)}
                    </label>
                  ))}
                </div>
                {row.kind === 'EXPENSE' && (
                  <div className="w-48">
                    <Select
                      value={row.section}
                      onChange={(e) => onSection(row, e.target.value as MoneySection)}
                      aria-label={t('money_settings.section_of', { name: label })}
                      options={EXPENSE_SECTIONS.map((s) => ({
                        value: s,
                        label: t(`statement_lines.sections.${s}`),
                      }))}
                      data-testid={`ms-section-${row.code}`}
                    />
                  </div>
                )}
                <Switch
                  checked={row.is_active}
                  onChange={(active) => onActive(row, active)}
                  disabled={row.locked}
                  label={t('money_settings.active')}
                  showLabel
                  id={`ms-active-${row.code}`}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={kindBlocked}
                  title={
                    row.locked
                      ? t('money_settings.locked')
                      : amounts > 0
                        ? t('money_settings.kind_blocked', { n: d(amounts) })
                        : undefined
                  }
                  onClick={() => onKind(row)}
                  data-testid={`ms-kind-${row.code}`}
                >
                  <ArrowLeftRight className="h-4 w-4" />
                  {t(
                    row.kind === 'REVENUE'
                      ? 'money_settings.make_expense'
                      : 'money_settings.make_revenue',
                  )}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Adds a type now (POST): names, section for an expense, and where it goes in the form. */
function AddTypeDialog({
  kind,
  list,
  onClose,
  onCreated,
}: {
  kind: MoneyKind;
  list: MoneyFieldType[];
  onClose(): void;
  onCreated(): Promise<void>;
}): JSX.Element {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const [values, setValues] = useState({ name_fa: '', name_ps: '', name_en: '' });
  const [section, setSection] = useState<MoneySection>('COGS');
  const [after, setAfter] = useState<string>(String(list[list.length - 1]?.id ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function position(): number {
    const index = list.findIndex((x) => String(x.id) === after);
    const a = index >= 0 ? (list[index]?.sort_order ?? 0) : 0;
    const next = list[index + 1];
    if (!next) return a + 10;
    return next.sort_order - a > 1 ? Math.floor((a + next.sort_order) / 2) : a + 1;
  }

  async function submit(): Promise<void> {
    if (!values.name_fa.trim()) {
      setError(t('common.required'));
      return;
    }
    setBusy(true);
    try {
      await api.post(
        '/money-types/',
        {
          name_fa: values.name_fa.trim(),
          name_ps: values.name_ps.trim(),
          name_en: values.name_en.trim(),
          kind,
          ...(kind === 'EXPENSE' ? { section } : {}),
          sort_order: position(),
        },
        { skipErrorToast: true },
      );
      toast.success(t('money_settings.created', { name: values.name_fa.trim() }));
      await onCreated();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t(kind === 'REVENUE' ? 'money_settings.add_revenue' : 'money_settings.add_expense')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy} data-testid="ms-add-submit">
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="ms-add-form">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t(
            kind === 'REVENUE'
              ? 'money_settings.add_revenue_hint'
              : 'money_settings.add_expense_hint',
          )}
        </p>
        <FormField label={t('money_settings.name_fa')} error={error ?? undefined} required>
          <Input
            value={values.name_fa}
            maxLength={100}
            onChange={(e) => setValues({ ...values, name_fa: e.target.value })}
            data-autofocus
            data-testid="ms-add-name_fa"
          />
        </FormField>
        <FormField label={t('money_settings.name_ps')}>
          <Input
            value={values.name_ps}
            maxLength={100}
            onChange={(e) => setValues({ ...values, name_ps: e.target.value })}
            data-testid="ms-add-name_ps"
          />
        </FormField>
        <FormField label={t('money_settings.name_en')}>
          <Input
            value={values.name_en}
            maxLength={100}
            dir="ltr"
            className="text-start"
            onChange={(e) => setValues({ ...values, name_en: e.target.value })}
            data-testid="ms-add-name_en"
          />
        </FormField>
        {kind === 'EXPENSE' && (
          <FormField label={t('money_settings.section')}>
            <Select
              value={section}
              onChange={(e) => setSection(e.target.value as MoneySection)}
              options={EXPENSE_SECTIONS.map((s) => ({
                value: s,
                label: t(`statement_lines.sections.${s}`),
              }))}
              data-testid="ms-add-section"
            />
          </FormField>
        )}
        <FormField label={t('money_settings.position')}>
          <Select
            value={after}
            onChange={(e) => setAfter(e.target.value)}
            options={[
              { value: '', label: t('money_settings.position_first') },
              ...list.map((x) => ({
                value: x.id,
                label: t('money_settings.position_after', {
                  name: moneyName(names(x), i18n.language),
                }),
              })),
            ]}
            data-testid="ms-add-position"
          />
        </FormField>
      </div>
    </Modal>
  );
}

/** Names in the three languages — staged with the page's other edits. */
function NamesDialog({
  row,
  onClose,
  onApply,
}: {
  row: MoneyFieldType;
  onClose(): void;
  onApply(edit: TypeEdit): void;
}): JSX.Element {
  const { t } = useTranslation();
  const [values, setValues] = useState({
    name_fa: row.name_fa,
    name_ps: row.name_ps,
    name_en: row.name_en,
  });
  const missing = !values.name_fa.trim();
  return (
    <Modal
      open
      onClose={onClose}
      title={t('money_settings.edit_names', { name: row.name_fa })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={missing}
            onClick={() =>
              onApply({
                name_fa: values.name_fa.trim(),
                name_ps: values.name_ps.trim(),
                name_en: values.name_en.trim(),
              })
            }
            data-testid="ms-names-apply"
          >
            {t('money_settings.apply')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {(['name_fa', 'name_ps', 'name_en'] as const).map((key) => (
          <FormField
            key={key}
            label={t(`money_settings.${key}`)}
            required={key === 'name_fa'}
            error={key === 'name_fa' && missing ? t('common.required') : undefined}
          >
            <Input
              value={values[key]}
              maxLength={100}
              dir={key === 'name_en' ? 'ltr' : undefined}
              className={key === 'name_en' ? 'text-start' : undefined}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })}
              data-testid={`ms-edit-${key}`}
            />
          </FormField>
        ))}
        <p className="text-xs text-gray-600 dark:text-gray-400">{t('money_settings.names_hint')}</p>
      </div>
    </Modal>
  );
}

/** «کتگوری عواید دفتر»: the office-income categories (each one «سایر عواید» line). Saved at once. */
function CategoriesPanel(): JSX.Element {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const d = useDigitLocale();
  const { categories, isPending } = useIncomeCategories();
  const [editing, setEditing] = useState<OfficeIncomeCategory | 'new' | null>(null);
  const [history, setHistory] = useState<OfficeIncomeCategory | null>(null);

  async function refresh(): Promise<void> {
    await Promise.all([
      qc.invalidateQueries({ queryKey: [...INCOME_CATEGORIES_KEY] }),
      qc.invalidateQueries({ queryKey: ['statement-lines'] }),
    ]);
  }

  async function onDelete(row: OfficeIncomeCategory): Promise<void> {
    const ok = await confirm({
      title: t('money_settings.category_delete_title', { name: row.name_fa }),
      message: t('money_settings.category_delete_message'),
      variant: 'danger',
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    try {
      await api.delete(`/office-income-categories/${row.id}/`, { skipErrorToast: true });
      toast.success(t('money_settings.category_deleted'));
      await refresh();
    } catch (err) {
      toastError(err);
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {t('money_settings.categories_rule')}
        </p>
        <Button onClick={() => setEditing('new')} data-testid="ms-add-category">
          <Plus className="h-4 w-4" />
          {t('money_settings.add_category')}
        </Button>
      </div>
      {isPending ? (
        <div className="flex justify-center p-10">
          <Spinner className="h-6 w-6" label={t('common.loading')} />
        </div>
      ) : (
        <Card className="overflow-x-auto" data-testid="ms-categories">
          <table className="w-full min-w-[36rem] text-sm">
            <caption className="sr-only">{t('money_settings.tab_categories')}</caption>
            <thead className="bg-gray-50 text-xs text-gray-600 dark:bg-gray-900 dark:text-gray-400">
              <tr>
                <th scope="col" className="px-4 py-2 text-start">
                  {t('money_settings.name')}
                </th>
                <th scope="col" className="px-4 py-2 text-start">
                  {t('money_settings.code')}
                </th>
                <th scope="col" className="px-4 py-2 text-end">
                  {t('money_settings.order')}
                </th>
                <th scope="col" className="px-4 py-2 text-end">
                  {t('money_settings.incomes')}
                </th>
                <th scope="col" className="px-4 py-2 text-start">
                  {t('money_settings.active')}
                </th>
                <th scope="col" className="px-4 py-2">
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {categories.map((c) => (
                <tr key={c.id} data-testid={`ms-category-${c.code}`}>
                  <td className="px-4 py-2 font-medium">
                    {moneyName({ fa: c.name_fa, ps: c.name_ps, en: c.name_en }, i18n.language)}
                  </td>
                  <td className="px-4 py-2">
                    <code className="font-mono text-xs" dir="ltr">
                      {c.code}
                    </code>
                  </td>
                  <td className="px-4 py-2 text-end tabular-nums">{d(c.sort_order)}</td>
                  <td className="px-4 py-2 text-end tabular-nums">{d(c.incomes_count)}</td>
                  <td className="px-4 py-2">
                    {c.is_active ? (
                      <Badge tone="brand">{t('money_settings.active')}</Badge>
                    ) : (
                      <Badge>{t('money_settings.inactive')}</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <IconButton label={t('money_settings.history')} onClick={() => setHistory(c)}>
                        <History className="h-4 w-4" />
                      </IconButton>
                      <IconButton
                        label={t('common.edit')}
                        onClick={() => setEditing(c)}
                        data-testid={`ms-category-edit-${c.code}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </IconButton>
                      <IconButton
                        label={t('common.delete')}
                        tone="danger"
                        disabled={c.incomes_count > 0}
                        title={
                          c.incomes_count > 0
                            ? t('money_settings.category_delete_blocked')
                            : undefined
                        }
                        onClick={() => void onDelete(c)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {editing && (
        <CategoryDialog
          row={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      )}
      {history && (
        <HistoryModal
          endpoint="/office-income-categories/"
          id={history.id}
          ns="money_settings"
          title={history.name_fa}
          onClose={() => setHistory(null)}
        />
      )}
    </>
  );
}

function CategoryDialog({
  row,
  onClose,
  onSaved,
}: {
  row: OfficeIncomeCategory | null;
  onClose(): void;
  onSaved(): Promise<void>;
}): JSX.Element {
  const { t } = useTranslation();
  const api = useApi();
  const [values, setValues] = useState({
    name_fa: row?.name_fa ?? '',
    name_ps: row?.name_ps ?? '',
    name_en: row?.name_en ?? '',
    sort_order: String(row?.sort_order ?? 100),
    is_active: row?.is_active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const missing = !values.name_fa.trim();

  async function submit(): Promise<void> {
    setBusy(true);
    const body = {
      name_fa: values.name_fa.trim(),
      name_ps: values.name_ps.trim(),
      name_en: values.name_en.trim(),
      sort_order: normalizeNumber(values.sort_order) || '100',
      is_active: values.is_active,
    };
    try {
      if (row)
        await api.patch(`/office-income-categories/${row.id}/`, body, { skipErrorToast: true });
      else await api.post('/office-income-categories/', body, { skipErrorToast: true });
      toast.success(t('money_settings.category_saved'));
      await onSaved();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={row ? t('money_settings.edit_category') : t('money_settings.add_category')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={missing}
            loading={busy}
            onClick={() => void submit()}
            data-testid="ms-category-submit"
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="ms-category-form">
        {(['name_fa', 'name_ps', 'name_en'] as const).map((key) => (
          <FormField
            key={key}
            label={t(`money_settings.${key}`)}
            required={key === 'name_fa'}
            error={key === 'name_fa' && missing ? t('common.required') : undefined}
          >
            <Input
              value={values[key]}
              maxLength={100}
              dir={key === 'name_en' ? 'ltr' : undefined}
              className={key === 'name_en' ? 'text-start' : undefined}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })}
              data-testid={`ms-category-${key}`}
            />
          </FormField>
        ))}
        <FormField label={t('money_settings.order')}>
          <Input
            value={values.sort_order}
            inputMode="numeric"
            dir="ltr"
            className="text-start"
            onChange={(e) => setValues({ ...values, sort_order: e.target.value })}
          />
        </FormField>
        <Switch
          checked={values.is_active}
          onChange={(v) => setValues({ ...values, is_active: v })}
          label={t('money_settings.active')}
          showLabel
          id="ms-category-active"
        />
      </div>
    </Modal>
  );
}
