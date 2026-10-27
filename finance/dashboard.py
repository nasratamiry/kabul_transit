"""
Dashboard figures: this Shamsi month vs the previous one. Every money figure comes from
finance.reports.income_statement (the same service as the income statement page), so the
dashboard and the statement can never disagree. Few queries: two statements, one grouped
query for the top traders, one for the recent rows, one for today's rate.
"""
from datetime import timedelta

import jdatetime
from django.db.models import Count, DecimalField, F, Sum

from operations.models import Transaction

from .models import ExchangeRate
from .reports import AFN, USD, _Amount, _money, current_shamsi_month, income_statement
from .utils import UsdRateTable, kabul_today


def previous_shamsi_month(first_day):
    """(first, last) day of the Shamsi month before the one starting on `first_day`."""
    last = first_day - timedelta(days=1)
    return jdatetime.date(last.year, last.month, 1), last


def _month(report):
    return {'period': report['period'], **report['summary']}


def _top_traders(period, branch_id, limit=5):
    """Traders by customer payment in AFN (USD beside it), converted like the statement does."""
    qs = Transaction.objects.filter(date__range=period, trader__isnull=False)
    if branch_id:
        qs = qs.filter(branch_id=branch_id)
    big = DecimalField(max_digits=32, decimal_places=10)
    groups = (qs.values('trader_id', 'trader__name', 'date', 'currency')
              .annotate(raw=Sum('customer_payment'), afn=Sum(F('customer_payment') * F('exchange_rate'),
                                                            output_field=big), n=Count('id'))
              .order_by())
    usd_rates = UsdRateTable(until=period[1])
    traders = {}
    for g in groups:
        trader = traders.setdefault(g['trader_id'], {'name': g['trader__name'], 'count': 0, 'amount': _Amount()})
        afn = g['raw'] if g['currency'] == AFN else g['afn']
        if g['currency'] == USD:
            usd = g['raw']
        else:
            usd_rate = usd_rates.on(g['date'])
            usd = afn / usd_rate if usd_rate else None
        trader['count'] += g['n']
        trader['amount'].add(afn, usd)
    ranked = sorted(traders.items(), key=lambda item: item[1]['amount'].afn or 0, reverse=True)[:limit]
    return [{'id': trader_id, 'name': t['name'], 'transactions_count': t['count'],
             'customer_payment_afn': _money(t['amount'].afn), 'customer_payment_usd': _money(t['amount'].usd)}
            for trader_id, t in ranked]


def _recent(branch_id, limit=10):
    qs = Transaction.objects.select_related('trader', 'branch').order_by('-date', '-id')
    if branch_id:
        qs = qs.filter(branch_id=branch_id)
    return [{'id': tx.id, 'serial_number': tx.serial_number, 'date': str(tx.date),
             'date_gregorian': str(tx.date.togregorian()), 'trade_type': tx.trade_type,
             'status': tx.status, 'branch': tx.branch.name, 'trader': tx.trader.name if tx.trader else None,
             'currency': tx.currency, 'customer_payment': str(tx.customer_payment)}
            for tx in qs[:limit]]


def dashboard_summary(branch_id=None, compare_branches=False):
    """branch_id None = all branches; compare_branches adds one row per branch (this month)."""
    current_from, current_to = current_shamsi_month()
    previous = income_statement(branch_id, *previous_shamsi_month(current_from))
    current = income_statement(branch_id, current_from, current_to, breakdown=True)
    today = kabul_today()
    rate = ExchangeRate.objects.filter(date=today, currency=USD).values('rate').first()
    summary = {
        'current': _month(current),
        'previous': _month(previous),
        'daily': [{'date': d['date'], 'date_gregorian': d['date_gregorian'],
                   'net_profit_afn': d['net_profit_afn'], 'net_profit_usd': d['net_profit_usd'],
                   'transactions_count': d['transactions_count']}
                  for d in current['daily'] if jdatetime.date.fromisoformat(d['date']) <= today],
        'top_traders': _top_traders((current_from, current_to), branch_id),
        'recent_transactions': _recent(branch_id),
        'today_rate': {'date': str(today), 'currency': USD,
                       'rate': str(rate['rate']) if rate else None, 'is_set': rate is not None},
        'warnings': current['warnings'],
    }
    if compare_branches and not branch_id:
        summary['branches'] = current['branches']
    return summary
