"""
Test fixtures for scripts/verify-stage14.mjs.

    ..\\.venv\\Scripts\\python scripts\\cleanup-stage14.py --setup   # before the run
    ..\\.venv\\Scripts\\python scripts\\cleanup-stage14.py           # after the run

--setup (idempotent): super_admin e2e_admin, branches E2E14A / E2E14B / E2E14C (C stays empty),
branch managers e2e_mgr (A), e2e_mgr_b (B); USD 70 from 60 days ago and today; traders
«تاجر ۱۴ الف» / «تاجر ۱۴ ب»; transactions in A this month (one day a loss), last month and
400 days ago (before any USD rate: the report must warn), one in B; an office expense and a
hawala fee in A. Without --setup everything is removed again, history rows included.
"""
import os
import sys
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'kabulcargo_backend.settings')
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

import django  # noqa: E402

django.setup()

from axes.models import AccessAttempt  # noqa: E402
from django.db import transaction  # noqa: E402

from accounts.models import Branch, User  # noqa: E402
from finance.dashboard import previous_shamsi_month  # noqa: E402
from finance.models import ExchangeRate, Hawala, OfficeExpense  # noqa: E402
from finance.reports import current_shamsi_month  # noqa: E402
from finance.utils import kabul_today  # noqa: E402
from operations.models import Transaction  # noqa: E402
from partners.models import Trader  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_history import purge_history  # noqa: E402

PASSWORD = 'E2e-Stage14-Pass-2026'
BRANCHES = {'E2E14A': 'بندر آزمایشی ۱۴ الف', 'E2E14B': 'بندر آزمایشی ۱۴ ب', 'E2E14C': 'بندر آزمایشی ۱۴ ج'}
USERS = {'e2e_admin': None, 'e2e_mgr': 'E2E14A', 'e2e_mgr_b': 'E2E14B', 'e2e_mgr_a2': 'E2E14A'}
TRADERS = ['تاجر ۱۴ الف', 'تاجر ۱۴ ب']


def setup():
    branches = {code: Branch.objects.get_or_create(code=code, defaults={'name': name})[0]
                for code, name in BRANCHES.items()}
    for username, code in USERS.items():
        defaults = ({'role': 'super_admin', 'first_name': 'ادمین', 'last_name': 'آزمایشی'} if code is None
                    else {'role': 'branch_manager', 'branch': branches[code], 'first_name': 'مدیر', 'last_name': code})
        user, _ = User.objects.get_or_create(username=username, defaults=defaults)
        user.set_password(PASSWORD)
        user.is_active = True
        user.save()
    admin = User.objects.get(username='e2e_admin')
    today = kabul_today()
    for day in (today - timedelta(days=60), today):
        ExchangeRate.objects.update_or_create(date=day, currency='USD',
                                              defaults={'rate': Decimal('70'), 'created_by': admin})
    x, y = (Trader.objects.get_or_create(name=name)[0] for name in TRADERS)
    a, b = branches['E2E14A'], branches['E2E14B']
    month_from, _ = current_shamsi_month()
    prev_from, _ = previous_shamsi_month(month_from)
    if not Transaction.objects.filter(branch__in=[a, b]).exists():
        rows = [
            (a, 'S14-001', month_from, 'AFN', 1, x, {'customer_payment': '10000', 'tariff_expense': '2000'}),
            # a loss day (only when it is not today, so today's bars stay positive)
            (a, 'S14-002', min(month_from + timedelta(days=1), today), 'AFN', 1, x,
             {'customer_payment': '500', 'khak_puli_cash': '2500'}),
            (a, 'S14-003', today, 'USD', 70, y, {'customer_payment': '100', 'tariff_expense': '30'}),
            (a, 'S14-P01', prev_from + timedelta(days=3), 'AFN', 1, x,
             {'customer_payment': '8000', 'tariff_expense': '1000'}),
            (a, 'S14-OLD', today - timedelta(days=400), 'AFN', 1, None, {'customer_payment': '100'}),
            (b, 'S14-B01', today, 'AFN', 1, y, {'customer_payment': '4000', 'tariff_expense': '1000'}),
        ]
        for branch, serial, day, currency, rate, trader, amounts in rows:
            Transaction.objects.create(branch=branch, trade_type='EXPORT', serial_number=serial, date=day,
                                       currency=currency, exchange_rate=Decimal(rate), trader=trader,
                                       created_by=admin, **{k: Decimal(v) for k, v in amounts.items()})
        OfficeExpense.objects.create(branch=a, date=today, category='RENT', amount=Decimal('600'),
                                     currency='AFN', created_by=admin)
        Hawala.objects.create(branch=a, date=today, from_party='الف', to_party='ب', amount=Decimal('1000'),
                              currency='AFN', fee=Decimal('50'), created_by=admin)
    AccessAttempt.objects.filter(username__in=USERS).delete()
    print(f'setup: users {list(USERS)} (password {PASSWORD}), branches {list(BRANCHES)}, traders {TRADERS}, '
          f'6 transactions, 1 office expense, 1 hawala')


def cleanup():
    with transaction.atomic():
        users = list(User.objects.filter(username__in=USERS))
        branch_ids = list(Branch.objects.filter(code__in=BRANCHES).values_list('id', flat=True))
        tx_ids = list(Transaction.history.filter(branch_id__in=branch_ids).values_list('id', flat=True).distinct())
        txns = Transaction.objects.filter(id__in=tx_ids).delete()[0]
        other = (OfficeExpense.objects.filter(branch_id__in=branch_ids).delete()[0]
                 + Hawala.objects.filter(branch_id__in=branch_ids).delete()[0])
        Trader.objects.filter(name__in=TRADERS).delete()
        history = (Transaction.history.filter(id__in=tx_ids).delete()[0]
                   + Trader.history.filter(name__in=TRADERS).delete()[0])
        rates = ExchangeRate.objects.filter(created_by__in=users).delete()[0]
        removed_users = User.objects.filter(username__in=USERS).delete()[0]
        branches = Branch.objects.filter(code__in=BRANCHES).delete()[0]
        attempts = AccessAttempt.objects.filter(username__in=USERS).delete()[0]
        history += purge_history(BRANCHES, list(USERS), None, branch_ids)
        for user in users:
            history += purge_history(rate_author=user.id)
    print(f'removed: transactions={txns}, office/hawala={other}, rates={rates}, users={removed_users}, '
          f'branch rows (incl. FieldConfig)={branches}, axes={attempts}, history={history}')


if __name__ == '__main__':
    setup() if '--setup' in sys.argv else cleanup()
