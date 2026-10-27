"""
IAS 1 (light) income statement, by function of expense:

    revenue − cost of services (COGS) = gross profit
    gross profit − operating expenses (OPEX) − other = net profit

Pure functions, no HTTP. Amounts are Decimal strings with 2 places.
"""
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

import jdatetime
from django.db.models import DecimalField, F, Sum

from accounts.models import Branch
from operations.models import Transaction

from .models import SPECIAL_SOURCES, ExchangeRate, Hawala, OfficeExpense, StatementLine
from .utils import UsdRateTable, kabul_today

SECTION_ORDER = [StatementLine.Section.REVENUE, StatementLine.Section.COGS,
                 StatementLine.Section.OPEX, StatementLine.Section.OTHER]
CENT = Decimal('0.01')
AFN, USD = Transaction.Currency.AFN, Transaction.Currency.USD


def current_shamsi_month():
    """(first day, last day) of the current Shamsi month in Kabul."""
    today = kabul_today()
    first = jdatetime.date(today.year, today.month, 1)
    next_first = (jdatetime.date(today.year + 1, 1, 1) if today.month == 12
                  else jdatetime.date(today.year, today.month + 1, 1))
    return first, next_first - timedelta(days=1)


def _money(value):
    return None if value is None else str(value.quantize(CENT, rounding=ROUND_HALF_UP))


class _Amount:
    """Running AFN + USD total. A part whose value cannot be computed makes that column unknown (None)."""

    def __init__(self):
        self.afn, self.usd = Decimal('0'), Decimal('0')

    def add(self, afn, usd):
        self.afn = None if self.afn is None or afn is None else self.afn + afn
        self.usd = None if self.usd is None or usd is None else self.usd + usd

    def combine(self, other, sign=1):
        self.add(None if other.afn is None else sign * other.afn, None if other.usd is None else sign * other.usd)
        return self


def _fallback_rate(day, currency):
    """Rate to AFN for a record saved without one (no rate existed that day at entry)."""
    rate = (ExchangeRate.objects.filter(currency=currency, date__lte=day)
            .order_by('-date').values_list('rate', flat=True).first())
    return rate


def _convert(amount, currency, rate_to_afn, day, usd_rates):
    """One amount in its own currency → (AFN, USD). Either can be None when a rate is unknown."""
    if currency == AFN:
        afn = amount
    elif rate_to_afn:
        afn = amount * rate_to_afn
    else:
        afn = None
    if currency == USD:
        usd = amount
    else:
        usd_rate = usd_rates.on(day)
        usd = afn / usd_rate if afn is not None and usd_rate else None
    return afn, usd


def _transaction_amounts(fields, period, branch_id, usd_rates):
    """{field: _Amount} summed over the period's transactions (grouped by date + currency in SQL)."""
    totals = {field: _Amount() for field in fields}
    if not fields:
        return totals, 0
    qs = Transaction.objects.filter(date__range=period)
    if branch_id:
        qs = qs.filter(branch_id=branch_id)
    big = DecimalField(max_digits=32, decimal_places=10)
    annotations = {}
    for field in fields:
        annotations[f'{field}__raw'] = Sum(field)
        annotations[f'{field}__afn'] = Sum(F(field) * F('exchange_rate'), output_field=big)
    count = qs.count()
    for group in qs.values('date', 'currency').annotate(**annotations).order_by():
        for field in fields:
            raw = group[f'{field}__raw'] or Decimal('0')
            afn = raw if group['currency'] == AFN else (group[f'{field}__afn'] or Decimal('0'))
            if group['currency'] == USD:
                usd = raw
            else:
                usd_rate = usd_rates.on(group['date'])
                usd = afn / usd_rate if usd_rate else None
            totals[field].add(afn, usd)
    return totals, count


def _record_afn_usd(record, amount, usd_rates):
    """
    One hawala / office-expense amount → ((AFN, USD), rate used). AFN at the record's snapshot
    rate (rate_used), else the latest rate on or before its date; USD at the USD rate of its
    date. Shared by the income statement and the hawala / office-expense list totals, so the
    two always agree.
    """
    rate = record.rate_used or (None if record.currency == AFN else _fallback_rate(record.date, record.currency))
    return _convert(amount, record.currency, rate, record.date, usd_rates), rate


def amount_totals(records, field='amount', group_by=None):
    """
    Totals of `field` over hawala / office-expense records (e.g. a filtered list):
    {by_currency: {currency: amount}, afn, usd, groups: {key: {afn, usd}}, unconverted}.
    afn / usd are None when some record's rate is unknown (never a wrong number);
    `unconverted` counts those records.
    """
    records = list(records)
    by_currency, groups, total, unconverted = {}, {}, _Amount(), 0
    usd_rates = UsdRateTable(until=max(r.date for r in records)) if records else None
    for record in records:
        amount = getattr(record, field) or Decimal('0')
        by_currency[record.currency] = by_currency.get(record.currency, Decimal('0')) + amount
        (afn, usd), rate = _record_afn_usd(record, amount, usd_rates)
        if record.currency != AFN and rate is None:
            unconverted += 1
        total.add(afn, usd)
        if group_by:
            groups.setdefault(getattr(record, group_by), _Amount()).add(afn, usd)
    return {
        'by_currency': {currency: _money(value) for currency, value in sorted(by_currency.items())},
        'afn': _money(total.afn),
        'usd': _money(total.usd),
        'groups': {key: {'afn': _money(a.afn), 'usd': _money(a.usd)} for key, a in sorted(groups.items())},
        'unconverted': unconverted,
    }


def _special_amounts(sources, period, branch_id, usd_rates, warnings):
    """Office expenses (salary / everything else) and hawala fees, each converted at its own snapshot rate."""
    totals = {source: _Amount() for source in sources}
    if '@office_expense' in sources or '@office_salary' in sources:
        expenses = OfficeExpense.objects.filter(date__range=period)
        if branch_id:
            expenses = expenses.filter(branch_id=branch_id)
        for expense in expenses:
            source = '@office_salary' if expense.category == OfficeExpense.Category.SALARY else '@office_expense'
            if source in totals:
                converted, rate = _record_afn_usd(expense, expense.amount, usd_rates)
                totals[source].add(*converted)
                if expense.currency != AFN and rate is None:
                    warnings.append(f'مصرف دفتر شماره {expense.pk}: نرخ {expense.currency} برای {expense.date} نیست.')
    if '@hawala_fee' in sources:
        hawalas = Hawala.objects.filter(date__range=period).exclude(fee=0)
        if branch_id:
            hawalas = hawalas.filter(branch_id=branch_id)
        for hawala in hawalas:
            converted, rate = _record_afn_usd(hawala, hawala.fee, usd_rates)
            totals['@hawala_fee'].add(*converted)
            if hawala.currency != AFN and rate is None:
                warnings.append(f'حوالهٔ شماره {hawala.pk}: نرخ {hawala.currency} برای {hawala.date} نیست.')
    return totals


def income_statement(branch_id=None, date_from=None, date_to=None):
    """
    The income statement for one branch (or all branches when branch_id is
    None) over a Shamsi period (default: the current Shamsi month). Dates are
    jdatetime.date. Aggregates on Transaction.date, not creation time.
    """
    if date_from is None and date_to is None:
        date_from, date_to = current_shamsi_month()
    period = (date_from, date_to)
    warnings = []

    lines = list(StatementLine.objects.filter(is_active=True))
    usd_rates = UsdRateTable(until=date_to)
    field_sources = [line.source_field for line in lines if line.source_field not in SPECIAL_SOURCES]
    special_sources = [line.source_field for line in lines if line.source_field in SPECIAL_SOURCES]
    amounts, transaction_count = _transaction_amounts(field_sources, period, branch_id, usd_rates)
    amounts.update(_special_amounts(special_sources, period, branch_id, usd_rates, warnings))

    lines.sort(key=lambda line: (SECTION_ORDER.index(line.section), line.sort_order, line.code))
    section_totals = {section: _Amount() for section in SECTION_ORDER}
    rendered = []
    for line in lines:
        amount = amounts[line.source_field]
        section_totals[line.section].combine(amount)
        rendered.append({
            'section': line.section, 'section_label': line.get_section_display(),
            'code': line.code, 'label_fa': line.label_fa, 'label_en': line.label_en,
            'source_field': line.source_field,
            'amount_afn': _money(amount.afn), 'amount_usd': _money(amount.usd),
        })

    revenue, cogs = section_totals['REVENUE'], section_totals['COGS']
    opex, other = section_totals['OPEX'], section_totals['OTHER']
    gross = _Amount().combine(revenue).combine(cogs, sign=-1)
    net = _Amount().combine(gross).combine(opex, sign=-1).combine(other, sign=-1)

    # Sources with no active line are silently missing from the totals: say so.
    covered = {line.source_field for line in lines}
    all_sources = ['customer_payment', *Transaction.EXPENSE_FIELDS, *SPECIAL_SOURCES]
    unmapped = [source for source in all_sources if source not in covered]
    if unmapped:
        warnings.append('این منابع در هیچ سطر فعالی نیستند و در گزارش حساب نشده‌اند: ' + '، '.join(unmapped))
    if usd_rates.missing_dates:
        warnings.append('نرخ دالر برای این تاریخ‌ها (و قبل از آن) ثبت نشده، پس ستون دالر کامل نیست: '
                        + '، '.join(sorted(usd_rates.missing_dates)))

    branch = Branch.objects.filter(pk=branch_id).values('id', 'name', 'code').first() if branch_id else None
    return {
        'period': {'from': str(date_from), 'to': str(date_to),
                   'from_gregorian': str(date_from.togregorian()), 'to_gregorian': str(date_to.togregorian())},
        'branch': branch,
        'transactions_count': transaction_count,
        'lines': rendered,
        'totals': {
            'revenue_afn': _money(revenue.afn), 'revenue_usd': _money(revenue.usd),
            'cogs_afn': _money(cogs.afn), 'cogs_usd': _money(cogs.usd),
            'gross_profit_afn': _money(gross.afn), 'gross_profit_usd': _money(gross.usd),
            'opex_afn': _money(opex.afn), 'opex_usd': _money(opex.usd),
            'other_afn': _money(other.afn), 'other_usd': _money(other.usd),
            'net_profit_afn': _money(net.afn), 'net_profit_usd': _money(net.usd),
        },
        'warnings': warnings,
    }
