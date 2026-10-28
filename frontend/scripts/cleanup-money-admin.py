"""
Test fixtures for scripts/verify-money-admin.mjs (the «عواید و مصارف» page and office income).

    ..\\.venv\\Scripts\\python scripts\\cleanup-money-admin.py --setup   # before the run
    ..\\.venv\\Scripts\\python scripts\\cleanup-money-admin.py           # after the run

--setup (idempotent): super_admin e2e_money_admin, branches E2EMONEY («شیرخان» of the test) and
E2EMONEY2 with branch managers e2e_money_mgr / e2e_money_mgr2, the trader of the test, trader made
optional on E2EMONEY's forms (fixture rows only), and today's USD rate when none exists yet.

The run adds two revenue / expense types (codes E2EMONEY_*): that touches every branch — one form
row each, and one income-statement line. Without --setup everything is removed again: the run's
types (with their form rows and statement lines), the transactions and money lines, office
incomes, the branches, users, trader, the rate a test user entered, and the history rows of all
of it — the database is back at its baseline.
"""
import os
import sys
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
from config.models import FieldConfig  # noqa: E402
from finance.models import ExchangeRate, OfficeIncome, StatementLine  # noqa: E402
from finance.utils import kabul_today  # noqa: E402
from operations.models import MoneyFieldType, Transaction, TransactionMoneyLine  # noqa: E402
from partners.models import Trader  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_history import purge_history  # noqa: E402

PASSWORD = 'E2e-Money-Pass-2026'
PREFIX = 'E2EMONEY'
BRANCHES = {'E2EMONEY': 'بندر آزمایشی شیرخان (E2EMONEY)', 'E2EMONEY2': 'بندر آزمایشی دوم (E2EMONEY2)'}
USERS = {'e2e_money_admin': None, 'e2e_money_mgr': 'E2EMONEY', 'e2e_money_mgr2': 'E2EMONEY2'}
TRADER = 'تاجر آزمایشی E2EMONEY'


def setup():
    branches = {code: Branch.objects.get_or_create(code=code, defaults={'name': name})[0]
                for code, name in BRANCHES.items()}
    users = {}
    for username, code in USERS.items():
        defaults = ({'role': 'super_admin', 'first_name': 'ادمین', 'last_name': 'پول'} if code is None
                    else {'role': 'branch_manager', 'branch': branches[code], 'first_name': 'مدیر',
                          'last_name': code})
        user, _ = User.objects.get_or_create(username=username, defaults=defaults)
        user.set_password(PASSWORD)
        user.is_active = True
        user.save()
        users[username] = user
    Trader.objects.get_or_create(name=TRADER)
    # The test fills the form by hand; the trader picker is not what it is about.
    FieldConfig.objects.filter(branch=branches['E2EMONEY'], field_name='trader').update(visibility='OPTIONAL')
    ExchangeRate.objects.get_or_create(date=kabul_today(), currency='USD',
                                       defaults={'rate': Decimal('70'), 'created_by': users['e2e_money_admin']})
    AccessAttempt.objects.filter(username__in=USERS).delete()
    print(f'setup: users {list(USERS)} (password {PASSWORD}), branches {list(BRANCHES)}, trader {TRADER}')


def cleanup():
    with transaction.atomic():
        users = list(User.objects.filter(username__in=USERS))
        branch_ids = list(Branch.history.filter(code__startswith=PREFIX).values_list('id', flat=True).distinct())
        codes = list(Branch.history.filter(code__startswith=PREFIX).values_list('code', flat=True).distinct())
        tx_ids = list(Transaction.history.filter(branch_id__in=branch_ids).values_list('id', flat=True).distinct())
        type_ids = list(MoneyFieldType.history.filter(code__startswith=PREFIX).values_list('id', flat=True).distinct())
        sources = [f'@money:{code}' for code in
                   MoneyFieldType.history.filter(code__startswith=PREFIX).values_list('code', flat=True).distinct()]
        line_ids = list(StatementLine.history.filter(source_field__in=sources).values_list('id', flat=True).distinct())

        txns = Transaction.objects.filter(id__in=tx_ids).delete()[0]  # money lines go with them
        incomes = OfficeIncome.objects.filter(branch_id__in=branch_ids).delete()[0]
        types = 0
        for money_type in MoneyFieldType.objects.filter(id__in=type_ids):
            money_type.delete()  # its form rows (cascade) and statement line (signal) too
            types += 1
        rates = ExchangeRate.objects.filter(created_by__in=users).delete()[0]
        traders = Trader.objects.filter(name=TRADER)
        trader_ids = list(traders.values_list('id', flat=True))
        traders.delete()
        removed_users = User.objects.filter(username__in=USERS).delete()[0]
        branches = Branch.objects.filter(id__in=branch_ids).delete()[0]
        attempts = AccessAttempt.objects.filter(username__in=USERS).delete()[0]

        history = TransactionMoneyLine.history.filter(transaction_id__in=tx_ids).delete()[0]
        history += Transaction.history.filter(id__in=tx_ids).delete()[0]
        history += MoneyFieldType.history.filter(id__in=type_ids).delete()[0]
        history += FieldConfig.history.filter(money_type_id__in=type_ids).delete()[0]
        history += StatementLine.history.filter(id__in=line_ids).delete()[0]
        history += Trader.history.filter(id__in=trader_ids).delete()[0]
        for user in users:
            history += purge_history(rate_author=user.id)
        history += purge_history(codes, list(USERS), None, branch_ids)
    print(f'removed: transactions={txns}, office incomes={incomes}, types={types}, rates={rates}, '
          f'users={removed_users}, branch rows (incl. FieldConfig)={branches}, axes={attempts}, history={history}')


if __name__ == '__main__':
    setup() if '--setup' in sys.argv else cleanup()
