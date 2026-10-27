import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  CopyPlus,
  GripVertical,
  History,
  Lock,
  RotateCcw,
  Save,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useBlocker, useMatch, useNavigate, useSearchParams } from 'react-router';

import { HistoryModal } from '@/components/finance/shared';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useConfirm } from '@/components/ui/confirm-context';
import { IconButton } from '@/components/ui/IconButton';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useBranches } from '@/lib/finance';
import { toastError } from '@/lib/hooks';
import { SECTIONS, TRADE_TYPES, type TradeType } from '@/lib/transactionSections';
import { FormPreview } from '@/pages/transactions/TransactionForm';
import type { FieldConfigRow, FieldVisibility, FormConfig } from '@/types/api';

const BASE = '/admin/field-settings';
const KEY = ['field-configs'] as const;
const VISIBILITIES: FieldVisibility[] = ['REQUIRED', 'OPTIONAL', 'HIDDEN'];
/** Form position of every field, to break sort_order ties the same way on every render. */
const POSITION = new Map(SECTIONS.flatMap((s) => s.fields).map((name, i) => [name, i]));

type Setting = Pick<FieldConfigRow, 'visibility' | 'sort_order'>;

const byOrder = (a: FieldConfigRow, b: FieldConfigRow): number =>
  a.sort_order - b.sort_order ||
  (POSITION.get(a.field_name) ?? 0) - (POSITION.get(b.field_name) ?? 0);

/**
 * «مدیریت → تنظیم فیلدها»: per branch × trade type, which transaction fields the form shows,
 * which are required, and their order within each section. Changes are staged here and saved
 * together (PATCH /field-configs/bulk/); the preview shows the branch manager's form with the
 * staged settings. Locked fields (serial, date, payment, currency, rate) stay required.
 */
export function FieldSettings(): JSX.Element {
  const { t } = useTranslation();
  const api = useApi();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { branches, name: branchName } = useBranches();
  const branch = Number(params.get('branch')) || null;
  const typeParam = params.get('type') as TradeType | null;
  const tradeType: TradeType = typeParam && TRADE_TYPES.includes(typeParam) ? typeParam : 'IMPORT';
  const historyId = Number(useMatch(`${BASE}/:id/history`)?.params.id) || null;

  // Start on the first branch.
  useEffect(() => {
    const first = branches[0];
    if (!branch && first) {
      setParams((p) => {
        p.set('branch', String(first.id));
        return p;
      });
    }
  }, [branch, branches, setParams]);

  const scope = { branch, trade_type: tradeType };
  const rows = useQuery({
    queryKey: [...KEY, scope],
    queryFn: () => api.get<FieldConfigRow[]>('/field-configs/', { params: scope }),
    enabled: branch !== null,
  });
  const usage = useQuery({
    queryKey: [...KEY, 'usage', scope],
    queryFn: () => api.get<Record<string, number>>('/field-configs/usage/', { params: scope }),
    enabled: branch !== null,
  });

  // Unsaved settings by row id; a row set back to its saved value is dropped.
  const [staged, setStaged] = useState<Record<number, Setting>>({});
  const saved = useMemo(() => new Map((rows.data ?? []).map((r) => [r.id, r])), [rows.data]);
  const current = useMemo(
    () => (rows.data ?? []).map((r) => ({ ...r, ...staged[r.id] })),
    [rows.data, staged],
  );
  const changes = current.filter((r) => {
    const s = saved.get(r.id);
    return s && (s.visibility !== r.visibility || s.sort_order !== r.sort_order);
  });
  const dirty = changes.length > 0;

  function stage(updates: { id: number; setting: Partial<Setting> }[]): void {
    setStaged((prev) => {
      const next = { ...prev };
      for (const { id, setting } of updates) {
        const s = saved.get(id);
        if (!s) continue;
        const merged = {
          visibility: s.visibility,
          sort_order: s.sort_order,
          ...prev[id],
          ...setting,
        };
        if (merged.visibility === s.visibility && merged.sort_order === s.sort_order)
          delete next[id];
        else next[id] = merged;
      }
      return next;
    });
  }

  /** Moves `name` to `to` (index within its section) and renumbers that section only. */
  function move(fields: FieldConfigRow[], from: number, to: number): void {
    if (from === to || to < 0 || to >= fields.length) return;
    const order = [...fields];
    const [moved] = order.splice(from, 1);
    if (!moved) return;
    order.splice(to, 0, moved);
    // Reuse the section's own sort_order values, made strictly increasing.
    const slots = fields.map((f) => f.sort_order).sort((a, b) => a - b);
    for (let i = 1; i < slots.length; i++) {
      if ((slots[i] ?? 0) <= (slots[i - 1] ?? 0)) slots[i] = (slots[i - 1] ?? 0) + 1;
    }
    stage(order.map((f, i) => ({ id: f.id, setting: { sort_order: slots[i] ?? f.sort_order } })));
  }

  // Leaving the page (not opening a row's history) with unsaved changes asks first.
  const blocker = useBlocker(
    ({ nextLocation }) => dirty && !nextLocation.pathname.startsWith(BASE),
  );
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    void confirm({
      title: t('field_settings.leave_title'),
      message: t('field_settings.leave_message', { count: changes.length }),
      variant: 'warning',
      confirmLabel: t('field_settings.leave_confirm'),
    }).then((ok) => (ok ? blocker.proceed() : blocker.reset()));
  }, [blocker, changes.length, confirm, t]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent): void => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function setScope(key: 'branch' | 'type', value: string): Promise<void> {
    if (dirty) {
      const ok = await confirm({
        title: t('field_settings.leave_title'),
        message: t('field_settings.leave_message', { count: changes.length }),
        variant: 'warning',
        confirmLabel: t('field_settings.leave_confirm'),
      });
      if (!ok) return;
    }
    setStaged({});
    setParams((p) => {
      p.set(key, value);
      return p;
    });
  }

  async function refresh(): Promise<void> {
    await qc.invalidateQueries({ queryKey: [...KEY] });
    await qc.invalidateQueries({ queryKey: ['form-config'] }); // the real transaction forms
  }

  const save = useMutation({
    mutationFn: () =>
      api.patch<{ changed: number; rows: FieldConfigRow[] }>(
        '/field-configs/bulk/',
        changes.map((r) => ({ id: r.id, visibility: r.visibility, sort_order: r.sort_order })),
        { skipErrorToast: true },
      ),
    onError: toastError,
    onSuccess: async (data) => {
      const fresh = new Map(data.rows.map((r) => [r.id, r]));
      qc.setQueryData<FieldConfigRow[]>([...KEY, scope], (old) =>
        old?.map((r) => fresh.get(r.id) ?? r),
      );
      setStaged({});
      toast.success(t('field_settings.saved', { count: data.changed }), { id: 'fs-saved' });
      await refresh();
    },
  });

  const [copyOpen, setCopyOpen] = useState(false);
  const copyAll = useMutation({
    mutationFn: () =>
      api.post<{ changed: number; branches: number }>(
        '/field-configs/copy/',
        { source_branch: branch, source_trade_type: tradeType, all_branches: true },
        { skipErrorToast: true },
      ),
    onError: toastError,
    onSuccess: async (data) => {
      toast.success(t('field_settings.copied_all', { count: data.branches }), { id: 'fs-copy' });
      await refresh();
    },
  });
  const reset = useMutation({
    mutationFn: () =>
      api.post<{ changed: number }>('/field-configs/reset/', scope, { skipErrorToast: true }),
    onError: toastError,
    onSuccess: async (data) => {
      toast.success(t('field_settings.reset_done', { count: data.changed }), { id: 'fs-reset' });
      await refresh();
    },
  });

  const typeLabel = t(`trade_types.${tradeType}`);
  const scopeLabel = branch ? `${branchName(branch)} — ${typeLabel}` : typeLabel;

  async function onCopyAll(): Promise<void> {
    const ok = await confirm({
      title: t('field_settings.copy_all_title'),
      message: t('field_settings.copy_all_message', {
        scope: scopeLabel,
        type: typeLabel,
        count: branches.length - 1,
      }),
      variant: 'warning',
      confirmLabel: t('field_settings.copy_all'),
    });
    if (ok) copyAll.mutate();
  }

  async function onReset(): Promise<void> {
    const ok = await confirm({
      title: t('field_settings.reset_title'),
      message: t('field_settings.reset_message', { scope: scopeLabel }),
      variant: 'danger',
      confirmLabel: t('field_settings.reset'),
    });
    if (ok) reset.mutate();
  }

  const sections = SECTIONS.map((s) => ({
    key: s.key,
    fields: current.filter((r) => s.fields.includes(r.field_name)).sort(byOrder),
  })).filter((s) => s.fields.length > 0);

  const previewConfig: FormConfig | null =
    branch && rows.data
      ? {
          branch,
          trade_type: tradeType,
          trade_type_label: typeLabel,
          form_fields: current
            .filter((r) => r.visibility !== 'HIDDEN')
            .map((r) => ({
              field_name: r.field_name,
              label_fa: r.field_label_fa,
              visibility: r.visibility as 'REQUIRED' | 'OPTIONAL',
              required: r.visibility === 'REQUIRED',
              sort_order: r.sort_order,
            })),
        }
      : null;

  const busy = copyAll.isPending || reset.isPending;
  const historyRow = current.find((r) => r.id === historyId);

  return (
    <>
      <PageHeader
        title={t('field_settings.title')}
        description={t('field_settings.description')}
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={dirty || !branch || busy}
              title={dirty ? t('field_settings.save_first') : undefined}
              onClick={() => setCopyOpen(true)}
              data-testid="fs-copy-from"
            >
              <Copy className="h-4 w-4" />
              {t('field_settings.copy_from')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={dirty || !branch || busy || branches.length < 2}
              title={dirty ? t('field_settings.save_first') : undefined}
              loading={copyAll.isPending}
              onClick={() => void onCopyAll()}
              data-testid="fs-copy-all"
            >
              <CopyPlus className="h-4 w-4" />
              {t('field_settings.copy_all')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={dirty || !branch || busy}
              title={dirty ? t('field_settings.save_first') : undefined}
              loading={reset.isPending}
              onClick={() => void onReset()}
              data-testid="fs-reset"
            >
              <RotateCcw className="h-4 w-4" />
              {t('field_settings.reset')}
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div className="w-full max-w-xs">
          <Select
            value={branch ?? ''}
            onChange={(e) => void setScope('branch', e.target.value)}
            aria-label={t('transactions.branch')}
            options={branches.map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))}
            data-testid="fs-branch"
          />
        </div>
        <div
          role="tablist"
          aria-label={t('field_settings.trade_types')}
          className="flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800"
        >
          {TRADE_TYPES.map((tt) => (
            <button
              key={tt}
              type="button"
              role="tab"
              aria-selected={tt === tradeType}
              onClick={() => tt !== tradeType && void setScope('type', tt)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                tt === tradeType
                  ? 'bg-white text-brand shadow-sm dark:bg-gray-700 dark:text-emerald-200'
                  : 'text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white',
              )}
              data-testid={`fs-tab-${tt}`}
            >
              {t(`trade_types.${tt}`)}
            </button>
          ))}
        </div>
      </div>

      {!rows.data ? (
        <div className="flex justify-center p-10">
          <Spinner className="h-6 w-6" label={t('common.loading')} />
        </div>
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          <div className="space-y-4" role="tabpanel" data-testid="fs-table">
            {sections.map((section) => (
              <SectionCard
                key={section.key}
                sectionKey={section.key}
                fields={section.fields}
                saved={saved}
                usage={usage.data}
                onVisibility={(id, visibility) => stage([{ id, setting: { visibility } }])}
                onMove={(from, to) => move(section.fields, from, to)}
                onHistory={(id) => void navigate(`${BASE}/${id}/history?${params.toString()}`)}
              />
            ))}
          </div>
          <aside
            className="xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto"
            aria-labelledby="fs-preview-title"
            data-testid="fs-preview"
          >
            <div className="mb-3 rounded-xl border border-dashed border-brand/40 bg-brand-light/40 p-3 dark:border-emerald-700 dark:bg-brand/10">
              <h2 id="fs-preview-title" className="font-semibold text-brand dark:text-emerald-300">
                {t('field_settings.preview')}
              </h2>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {t('field_settings.preview_hint', { scope: scopeLabel })}
              </p>
            </div>
            {previewConfig && <FormPreview key={`${branch}-${tradeType}`} config={previewConfig} />}
          </aside>
        </div>
      )}

      {dirty && (
        <div
          className="sticky bottom-0 z-20 -mx-4 mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur dark:border-gray-700 dark:bg-gray-900/95"
          role="status"
          data-testid="fs-unsaved-bar"
        >
          <span className="font-medium text-accent-dark dark:text-orange-300">
            {t('field_settings.unsaved', { count: changes.length })}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStaged({})} data-testid="fs-cancel">
              {t('common.cancel')}
            </Button>
            <Button onClick={() => save.mutate()} loading={save.isPending} data-testid="fs-save">
              <Save className="h-4 w-4" />
              {t('common.save')}
            </Button>
          </div>
        </div>
      )}

      {copyOpen && branch && (
        <CopyDialog
          target={{ branch, tradeType }}
          targetLabel={scopeLabel}
          onClose={() => setCopyOpen(false)}
          onDone={refresh}
        />
      )}
      {historyId && (
        <HistoryModal
          endpoint="/field-configs/"
          id={historyId}
          ns="field_settings"
          title={historyRow ? t(`form.${historyRow.field_name}`) : undefined}
          onClose={() => void navigate(`${BASE}?${params.toString()}`)}
        />
      )}
    </>
  );
}

interface SectionCardProps {
  sectionKey: string;
  fields: FieldConfigRow[];
  saved: Map<number, FieldConfigRow>;
  usage?: Record<string, number>;
  onVisibility(id: number, visibility: FieldVisibility): void;
  onMove(from: number, to: number): void;
  onHistory(id: number): void;
}

function SectionCard({
  sectionKey,
  fields,
  saved,
  usage,
  onVisibility,
  onMove,
  onHistory,
}: SectionCardProps): JSX.Element {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  return (
    <Card className="p-4" data-testid={`fs-section-${sectionKey}`}>
      <h2 className="mb-3 font-semibold text-brand dark:text-emerald-300">
        {t(`sections.${sectionKey}`)}
      </h2>
      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
        {fields.map((f, i) => {
          const label = t(`form.${f.field_name}`);
          const before = saved.get(f.id);
          const changed =
            before && (before.visibility !== f.visibility || before.sort_order !== f.sort_order);
          const count = usage?.[f.field_name] ?? 0;
          return (
            <li
              key={f.id}
              draggable
              onDragStart={(e) => {
                setDragging(i);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', f.field_name);
              }}
              onDragOver={(e) => {
                if (dragging === null) return; // only rows of this section
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
                'py-2',
                dragging === i && 'opacity-50',
                over === i && dragging !== i && 'bg-brand-light/60 dark:bg-brand/20',
              )}
              data-testid={`fs-row-${f.field_name}`}
              data-visibility={f.visibility}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <GripVertical
                  className="h-4 w-4 shrink-0 cursor-grab text-gray-400"
                  aria-hidden
                  data-testid={`fs-grip-${f.field_name}`}
                />
                <div className="min-w-[10rem] flex-1">
                  <div className="flex items-center gap-1.5 font-medium">
                    {label}
                    {changed && (
                      <span
                        className="h-2 w-2 rounded-full bg-accent"
                        title={t('field_settings.changed')}
                        aria-label={t('field_settings.changed')}
                        role="img"
                      />
                    )}
                    {f.locked && (
                      <span
                        className="text-gray-500 dark:text-gray-400"
                        title={t('field_settings.locked')}
                        data-testid={`fs-lock-${f.field_name}`}
                      >
                        <Lock className="h-3.5 w-3.5" aria-hidden />
                        <span className="sr-only">{t('field_settings.locked')}</span>
                      </span>
                    )}
                  </div>
                  <code className="font-mono text-xs text-gray-500 dark:text-gray-400" dir="ltr">
                    {f.field_name}
                  </code>
                </div>
                <div
                  role="radiogroup"
                  aria-label={t('field_settings.visibility_of', { field: label })}
                  title={f.locked ? t('field_settings.locked') : undefined}
                  className={cn(
                    'inline-flex rounded-lg border border-gray-300 p-0.5 dark:border-gray-600',
                    f.locked && 'opacity-60',
                  )}
                >
                  {VISIBILITIES.map((v) => (
                    <label
                      key={v}
                      className={cn(
                        'cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium focus-within:ring-2 focus-within:ring-brand',
                        f.locked && 'cursor-not-allowed',
                        f.visibility === v
                          ? v === 'HIDDEN'
                            ? 'bg-gray-700 text-white dark:bg-gray-200 dark:text-gray-900'
                            : v === 'REQUIRED'
                              ? 'bg-brand text-white'
                              : 'bg-brand-light text-brand dark:bg-brand/40 dark:text-emerald-100'
                          : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700',
                      )}
                      data-testid={`fs-vis-${f.field_name}-${v}`}
                    >
                      <input
                        type="radio"
                        className="sr-only"
                        name={`vis-${f.id}`}
                        value={v}
                        checked={f.visibility === v}
                        disabled={f.locked}
                        onChange={() => onVisibility(f.id, v)}
                      />
                      {t(`field_settings.visibility.${v}`)}
                    </label>
                  ))}
                </div>
                <div className="flex items-center">
                  <IconButton
                    label={t('field_settings.move_up', { field: label })}
                    disabled={i === 0}
                    onClick={() => onMove(i, i - 1)}
                    data-testid={`fs-up-${f.field_name}`}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    label={t('field_settings.move_down', { field: label })}
                    disabled={i === fields.length - 1}
                    onClick={() => onMove(i, i + 1)}
                    data-testid={`fs-down-${f.field_name}`}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    label={t('field_settings.history_of', { field: label })}
                    onClick={() => onHistory(f.id)}
                    data-testid={`fs-history-${f.field_name}`}
                  >
                    <History className="h-4 w-4" />
                  </IconButton>
                </div>
              </div>
              {f.visibility === 'HIDDEN' && count > 0 && (
                <p
                  className="mt-1.5 flex gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-900/30 dark:text-amber-100"
                  data-testid={`fs-warning-${f.field_name}`}
                >
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  {t('field_settings.hidden_warning', { count })}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

interface CopyDialogProps {
  target: { branch: number; tradeType: TradeType };
  targetLabel: string;
  onClose(): void;
  onDone(): Promise<void>;
}

/** «کپی از بندر/نوع دیگر»: overwrite this branch × type with another one's settings. */
function CopyDialog({ target, targetLabel, onClose, onDone }: CopyDialogProps): JSX.Element {
  const { t } = useTranslation();
  const api = useApi();
  const { branches } = useBranches();
  const [sourceBranch, setSourceBranch] = useState(
    () => branches.find((b) => b.id !== target.branch)?.id ?? target.branch,
  );
  const [sourceType, setSourceType] = useState<TradeType>(target.tradeType);
  const same = sourceBranch === target.branch && sourceType === target.tradeType;

  const copy = useMutation({
    mutationFn: () =>
      api.post<{ changed: number }>(
        '/field-configs/copy/',
        {
          source_branch: sourceBranch,
          source_trade_type: sourceType,
          target_branch: target.branch,
          target_trade_type: target.tradeType,
        },
        { skipErrorToast: true },
      ),
    onError: toastError,
    onSuccess: async (data) => {
      toast.success(t('field_settings.copied', { count: data.changed }), { id: 'fs-copy' });
      await onDone();
      onClose();
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={t('field_settings.copy_from_title', { scope: targetLabel })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => copy.mutate()}
            disabled={same}
            loading={copy.isPending}
            data-testid="fs-copy-submit"
          >
            <Copy className="h-4 w-4" />
            {t('field_settings.copy_submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="fs-copy-dialog">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('field_settings.copy_from_hint', { scope: targetLabel })}
        </p>
        <label className="block text-sm font-medium">
          {t('field_settings.source_branch')}
          <Select
            className="mt-1"
            value={sourceBranch}
            onChange={(e) => setSourceBranch(Number(e.target.value))}
            options={branches.map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))}
            data-testid="fs-copy-branch"
          />
        </label>
        <label className="block text-sm font-medium">
          {t('field_settings.source_type')}
          <Select
            className="mt-1"
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value as TradeType)}
            options={TRADE_TYPES.map((tt) => ({ value: tt, label: t(`trade_types.${tt}`) }))}
            data-testid="fs-copy-type"
          />
        </label>
        {same && (
          <p className="text-sm text-red-700 dark:text-red-400" role="alert">
            {t('field_settings.same_source')}
          </p>
        )}
      </div>
    </Modal>
  );
}
