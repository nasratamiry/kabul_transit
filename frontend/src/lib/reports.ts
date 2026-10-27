import type { ApiMethods } from './api';
import { isolateLtr, toDariDigits } from './digits';
import { currentShamsiMonth, shamsiMonth, shiftShamsi, todayShamsi } from './date';
import { formatMoney } from './money';

export const REPORT_KEY = ['income-statement'] as const;
export const DASHBOARD_KEY = ['dashboard-summary'] as const;

export const PRESETS = ['this_month', 'last_month', 'this_quarter', 'this_year', 'custom'] as const;
export type Preset = (typeof PRESETS)[number];

/** First and last day (Shamsi keys) of Shamsi months `first`..`last` (0-based) of `year`. */
function months(year: number, first: number, last: number): { from: string; to: string } {
  const a = shamsiMonth(year, first);
  const b = shamsiMonth(year, last);
  return { from: a.days[0] ?? '', to: b.days[b.days.length - 1] ?? '' };
}

/** A preset period in Kabul's calendar: Shamsi months, quarters of three months, the Shamsi year. */
export function presetRange(preset: Exclude<Preset, 'custom'>): { from: string; to: string } {
  const [year = 1405, month = 1] = todayShamsi().split('-').map(Number);
  if (preset === 'this_month') return currentShamsiMonth();
  if (preset === 'last_month') {
    const [y = year, m = month] = shiftShamsi(currentShamsiMonth().from, -1, 'month')
      .split('-')
      .map(Number);
    return months(y, m - 1, m - 1);
  }
  if (preset === 'this_quarter') {
    const q = Math.floor((month - 1) / 3) * 3;
    return months(year, q, q + 2);
  }
  return months(year, 0, 11);
}

/**
 * Where a statement line's amount comes from, as a list filtered to the same period and
 * branch: transactions where that field is non-zero, or the office-expense / hawala page.
 */
export function drillDownUrl(
  source: string,
  period: { from: string; to: string },
  branch: number | null,
): string {
  const q = new URLSearchParams({ date_from: period.from, date_to: period.to });
  if (branch) q.set('branch', String(branch));
  if (source === '@hawala_fee') return `/finance/hawala?${q}`;
  if (source === '@office_salary' || source === '@office_expense') {
    q.set('kind', source === '@office_salary' ? 'salary' : 'non_salary');
    return `/finance/office-expenses?${q}`;
  }
  q.set('nonzero', source);
  return `/transactions?${q}`;
}

/** «from – to» in Shamsi with each date isolated, so RTL text does not reverse '1405-08-01'. */
export function periodText(from: string, to: string, gregorian = false): string {
  const show = (key: string): string => isolateLtr(gregorian ? key : toDariDigits(key));
  return `${show(from)} – ${show(to)}`;
}

/** Accounting style: a negative amount is shown in parentheses (and coloured by the caller). */
export function signedMoney(
  value: string | null | undefined,
  currency: 'AFN' | 'USD',
  lang: string,
): { text: string; negative: boolean } {
  if (value === null || value === undefined) return { text: '—', negative: false };
  const negative = value.trim().startsWith('-');
  const text = formatMoney(negative ? value.trim().slice(1) : value, currency, lang);
  return { text: negative ? `(${text})` : text, negative };
}

/** Percentage change from `previous` to `current`; null when there is nothing to compare. */
export function change(current: string | null, previous: string | null): number | null {
  if (current === null || previous === null) return null;
  const a = Number(current);
  const b = Number(previous);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return ((a - b) / Math.abs(b)) * 100;
}

/** GET an .xlsx (or any file) with the user's token and hand it to the browser as a download. */
export async function downloadFile(
  api: ApiMethods,
  url: string,
  params: Record<string, string | number | undefined>,
  filename: string,
): Promise<void> {
  const blob = await api.get<Blob>(url, { params, responseType: 'blob', skipErrorToast: true });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}
