import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Pencil, Printer, ShieldAlert, Trash2, Building2 } from 'lucide-react';
import { useEffect } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams } from 'react-router';

import { DocumentsPanel } from '@/components/transactions/DocumentsPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useConfirm } from '@/components/ui/confirm-context';
import { HistoryTimeline } from '@/components/ui/HistoryTimeline';
import { Spinner } from '@/components/ui/Spinner';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/cn';
import { toGregorian, todayShamsi } from '@/lib/date';
import { isRtlLang, isolateLtr, toDariDigits, useDigitLocale } from '@/lib/digits';
import { useList } from '@/lib/hooks';
import { formatMoney, formatRate, type Currency } from '@/lib/money';
import { EXPENSE_FIELDS, FIELD_TYPES, SECTIONS, TX_KEY } from '@/lib/transactionSections';
import type { Branch, FormConfig, HistoryEntry, Transaction } from '@/types/api';

import { TRADE_TONE } from './tradeTone';

/** Fields shown in the money table instead of the read-only sections. */
const MONEY_TABLE = new Set(['customer_payment', 'currency', 'exchange_rate', ...EXPENSE_FIELDS]);

/** Amount in AFN and USD, on the same rules as the row summary (USD: the record's date rate). */
function convert(amount: number, tx: Transaction): { afn: number; usd: number | null } {
  const rateToAfn = tx.currency === 'AFN' ? 1 : Number(tx.exchange_rate);
  const afn = amount * rateToAfn;
  if (tx.currency === 'USD') return { afn, usd: amount };
  const perDollar = tx.row_summary.fee_per_dollar_afn;
  return { afn, usd: perDollar ? afn / Number(perDollar) : null };
}

/** /transactions/:id — read-only view, documents, history, print. */
export function TransactionDetail(): JSX.Element {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const confirm = useConfirm();
  const d = useDigitLocale();
  const { id } = useParams();
  const lang = i18n.language;

  const tx = useQuery({
    queryKey: [...TX_KEY, 'item', id],
    queryFn: () => api.get<Transaction>(`/transactions/${id}/`, { skipErrorToast: true }),
    retry: false,
  });
  const config = useQuery({
    queryKey: ['form-config', tx.data?.branch, tx.data?.trade_type],
    queryFn: () =>
      api.get<FormConfig>('/form-config/', {
        params: { branch: tx.data?.branch, trade_type: tx.data?.trade_type },
      }),
    enabled: Boolean(tx.data),
    staleTime: 60_000,
  });
  const history = useQuery({
    queryKey: [...TX_KEY, 'history', id],
    queryFn: () => api.get<HistoryEntry[]>(`/transactions/${id}/history/`),
    enabled: Boolean(tx.data),
  });
  const branches = useList<Branch>(['branches'], '/branches/');

  // /transactions/:id#documents (from the list's document count): scroll once the sections
  // above the panel are rendered — they wait for the form config, and would push it away.
  const layoutReady = Boolean(tx.data && config.data);
  useEffect(() => {
    if (layoutReady && hash === '#documents') {
      document.getElementById('documents')?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [layoutReady, hash]);

  if (tx.isError) {
    return (
      <div className="mx-auto max-w-md py-16 text-center" data-testid="tx-not-available">
        <ShieldAlert className="mx-auto mb-4 h-12 w-12 text-accent" />
        <h1 className="mb-2 text-xl font-semibold">{t('errors.forbidden_title')}</h1>
        <p className="mb-6 text-gray-600 dark:text-gray-400">{t('transactions.not_found')}</p>
        <Link to="/transactions">
          <Button variant="secondary">{t('transactions.back_to_list')}</Button>
        </Link>
      </div>
    );
  }
  if (!tx.data) {
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-8 w-8" label={t('common.loading')} />
      </div>
    );
  }

  const r = tx.data;
  const currency = r.currency as Currency;
  const visible = new Set(config.data?.form_fields.map((f) => f.field_name) ?? []);
  const branchName = branches.data?.find((b) => b.id === r.branch)?.name ?? '';
  const profit = Number(r.row_summary.profit_or_loss_afn);
  // Only the expenses this record actually has; the totals below cover them all anyway.
  const expenseRows = EXPENSE_FIELDS.filter((f) => Number(r[f] ?? 0) !== 0);
  // An AFN record needs no «own currency» column: it would repeat the AFN one.
  const foreign = currency !== 'AFN';
  const ownTotal = expenseRows.reduce((sum, f) => sum + Number(r[f] ?? 0), 0);
  const payment = convert(Number(r.customer_payment), r);

  function show(field: string): string {
    const v = r[field];
    const type = FIELD_TYPES[field];
    if (field === 'trader') return r.trader_name ?? '—';
    if (field === 'transport_company') return r.transport_company_name ?? '—';
    if (v === null || v === undefined || v === '') return '—';
    if (type === 'boolean') return v ? t('common.yes') : t('common.no');
    if (field === 'status') return t(`statuses.${String(v)}`);
    if (type === 'date') return `${toDariDigits(String(v))} (${toGregorian(String(v))})`;
    if (type === 'decimal' || type === 'integer' || type === 'money') {
      return isRtlLang(lang) ? d(String(v)).replace('.', '٫') : String(v);
    }
    return String(v);
  }

  async function onDelete(): Promise<void> {
    const ok = await confirm({
      title: t('transactions.delete_title', { serial: isolateLtr(r.serial_number) }),
      message: t('transactions.delete_message'),
      variant: 'danger',
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    await api.delete(`/transactions/${r.id}/`);
    await qc.invalidateQueries({ queryKey: [...TX_KEY] });
    toast.success(t('transactions.deleted', { serial: isolateLtr(r.serial_number) }));
    navigate('/transactions');
  }

  const money = (value: number | string | null | undefined, cur: Currency): string =>
    value === null || value === undefined ? '—' : formatMoney(value, cur, lang);

  return (
    <article className="space-y-6 print:space-y-4" data-testid="tx-detail">
      {/* Print-only letterhead */}
      <header
        className="hidden border-b-2 border-black pb-3 print:block"
        data-testid="print-header"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-2xl font-bold">{t('app.name')}</p>
            <p className="text-sm">kabulcargo.com</p>
          </div>
          <div className="text-end text-sm">
            <p>
              {t('detail.printed_on')}: {isolateLtr(toDariDigits(todayShamsi()))}
            </p>
            <p dir="ltr">{toGregorian(todayShamsi())}</p>
          </div>
        </div>
      </header>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold">
            {t('detail.title')}{' '}
            <code className="font-mono" dir="ltr" data-testid="detail-serial">
              {r.serial_number}
            </code>
            <Badge className={TRADE_TONE[r.trade_type]}>{t(`trade_types.${r.trade_type}`)}</Badge>
            <Badge>{t(`statuses.${r.status}`)}</Badge>
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-gray-600 dark:text-gray-400">
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="h-4 w-4 print:hidden" aria-hidden />
              {t('transactions.branch')}: {branchName || '…'}
            </span>
            <span className="inline-flex items-center gap-1.5" data-testid="detail-date">
              <CalendarDays className="h-4 w-4 print:hidden" aria-hidden />
              {toDariDigits(r.date)} <span dir="ltr">({toGregorian(r.date)})</span>
            </span>
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button variant="secondary" onClick={() => window.print()} data-testid="detail-print">
            <Printer className="h-4 w-4" />
            {t('detail.print')}
          </Button>
          <Button onClick={() => navigate(`/transactions/${r.id}/edit`)} data-testid="detail-edit">
            <Pencil className="h-4 w-4" />
            {t('common.edit')}
          </Button>
          <Button variant="danger" onClick={() => void onDelete()} data-testid="detail-delete">
            <Trash2 className="h-4 w-4" />
            {t('common.delete')}
          </Button>
        </div>
      </div>

      {/* Money table: every amount in its own currency, AFN and USD */}
      <Card
        className="overflow-hidden print:break-inside-avoid print:shadow-none"
        data-testid="money-table"
      >
        <h2 className="px-5 pt-4 font-semibold text-brand dark:text-emerald-300 print:text-black">
          {t('detail.money')}
        </h2>
        <p className="px-5 pb-2 text-xs text-gray-500">
          {currency === 'AFN'
            ? t('detail.rate_afn')
            : t('detail.rate_line', { currency, rate: formatRate(r.exchange_rate, lang) })}{' '}
          ·{' '}
          {r.row_summary.fee_per_dollar_afn
            ? t('detail.usd_rate_line', {
                rate: formatRate(r.row_summary.fee_per_dollar_afn, lang),
              })
            : t('summary.usd_unknown')}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <caption className="sr-only">{t('detail.money')}</caption>
            <thead className="bg-gray-50 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
              <tr>
                <th scope="col" className="px-5 py-2 text-start">
                  {t('detail.item')}
                </th>
                {foreign && (
                  <th scope="col" className="px-3 py-2 text-end">
                    {currency}
                  </th>
                )}
                <th scope="col" className="px-3 py-2 text-end">
                  AFN
                </th>
                <th scope="col" className="px-5 py-2 text-end">
                  USD
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              <MoneyRow
                label={t('form.customer_payment')}
                note={t('detail.revenue')}
                own={foreign ? money(r.customer_payment, currency) : undefined}
                afn={money(payment.afn, 'AFN')}
                usd={money(payment.usd, 'USD')}
                strong
              />
              {expenseRows.map((f) => {
                const c = convert(Number(r[f] ?? 0), r);
                return (
                  <MoneyRow
                    key={f}
                    label={t(`form.${f}`)}
                    own={foreign ? money(String(r[f] ?? 0), currency) : undefined}
                    afn={money(c.afn, 'AFN')}
                    usd={money(c.usd, 'USD')}
                    testId={`money-${f}`}
                  />
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-gray-200 dark:border-gray-600">
              <MoneyRow
                label={t('summary.expenses')}
                own={foreign ? money(ownTotal, currency) : undefined}
                afn={money(r.row_summary.total_expense_afn, 'AFN')}
                usd={money(r.row_summary.total_expense_usd, 'USD')}
                strong
              />
              <tr
                className={cn(
                  'text-base font-bold',
                  profit > 0 && 'text-emerald-700 dark:text-emerald-400',
                  profit < 0 && 'text-red-700 dark:text-red-400',
                )}
              >
                <th scope="row" className="px-5 py-3 text-start">
                  {t('summary.balance')}
                </th>
                {foreign && (
                  <td className="px-3 py-3 text-end tabular-nums">{money(r.balance, currency)}</td>
                )}
                <td className="px-3 py-3 text-end tabular-nums" data-testid="detail-profit-afn">
                  {money(r.row_summary.profit_or_loss_afn, 'AFN')}
                </td>
                <td className="px-5 py-3 text-end tabular-nums" data-testid="detail-profit-usd">
                  {money(r.row_summary.profit_or_loss_usd, 'USD')}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* Read-only sections, same grouping as the form */}
      <div className="grid gap-6 lg:grid-cols-2 print:grid-cols-2 print:gap-3">
        {SECTIONS.map((section) => {
          const fields = section.fields.filter(
            (f) => !MONEY_TABLE.has(f) && (visible.has(f) || r[f]),
          );
          if (!fields.length) return null;
          return (
            <Card
              key={section.key}
              className="p-5 print:break-inside-avoid print:p-3 print:shadow-none"
              data-testid={`detail-section-${section.key}`}
            >
              <h2 className="mb-3 font-semibold text-brand dark:text-emerald-300 print:text-black">
                {t(`sections.${section.key}`)}
              </h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                {fields.map((f) => (
                  <div key={f} className="contents">
                    <dt className="text-gray-500 dark:text-gray-400">{t(`form.${f}`)}</dt>
                    <dd
                      className="font-medium"
                      dir={/number|plate|phone|serial/.test(f) ? 'ltr' : undefined}
                    >
                      <span
                        className={cn(
                          /number|plate|phone|serial/.test(f) && 'inline-block text-start',
                        )}
                      >
                        {show(f)}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          );
        })}
      </div>

      {/* Print-only signatures */}
      <div
        className="hidden grid-cols-3 gap-8 pt-12 text-center text-sm print:grid"
        data-testid="print-signatures"
      >
        {['detail.sign_prepared', 'detail.sign_checked', 'detail.sign_approved'].map((k) => (
          <div key={k} className="border-t border-black pt-2">
            {t(k)}
          </div>
        ))}
      </div>

      <DocumentsPanel transactionId={r.id} />

      <Card className="p-5 print:hidden" data-testid="detail-history">
        <h2 className="mb-4 font-semibold text-brand dark:text-emerald-300">
          {t('history.title')}
        </h2>
        <HistoryTimeline
          entries={history.data}
          loading={history.isPending}
          fieldLabel={(f) => (i18n.exists(`form.${f}`) ? t(`form.${f}`) : undefined)}
        />
      </Card>
    </article>
  );
}

function MoneyRow({
  label,
  note,
  own,
  afn,
  usd,
  strong = false,
  testId,
}: {
  label: string;
  note?: string;
  /** Amount in the record's own currency; left out for AFN records. */
  own?: string;
  afn: string;
  usd: string;
  strong?: boolean;
  testId?: string;
}): JSX.Element {
  return (
    <tr className={cn(strong && 'font-semibold')} data-testid={testId}>
      <th scope="row" className="px-5 py-2 text-start font-normal">
        <span className={cn(strong && 'font-semibold')}>{label}</span>
        {note && (
          <span className="ms-2 text-xs text-emerald-700 dark:text-emerald-400">{note}</span>
        )}
      </th>
      {own !== undefined && <td className="px-3 py-2 text-end tabular-nums">{own}</td>}
      <td className="px-3 py-2 text-end tabular-nums">{afn}</td>
      <td
        className="px-5 py-2 text-end tabular-nums"
        data-testid={testId ? `${testId}-usd` : undefined}
      >
        {usd}
      </td>
    </tr>
  );
}
