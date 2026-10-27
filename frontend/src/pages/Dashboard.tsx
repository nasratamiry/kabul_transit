import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Building2, CalendarDays, Minus } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import { AdminOverview } from '@/components/admin/AdminOverview';
import { TodayRateBanner } from '@/components/admin/TodayRateBanner';
import { OfficeMonthTile } from '@/components/finance/OfficeMonthTile';
import { TodayRateDialog } from '@/components/finance/TodayRateDialog';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column, type SortState } from '@/components/ui/DataTable';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dualDate, kabulToday, toGregorian } from '@/lib/date';
import { isRtlLang, toDariDigits, useDigitLocale } from '@/lib/digits';
import { useBranches } from '@/lib/finance';
import { formatMoney, type Currency } from '@/lib/money';
import { DASHBOARD_KEY, change, periodText, signedMoney } from '@/lib/reports';
import { useAuth } from '@/stores/auth';
import type { DashboardSummary, Me, PeriodSummary } from '@/types/api';

// recharts is large: its own chunk, fetched when the dashboard first draws the chart.
const NetProfitChart = lazy(() =>
  import('@/components/dashboard/NetProfitChart').then((m) => ({ default: m.NetProfitChart })),
);

type BranchRow = NonNullable<DashboardSummary['branches']>[number];

/**
 * This month vs last month (all money from the income-statement service), daily net
 * profit, top traders, recent transactions, today's rate; for the super admin also the
 * branch comparison and the admin tiles.
 */
export function Dashboard(): JSX.Element {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const d = useDigitLocale();
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const today = dualDate(kabulToday());
  const [rateDialog, setRateDialog] = useState(false);
  const [params, setParams] = useSearchParams();
  const { branches } = useBranches();
  const isSuperAdmin = user?.role === 'super_admin';
  const branch = isSuperAdmin ? params.get('branch') || undefined : undefined;

  const me = useQuery({
    queryKey: ['auth', 'me', user?.id],
    queryFn: () => api.get<Me>('/auth/me/'),
    retry: false,
  });
  // Keep the header in step with the server (role or branch may have changed since login).
  useEffect(() => {
    if (me.data) setUser(me.data);
  }, [me.data, setUser]);

  const summary = useQuery({
    queryKey: [...DASHBOARD_KEY, branch ?? 'all'],
    queryFn: () => api.get<DashboardSummary>('/dashboard/summary/', { params: { branch } }),
    placeholderData: (prev) => prev,
  });

  if (!user) return <Spinner />;
  const s = summary.data;
  const empty =
    s && s.current.transactions_count === 0 && s.daily.every((x) => Number(x.net_profit_afn) === 0);

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className="h-1.5 bg-gradient-to-l from-brand via-brand to-accent" />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-bold" data-testid="greeting">
              {t('dashboard.greeting', { name: user.full_name })}
            </h1>
            <Badge tone={isSuperAdmin ? 'brand' : 'accent'} data-testid="role-badge">
              {t(`roles.${user.role}`)}
            </Badge>
          </div>
          <span className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <Building2 className="h-4 w-4" aria-hidden />
            <span data-testid="branch">
              {isSuperAdmin ? t('layout.all_branches') : (user.branch_name ?? '—')}
            </span>
          </span>
          <span className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <CalendarDays className="h-4 w-4" aria-hidden />
            <span data-testid="today-shamsi">{today.shamsi}</span>
            <span dir="ltr" data-testid="today-gregorian">
              ({today.gregorian})
            </span>
          </span>
          {isSuperAdmin && (
            <div className="ms-auto w-56">
              <Select
                value={params.get('branch') ?? ''}
                onChange={(e) =>
                  setParams(
                    (p) => {
                      if (e.target.value) p.set('branch', e.target.value);
                      else p.delete('branch');
                      return p;
                    },
                    { replace: true },
                  )
                }
                aria-label={t('reports.branch')}
                placeholder={t('reports.all_branches')}
                options={branches.map((b) => ({ value: b.id, label: b.name }))}
                data-testid="dashboard-branch"
              />
            </div>
          )}
        </div>
      </Card>

      {isSuperAdmin ? (
        <AdminOverview />
      ) : (
        // A branch manager may enter today's rate (only today's); it unblocks new records.
        <div className="space-y-4">
          <TodayRateBanner onAdd={() => setRateDialog(true)} />
          <TodayRateDialog open={rateDialog} onClose={() => setRateDialog(false)} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <OfficeMonthTile />
          </div>
        </div>
      )}

      <section aria-labelledby="kpi-title">
        <h2 id="kpi-title" className="mb-3 text-sm font-semibold text-gray-600 dark:text-gray-300">
          {t('dashboard.kpi_title')}
          {s && (
            <span className="font-normal">
              {' '}
              — {periodText(s.current.period.from, s.current.period.to)}
            </span>
          )}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="kpis">
          <Kpi
            label={t('dashboard.kpi_count')}
            testId="kpi-count"
            value={s ? d(s.current.transactions_count) : null}
            delta={
              s
                ? change(
                    String(s.current.transactions_count),
                    String(s.previous.transactions_count),
                  )
                : null
            }
            previous={s ? d(s.previous.transactions_count) : null}
          />
          <MoneyKpi label={t('dashboard.kpi_revenue')} testId="kpi-revenue" s={s} field="revenue" />
          <MoneyKpi
            label={t('dashboard.kpi_expenses')}
            testId="kpi-expenses"
            s={s}
            field="expenses"
            invert
          />
          <MoneyKpi label={t('dashboard.kpi_net')} testId="kpi-net" s={s} field="net_profit" />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-1 font-semibold">{t('dashboard.chart_title')}</h2>
          <p className="mb-4 text-xs text-gray-600 dark:text-gray-400">
            {t('dashboard.chart_hint')}
          </p>
          {!s ? (
            <div className="h-64 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-700/50" />
          ) : empty ? (
            <p
              className="flex h-64 items-center justify-center text-sm text-gray-600 dark:text-gray-400"
              data-testid="empty-month"
            >
              {t('dashboard.empty_month')}
            </p>
          ) : (
            <Suspense
              fallback={
                <div className="h-64 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-700/50" />
              }
            >
              <NetProfitChart days={s.daily} />
            </Suspense>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">{t('dashboard.top_traders')}</h2>
          {!s ? (
            <Skeleton rows={5} />
          ) : s.top_traders.length === 0 ? (
            <p className="text-sm text-gray-600 dark:text-gray-400">{t('dashboard.no_traders')}</p>
          ) : (
            <ol className="space-y-3" data-testid="top-traders">
              {s.top_traders.map((tr, i) => (
                <li key={tr.id} className="flex items-start justify-between gap-3 text-sm">
                  <span className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-light text-xs font-semibold text-brand dark:bg-brand/30 dark:text-emerald-200">
                      {d(i + 1)}
                    </span>
                    <span>
                      <span className="block font-medium">{tr.name}</span>
                      <span className="text-xs text-gray-600 dark:text-gray-400">
                        {t('dashboard.n_transactions', { n: d(tr.transactions_count) })}
                      </span>
                    </span>
                  </span>
                  <span className="flex flex-col items-end tabular-nums">
                    <span className="font-semibold">
                      {formatMoney(tr.customer_payment_afn, 'AFN', i18n.language)}
                    </span>
                    <span className="text-xs text-gray-600 dark:text-gray-400" dir="ltr">
                      {formatMoney(tr.customer_payment_usd, 'USD', i18n.language)}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">{t('dashboard.recent')}</h2>
          <Link
            to="/transactions"
            className="text-sm font-medium text-brand hover:underline dark:text-emerald-300"
          >
            {t('common.view_all')}
          </Link>
        </div>
        <RecentTable s={s} />
      </Card>

      {isSuperAdmin && s?.branches && <BranchComparison rows={s.branches} />}

      {s && s.warnings.length > 0 && (
        <ul
          className="list-disc space-y-1 rounded-lg bg-amber-50 p-3 ps-8 text-xs text-amber-900 dark:bg-amber-900/30 dark:text-amber-100"
          role="note"
        >
          {s.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Skeleton({ rows }: { rows: number }): JSX.Element {
  return (
    <div className="space-y-3" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-8 animate-pulse rounded bg-gray-100 dark:bg-gray-700/50" />
      ))}
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  delta,
  previous,
  invert,
  negative,
  testId,
}: {
  label: string;
  value: string | null;
  sub?: string;
  delta: number | null;
  previous: string | null;
  /** For expenses a rise is the bad direction. */
  invert?: boolean;
  negative?: boolean;
  testId: string;
}): JSX.Element {
  const { t, i18n } = useTranslation();
  const d = useDigitLocale();
  const good = delta !== null && delta !== 0 && delta > 0 !== Boolean(invert);
  const Icon = delta === null || delta === 0 ? Minus : delta > 0 ? ArrowUp : ArrowDown;
  const pct =
    delta === null
      ? '—'
      : `${d(Math.abs(delta).toFixed(1)).replace('.', isRtlLang(i18n.language) ? '٫' : '.')}${isRtlLang(i18n.language) ? '٪' : '%'}`;
  return (
    <Card className="p-4" data-testid={testId}>
      <p className="text-sm text-gray-600 dark:text-gray-400">{label}</p>
      {value === null ? (
        <div className="mt-2 h-7 w-32 animate-pulse rounded bg-gray-100 dark:bg-gray-700/50" />
      ) : (
        <p
          className={cn(
            'mt-1 text-2xl font-bold tabular-nums',
            negative && 'text-red-700 dark:text-red-400',
          )}
          data-testid={`${testId}-value`}
        >
          {value}
        </p>
      )}
      {sub && (
        <p
          className="text-xs text-gray-600 dark:text-gray-400"
          dir="ltr"
          data-testid={`${testId}-usd`}
        >
          {sub}
        </p>
      )}
      <p
        className="mt-2 flex flex-wrap items-center gap-1 text-xs"
        data-testid={`${testId}-change`}
      >
        <span
          className={cn(
            'inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-semibold',
            delta === null || delta === 0
              ? 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
              : good
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'
                : 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200',
          )}
        >
          <Icon className="h-3 w-3" aria-hidden />
          {pct}
        </span>
        <span className="text-gray-600 dark:text-gray-400">
          {t('dashboard.vs_last_month', { value: previous ?? '—' })}
        </span>
      </p>
    </Card>
  );
}

function MoneyKpi({
  label,
  s,
  field,
  invert,
  testId,
}: {
  label: string;
  s: DashboardSummary | undefined;
  field: 'revenue' | 'expenses' | 'net_profit';
  invert?: boolean;
  testId: string;
}): JSX.Element {
  const { i18n } = useTranslation();
  const key = (p: PeriodSummary, c: 'afn' | 'usd'): string | null => p[`${field}_${c}`];
  const current = s ? signedMoney(key(s.current, 'afn'), 'AFN', i18n.language) : null;
  return (
    <Kpi
      label={label}
      testId={testId}
      value={current?.text ?? null}
      negative={current?.negative}
      sub={s ? signedMoney(key(s.current, 'usd'), 'USD', i18n.language).text : undefined}
      delta={s ? change(key(s.current, 'afn'), key(s.previous, 'afn')) : null}
      previous={s ? signedMoney(key(s.previous, 'afn'), 'AFN', i18n.language).text : null}
      invert={invert}
    />
  );
}

function RecentTable({ s }: { s: DashboardSummary | undefined }): JSX.Element {
  const { t, i18n } = useTranslation();
  type Row = DashboardSummary['recent_transactions'][number];
  const columns: Column<Row>[] = [
    {
      key: 'serial',
      header: t('transactions.serial_number'),
      cell: (r) => (
        <Link
          to={`/transactions/${r.id}`}
          className="font-mono text-xs text-brand hover:underline dark:text-emerald-300"
          dir="ltr"
          data-testid="recent-link"
        >
          {r.serial_number}
        </Link>
      ),
    },
    {
      key: 'date',
      header: t('transactions.date'),
      cell: (r) => (
        <span className="flex flex-col leading-tight">
          <span>{toDariDigits(r.date)}</span>
          <span className="text-xs text-gray-600 dark:text-gray-400" dir="ltr">
            {toGregorian(r.date)}
          </span>
        </span>
      ),
    },
    {
      key: 'type',
      header: t('transactions.trade_type'),
      cell: (r) => t(`trade_types.${r.trade_type}`),
    },
    { key: 'branch', header: t('transactions.branch'), cell: (r) => r.branch },
    { key: 'trader', header: t('transactions.trader'), cell: (r) => r.trader ?? '—' },
    {
      key: 'payment',
      header: t('transactions.customer_payment'),
      align: 'end',
      cell: (r) => (
        <span className="tabular-nums">
          {formatMoney(r.customer_payment, r.currency as Currency, i18n.language)}
        </span>
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={s?.recent_transactions}
      rowKey={(r) => r.id}
      isLoading={!s}
      caption={t('dashboard.recent')}
      emptyMessage={t('dashboard.no_recent')}
    />
  );
}

function BranchComparison({ rows }: { rows: BranchRow[] }): JSX.Element {
  const { t, i18n } = useTranslation();
  const d = useDigitLocale();
  const [sort, setSort] = useState<SortState>({ key: 'net', dir: 'desc' });
  const value = (r: BranchRow, key: string): number =>
    key === 'count'
      ? r.transactions_count
      : Number(
          { revenue: r.revenue_afn, expenses: r.expenses_afn, net: r.net_profit_afn }[key] ?? 0,
        );
  const sorted = useMemo(() => {
    const out = [...rows].sort((a, b) =>
      sort.key === 'name'
        ? a.branch.name.localeCompare(b.branch.name, 'fa')
        : value(a, sort.key) - value(b, sort.key),
    );
    return sort.dir === 'asc' ? out : out.reverse();
  }, [rows, sort]);
  const money = (v: string | null): JSX.Element => {
    const m = signedMoney(v, 'AFN', i18n.language);
    return (
      <span className={cn('tabular-nums', m.negative && 'text-red-700 dark:text-red-400')}>
        {m.text}
      </span>
    );
  };
  const columns: Column<BranchRow>[] = [
    {
      key: 'name',
      header: t('transactions.branch'),
      sortable: true,
      cell: (r) => <span className="font-medium">{r.branch.name}</span>,
    },
    {
      key: 'count',
      header: t('dashboard.kpi_count'),
      sortable: true,
      align: 'end',
      cell: (r) => d(r.transactions_count),
    },
    {
      key: 'revenue',
      header: t('dashboard.kpi_revenue'),
      sortable: true,
      align: 'end',
      cell: (r) => money(r.revenue_afn),
    },
    {
      key: 'expenses',
      header: t('dashboard.kpi_expenses'),
      sortable: true,
      align: 'end',
      cell: (r) => money(r.expenses_afn),
    },
    {
      key: 'net',
      header: t('dashboard.kpi_net'),
      sortable: true,
      align: 'end',
      cell: (r) => money(r.net_profit_afn),
    },
  ];
  return (
    <Card className="p-5" data-testid="branch-comparison">
      <h2 className="mb-3 font-semibold">{t('dashboard.branch_comparison')}</h2>
      <DataTable
        columns={columns}
        rows={sorted}
        rowKey={(r) => r.branch.id}
        caption={t('dashboard.branch_comparison')}
        sort={sort}
        onSort={(key) =>
          setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))
        }
      />
    </Card>
  );
}
