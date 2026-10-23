from datetime import date

import django_filters
import jdatetime
from django_filters.constants import EMPTY_VALUES
from rest_framework.exceptions import ValidationError

from kabulcargo_backend.utils import normalize_digits


def parse_any_date(text):
    """
    'YYYY-MM-DD' (or with '/') in Shamsi or Gregorian, any digit script →
    jdatetime.date. Years from 1700 on are read as Gregorian.
    """
    year, month, day = (int(part) for part in normalize_digits(str(text)).replace('/', '-').split('-'))
    if year >= 1700:
        return jdatetime.date.fromgregorian(date=date(year, month, day))
    return jdatetime.date(year, month, day)


class ShamsiDateFilter(django_filters.CharFilter):
    """Date filter for jDateField that accepts Shamsi or Gregorian input."""

    def filter(self, qs, value):
        if value in EMPTY_VALUES:
            return qs
        try:
            value = parse_any_date(value)
        except (TypeError, ValueError):
            raise ValidationError({self.field_name: 'تاریخ نامعتبر است. شکل درست: ۱۴۰۵-۰۸-۰۱ یا 2026-10-23'})
        return super().filter(qs, value)
