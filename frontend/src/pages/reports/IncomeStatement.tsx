import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, FileSpreadsheet, Printer } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DateInput } from '@/components/ui/DateInput';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/cn';
import { splitDualDate, toGregorian, toShamsiKey } from '@/lib/date';
import { isolateLtr, useDigitLocale } from '@/lib/digits';
import { useBranches } from '@/lib/finance';
import { toastError } from '@/lib/hooks';
import {
  PRESETS,
  REPORT_KEY,
  downloadFile,
  drillDownUrl,
  periodText,
  presetRange,
  signedMoney,
  type Preset,
} from '@/lib/reports';
import { useAuth } from '@/stores/auth';
import type { IncomeStatement as Report, StatementSection } from '@/types/api';

const SECTIONS: StatementSection[] = ['REVENUE', 'COGS', 'OPEX', 'OTHER'];
const SECTION_TOTAL = { REVENUE: 'revenue', COGS: 'cogs', OPEX: 'opex', OTHER: 'other' } as const;

/**
 * /reports/income-statement — IAS 1 (by function of expense) for a period, both roles (a
 * branch manager always gets their own branch). Every line drills down to the records it
 * adds up; warnings are always shown; prints on A4 and downloads as Excel.
 */
export function IncomeStatementPage(): JSX.Element {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const d = useDigitLocale();
  const user = useAuth((s) => s.user);
  const isSuperAdmin = user?.role === 'super_admin';
  const { branches } = useBranches();
  const [params, setParams] = useSearchParams();
  const [downloading, setDownloading] = useState(false);

  const preset = (PRESETS as readonly string[]).includes(params.get('preset') ?? '')
    ? (params.get('preset') as Preset)
    : 'this_month';
  const custom = preset === 'custom';
  const fallback = presetRange('this_month');
  const range = custom
    ? {
        from: toShamsiKey(params.get('date_from') ?? '') ?? fallback.from,
        to: toShamsiKey(params.get('date_to') ?? '') ?? fallback.to,
      }
    : presetRange(preset);
  const branch = isSuperAdmin ? Number(params.get('branch')) || null : (user?.branch_id ?? null);
  const query = {
    date_from: range.from,
    date_to: range.to,
    branch: isSuperAdmin ? (branch ?? undefined) : undefined,
  };

  const report = useQuery({
    queryKey: [...REPORT_KEY, query],
    queryFn: () => api.get<Report>('/income-statement/', { params: query }),
    placeholderData: (prev) => prev,
  });

  const set = (changes: Record<string, string | null>): void =>
    setParams(
      (p) => {
        for (const [k, v] of Object.entries(changes)) {
          if (v === null || v === '') p.delete(k);
          else p.set(k, v);
        }
        return p;
      },
      { replace: true },
    );

  async function exportExcel(): Promise<void> {
    setDownloading(true);
    try {
      await downloadFile(
        api,
        '/income-statement/export/',
        query,
        `income-statement_${range.from}_${range.to}.xlsx`,
      );
    } catch (err) {
      toastError(err);
    } finally {
      setDownloading(false);
    }
  }

  const r = report.data;
  const money = (value: string | null | undefined, currency: 'AFN' | 'USD'): JSX.Element => {
    const { text, negative } = signedMoney(value, currency, i18n.language);
    return (
      <span
        className={cn('tabular-nums', negative && 'text-red-700 dark:text-red-400')}
        dir={currency === 'USD' ? 'ltr' : undefined}
      >
        {text}
      </span>
    );
  };
  const label = (line: Report['lines'][number]): string =>
    i18n.language === 'en' ? line.label_en || line.label_fa : line.label_fa;
  const branchName =
    r?.branch?.name ?? (isSuperAdmin ? t('reports.all_branches') : user?.branch_name);
  const generated = r ? splitDualDate(r.generated_at) : null;

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={t('reports.title')}
          description={t('reports.description')}
          action={
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => window.print()} data-testid="print-button">
                <Printer className="h-4 w-4" />
                {t('reports.print')}
              </Button>
              <Button
                onClick={() => void exportExcel()}
                loading={downloading}
                data-testid="excel-button"
              >
                <FileSpreadsheet className="h-4 w-4" />
                {t('reports.excel')}
              </Button>
            </div>
          }
        />
        <section
          aria-label={t('reports.period')}
          className="mb-4 space-y-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
        >
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('reports.period')}>
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={preset === p}
                onClick={() =>
                  set(
                    p === 'custom'
                      ? { preset: p, date_from: range.from, date_to: range.to }
                      : { preset: p === 'this_month' ? null : p, date_from: null, date_to: null },
                  )
                }
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                  preset === p
                    ? 'border-brand bg-brand text-white'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700',
                )}
                data-testid={`preset-${p}`}
              >
                {t(`reports.presets.${p}`)}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {custom && (
              <>
                <DateInput
                  value={params.get('date_from') ?? range.from}
                  onChange={(e) => set({ date_from: e.target.value })}
                  aria-label={t('reports.date_from')}
                  showGregorian={false}
                  data-testid="report-date-from"
                />
                <DateInput
                  value={params.get('date_to') ?? range.to}
                  onChange={(e) => set({ date_to: e.target.value })}
                  aria-label={t('reports.date_to')}
                  showGregorian={false}
                  data-testid="report-date-to"
                />
              </>
            )}
            {isSuperAdmin && (
              <Select
                value={params.get('branch') ?? ''}
                onChange={(e) => set({ branch: e.target.value })}
                aria-label={t('reports.branch')}
                placeholder={t('reports.all_branches')}
                options={branches.map((b) => ({ value: b.id, label: b.name }))}
                data-testid="report-branch"
              />
            )}
          </div>
        </section>
      </div>

      {/* Print header: only on paper. */}
      <header className="mb-4 hidden print:block" data-testid="print-header">
        <h1 className="text-xl font-bold">{t('reports.title')}</h1>
        <p className="text-sm">
          {t('reports.branch')}: {branchName} — {t('reports.period')}:{' '}
          {periodText(range.from, range.to)} (
          {periodText(toGregorian(range.from), toGregorian(range.to), true)})
        </p>
        {generated && (
          <p className="text-xs">
            {t('reports.generated_at')}: {isolateLtr(generated.shamsi)} (
            {isolateLtr(generated.gregorian)})
          </p>
        )}
      </header>

      {r && r.warnings.length > 0 && (
        <div
          role="alert"
          className="mb-4 flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100"
          data-testid="report-warnings"
        >
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
          <div>
            <p className="mb-1 font-semibold">{t('reports.warnings_title')}</p>
            <ul className="list-disc space-y-1 ps-5">
              {r.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <Card className="overflow-hidden" data-testid="statement">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 text-sm dark:border-gray-700 print:hidden">
          <span>
            <strong>{branchName}</strong> — {periodText(range.from, range.to)}{' '}
            <span className="text-gray-600 dark:text-gray-400" dir="ltr">
              ({toGregorian(range.from)} – {toGregorian(range.to)})
            </span>
          </span>
          {r && (
            <span className="text-gray-600 dark:text-gray-400" data-testid="report-count">
              {t('reports.transactions_count', { n: d(r.transactions_count) })}
            </span>
          )}
        </div>
        {!r ? (
          <div className="p-10 text-center">
            <Spinner className="mx-auto h-6 w-6" />
          </div>
        ) : (
          <table className="w-full text-sm" aria-busy={report.isFetching}>
            <caption className="sr-only">{t('reports.title')}</caption>
            <thead className="bg-gray-50 text-gray-700 dark:bg-gray-900/50 dark:text-gray-300">
              <tr>
                <th scope="col" className="px-4 py-2 text-start">
                  {t('reports.line')}
                </th>
                <th scope="col" className="px-4 py-2 text-end">
                  {t('reports.afn')}
                </th>
                <th scope="col" className="px-4 py-2 text-end">
                  {t('reports.usd')}
                </th>
              </tr>
            </thead>
            <tbody>
              {SECTIONS.map((section) => {
                const lines = r.lines.filter((l) => l.section === section);
                const key = SECTION_TOTAL[section];
                return [
                  <tr key={`${section}-h`} className="bg-brand-light/60 dark:bg-brand/20">
                    <th
                      scope="rowgroup"
                      colSpan={3}
                      className="px-4 py-2 text-start font-semibold text-brand dark:text-emerald-200"
                    >
                      {t(`statement_lines.sections.${section}`)}
                    </th>
                  </tr>,
                  ...lines.map((line) => (
                    <tr
                      key={line.code}
                      className="border-t border-gray-100 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/40"
                      data-testid="statement-line"
                      data-code={line.code}
                    >
                      <td className="px-4 py-2 ps-8">
                        <Link
                          to={drillDownUrl(line.source_field, range, r.branch?.id ?? null)}
                          className="hover:text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:hover:text-emerald-300"
                          data-testid="drill-down"
                        >
                          {label(line)}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-end">{money(line.amount_afn, 'AFN')}</td>
                      <td className="px-4 py-2 text-end">{money(line.amount_usd, 'USD')}</td>
                    </tr>
                  )),
                  <TotalRow
                    key={`${section}-t`}
                    label={t('reports.section_total', {
                      section: t(`statement_lines.sections.${section}`),
                    })}
                    afn={money(r.totals[`${key}_afn`], 'AFN')}
                    usd={money(r.totals[`${key}_usd`], 'USD')}
                    testId={`total-${key}`}
                  />,
                  section === 'COGS' && (
                    <TotalRow
                      key="gross"
                      label={t('reports.gross_profit')}
                      afn={money(r.totals.gross_profit_afn, 'AFN')}
                      usd={money(r.totals.gross_profit_usd, 'USD')}
                      testId="total-gross"
                      strong
                    />
                  ),
                ];
              })}
              <TotalRow
                label={t('reports.net_profit')}
                afn={money(r.totals.net_profit_afn, 'AFN')}
                usd={money(r.totals.net_profit_usd, 'USD')}
                testId="total-net"
                strong
                final
              />
            </tbody>
          </table>
        )}
      </Card>
      <p className="mt-3 text-xs text-gray-600 dark:text-gray-400 print:hidden">
        {t('reports.drill_hint')}
      </p>
    </>
  );
}

function TotalRow({
  label,
  afn,
  usd,
  testId,
  strong,
  final,
}: {
  label: string;
  afn: JSX.Element;
  usd: JSX.Element;
  testId: string;
  strong?: boolean;
  final?: boolean;
}): JSX.Element {
  return (
    <tr
      className={cn(
        'border-t border-gray-200 font-semibold dark:border-gray-700',
        strong && 'bg-gray-50 dark:bg-gray-900/40',
        final && 'border-t-2 border-brand bg-orange-50 text-base dark:bg-orange-900/20',
      )}
      data-testid={testId}
    >
      <th scope="row" className="px-4 py-2 text-start">
        {label}
      </th>
      <td className="px-4 py-2 text-end" data-testid={`${testId}-afn`}>
        {afn}
      </td>
      <td className="px-4 py-2 text-end" data-testid={`${testId}-usd`}>
        {usd}
      </td>
    </tr>
  );
}
