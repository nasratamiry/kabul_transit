"""Helpers for daily exchange rates and the daily-rate soft lock."""
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
