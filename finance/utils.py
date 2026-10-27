"""Helpers for daily exchange rates and the daily-rate soft lock."""
import bisect

import jdatetime
from django.utils import timezone


def kabul_today():
    """Jalali date for today in Asia/Kabul."""
    return jdatetime.date.fromgregorian(date=timezone.localdate())


def kabul_today_lazy():
    """Callable for use as model default."""
    return kabul_today()


def get_todays_usd_rate():
    """Return today's USD ExchangeRate or None. Avoids circular imports."""
    from .models import ExchangeRate
    return ExchangeRate.objects.filter(date=kabul_today(), currency='USD').first()


def get_rate_for(date, currency):
    """
    Return ExchangeRate for (date, currency) or the most recent prior rate.
    Returns None if nothing is found. AFN has no rate (it is always 1) — the
    caller handles AFN specially.
    """
    if currency == 'AFN':
        return None
    from .models import ExchangeRate
    exact = ExchangeRate.objects.filter(date=date, currency=currency).first()
    if exact:
        return exact
    return ExchangeRate.objects.filter(date__lt=date, currency=currency).order_by('-date').first()


def usd_rate_on(day):
    """
    USD→AFN rate for a date: that day's rate, else the most recent earlier one; None when no
    rate exists on or before it. Never today's rate for an older date. One query. This is the
    rule of the income statement and of every transaction's USD figures.
    """
    from .models import ExchangeRate
    return (ExchangeRate.objects.filter(currency='USD', date__lte=day)
            .order_by('-date').values_list('rate', flat=True).first())


class UsdRateTable:
    """
    usd_rate_on() for many dates with a fixed number of queries: loads the USD rates up to
    `until` once (1 query) — or only from `since` on, plus the latest rate before it (2 queries)
    — then answers each date from memory. Dates without any rate are collected in
    `missing_dates`.
    """

    def __init__(self, until, since=None):
        from .models import ExchangeRate
        rates = ExchangeRate.objects.filter(currency='USD', date__lte=until)
        if since is None:
            rows = list(rates.order_by('date').values_list('date', 'rate'))
        else:
            rows = list(rates.filter(date__gte=since).order_by('date').values_list('date', 'rate'))
            earlier = rates.filter(date__lt=since).order_by('-date').values_list('date', 'rate').first()
            if earlier:
                rows.insert(0, earlier)
        self.dates = [row[0] for row in rows]
        self.rates = [row[1] for row in rows]
        self.missing_dates = set()

    def on(self, day):
        index = bisect.bisect_right(self.dates, day) - 1
        if index < 0:
            self.missing_dates.add(str(day))
            return None
        return self.rates[index]


def attach_usd_rates(transactions):
    """
    Give every non-USD transaction its date's USD rate (Transaction._usd_rate) in at most two
    queries, so a list of rows does not query once per row for its USD figures.
    """
    rows = [tx for tx in transactions if tx.currency != 'USD']
    if not rows:
        return
    table = UsdRateTable(until=max(tx.date for tx in rows), since=min(tx.date for tx in rows))
    for tx in rows:
        tx._usd_rate = table.on(tx.date)


class TodayRateMissing(Exception):
    """Raised when today's USD→AFN rate is not set yet. Causes HTTP 428 in API."""
    code = 'TODAY_RATE_MISSING'
    detail_fa = 'نرخ امروز دالر به افغانی ثبت نشده است. لطفاً ابتدا نرخ امروز را وارد کنید.'


def require_todays_usd_rate():
    """Call before any Transaction/Hawala/OfficeExpense create. Raises if missing."""
    rate = get_todays_usd_rate()
    if rate is None:
        raise TodayRateMissing()
    return rate
