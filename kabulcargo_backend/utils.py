"""
Small shared helpers used from day one:
- digit normalization (Persian/Arabic -> English) before any number parsing
- dual Shamsi / Gregorian date display
- free-text sanitization (no HTML, no control characters, bounded length)
"""
import html
import re
from decimal import Decimal, InvalidOperation

import bleach
import jdatetime
from django.core.exceptions import ValidationError
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


# C0/C1 control characters except tab, newline and carriage return. Dari text
# marks such as ZWNJ (U+200C) are not in this range and are kept.
_CONTROL_CHARS = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]')
# Browsers only start a tag when "<" is directly followed by a letter, "/", "!" or "?".
_TAG_LIKE = re.compile(r'<[a-zA-Z/!?]')


def sanitize_text(value, max_length=500):
    """
    Clean user-typed free text before it is saved:
    - longer than max_length → ValidationError (Dari message);
    - control characters are removed;
    - all HTML is stripped with bleach (empty whitelist), so <script> tags and
      on* attributes can never be stored. Entities are decoded again so that
      ordinary text such as "A & B" is stored as typed, and the loop catches
      tags hidden behind entities (&lt;script&gt;).
    """
    if not isinstance(value, str):
        return value
    if len(value) > max_length:
        raise ValidationError(f'متن خیلی طولانی است: حداکثر {max_length} حرف مجاز است.', code='max_length')
    text = _CONTROL_CHARS.sub('', value)
    for _ in range(3):
        text = html.unescape(bleach.clean(text, tags=set(), attributes={}, strip=True, strip_comments=True))
        if not _TAG_LIKE.search(text):
            return text
    raise ValidationError('متن شامل کود HTML است و قبول نمی‌شود.', code='html')
