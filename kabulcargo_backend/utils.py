"""
Small shared helpers used from day one:
- digit normalization (Persian/Arabic -> English) before any number parsing
- dual Shamsi / Gregorian date display
"""
from decimal import Decimal, InvalidOperation

import jdatetime
from django.utils import timezone

_DIGIT_MAP = str.maketrans(
    '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩٫٬',
    '01234567890123456789.,',
)


def normalize_digits(value):
    """Convert Persian (۰-۹) and Arabic (٠-٩) digits to English. Non-strings pass through."""
    if not isinstance(value, str):
        return value
    return value.translate(_DIGIT_MAP).strip()


def parse_decimal(value):
    """Parse a user-typed number in any digit script into Decimal. Thousands separators are ignored."""
    if value is None or isinstance(value, Decimal):
        return value
    text = normalize_digits(str(value)).replace(',', '').replace(' ', '')
    try:
        return Decimal(text)
    except InvalidOperation as exc:
        raise ValueError(f'عدد نامعتبر: {value}') from exc


def dual_date(value):
    """Return 'Shamsi | Gregorian' text for a date or datetime (shown in local Kabul time)."""
    if not value:
        return '—'
    if isinstance(value, (jdatetime.date, jdatetime.datetime)):
        value = value.togregorian()
    if hasattr(value, 'hour'):
        value = timezone.localtime(value) if timezone.is_aware(value) else value
        shamsi = jdatetime.datetime.fromgregorian(datetime=value).strftime('%Y/%m/%d %H:%M')
        return f'{shamsi} | {value:%Y-%m-%d %H:%M}'
    shamsi = jdatetime.date.fromgregorian(date=value).strftime('%Y/%m/%d')
    return f'{shamsi} | {value:%Y-%m-%d}'
