import { AlertTriangle, ArrowLeft, CheckCircle2, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { isRtlLang } from '@/lib/digits';
import { formatRate } from '@/lib/money';
import { useTodayUsdRate } from '@/lib/rates';

interface TodayRateBannerProps {
  /** Opens the create drawer (rates page). */
  onAdd?: () => void;
  /** Turns the whole banner into a link (dashboard). */
  to?: string;
  className?: string;
}

/**
 * Green when today's USD rate exists, red (with a call to action) when it is missing —
 * which is when the API blocks new transactions with 428.
 */
export function TodayRateBanner({ onAdd, to, className }: TodayRateBannerProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const { rate, isPending } = useTodayUsdRate();
  const missing = !isPending && !rate;

  const body = (
    <div
      role="status"
      data-testid="today-rate-banner"
      data-state={isPending ? 'pending' : missing ? 'missing' : 'set'}
      className={cn(
        'flex flex-wrap items-center gap-4 rounded-xl border px-5 py-4',
        isPending && 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
        !isPending &&
          !missing &&
          'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-100',
        missing &&
          'border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-900/30 dark:text-red-100',
        to && 'transition-shadow hover:shadow-md',
        className,
      )}
    >
      {missing ? (
        <AlertTriangle className="h-7 w-7 shrink-0 text-red-600 dark:text-red-400" />
      ) : (
        <CheckCircle2 className="h-7 w-7 shrink-0 text-emerald-600 dark:text-emerald-400" />
      )}
      <div className="min-w-0 flex-1">
        {isPending ? (
          <div className="h-5 w-48 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        ) : missing ? (
          <>
            <p className="font-semibold">⚠ {t('rates.today_missing')}</p>
            <p className="mt-0.5 text-sm opacity-80">{t('rates.today_missing_body')}</p>
          </>
        ) : (
          <p className="text-lg font-semibold">
            {t('rates.today_set')}{' '}
            {/* Own LTR run: inside RTL text the equation's parts would otherwise be reordered. */}
            <span dir="ltr" className="inline-block">
              {isRtlLang(i18n.language) ? '۱' : '1'} USD = {formatRate(rate?.rate, i18n.language)}{' '}
              AFN
            </span>
          </p>
        )}
      </div>
      {missing && onAdd && (
        <Button
          size="lg"
          onClick={onAdd}
          data-testid="today-rate-cta"
          className="bg-red-600 hover:bg-red-700 focus-visible:ring-red-500"
        >
          <Plus className="h-5 w-5" />
          {t('rates.today_set_cta')}
        </Button>
      )}
      {to && <ArrowLeft className="h-5 w-5 shrink-0 opacity-60 ltr:rotate-180" aria-hidden />}
    </div>
  );

  return to ? (
    <Link
      to={to}
      className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      {body}
    </Link>
  ) : (
    body
  );
}
