import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { toGregorian } from '@/lib/date';
import { isRtlLang, toDariDigits } from '@/lib/digits';
import { formatMoney } from '@/lib/money';
import type { DashboardSummary } from '@/types/api';

type Day = DashboardSummary['daily'][number];

/**
 * Daily net profit (AFN) of the current month: one series, so no legend (the card title
 * names it). Profit and loss are told apart by direction from the zero line and by colour
 * (--chart-profit / --chart-loss, validated for light and dark). RTL: day 1 on the right,
 * the value axis on the right; Dari digits on fa/ps labels. A table copy is kept for
 * screen readers.
 */
export function NetProfitChart({ days }: { days: Day[] }): JSX.Element {
  const { t, i18n } = useTranslation();
  const rtl = isRtlLang(i18n.language);
  const digits = (s: string | number): string => (rtl ? toDariDigits(s) : String(s));
  const compact = new Intl.NumberFormat(rtl ? 'fa' : 'en', { notation: 'compact' });
  const data = days.map((day) => ({
    day: Number(day.date.slice(8)),
    date: day.date,
    value: day.net_profit_afn === null ? null : Number(day.net_profit_afn),
    raw: day.net_profit_afn,
    count: day.transactions_count,
  }));

  return (
    <figure data-testid="net-profit-chart">
      <div className="h-64" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
            barCategoryGap={2}
          >
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeWidth={1} />
            <XAxis
              dataKey="day"
              reversed={rtl}
              tickLine={false}
              axisLine={{ stroke: 'var(--chart-grid)' }}
              tick={{ fill: 'var(--chart-axis)', fontSize: 11 }}
              tickFormatter={(v: number) => digits(v)}
              interval="preserveStartEnd"
              minTickGap={8}
            />
            <YAxis
              orientation={rtl ? 'right' : 'left'}
              tickLine={false}
              axisLine={false}
              width={56}
              tick={{ fill: 'var(--chart-axis)', fontSize: 11 }}
              tickFormatter={(v: number) => compact.format(v)}
            />
            <ReferenceLine y={0} stroke="var(--chart-axis)" strokeWidth={1} />
            <Tooltip
              cursor={{ fill: 'var(--chart-grid)', opacity: 0.5 }}
              content={({ active, payload }) => {
                const p = active
                  ? (payload?.[0]?.payload as (typeof data)[number] | undefined)
                  : undefined;
                if (!p) return null;
                return (
                  <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-md dark:border-gray-700 dark:bg-gray-800">
                    <p className="font-semibold">
                      {digits(p.date)}{' '}
                      <span className="font-normal text-gray-600 dark:text-gray-400" dir="ltr">
                        ({toGregorian(p.date)})
                      </span>
                    </p>
                    <p className="tabular-nums">
                      {t('dashboard.net_profit')}: {formatMoney(p.raw, 'AFN', i18n.language)}
                    </p>
                    <p className="text-gray-600 dark:text-gray-400">
                      {t('dashboard.transactions')}: {digits(p.count)}
                    </p>
                  </div>
                );
              }}
            />
            <Bar dataKey="value" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {data.map((d) => (
                <Cell
                  key={d.date}
                  fill={(d.value ?? 0) < 0 ? 'var(--chart-loss)' : 'var(--chart-profit)'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">
        <table>
          <caption>{t('dashboard.chart_title')}</caption>
          <tbody>
            {data.map((d) => (
              <tr key={d.date}>
                <th scope="row">{d.date}</th>
                <td>{formatMoney(d.raw, 'AFN', i18n.language)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}
