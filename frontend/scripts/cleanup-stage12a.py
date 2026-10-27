"""
Test fixtures for scripts/verify-stage12a.mjs.

    ..\\.venv\\Scripts\\python scripts\\cleanup-stage12a.py --setup   # before the run
    ..\\.venv\\Scripts\\python scripts\\cleanup-stage12a.py           # after the run

--setup (idempotent): super_admin e2e_admin, branches E2E12A / E2E12B (codes of their own: stage 10 uses
TESTKC, and sharing a code made the two runs adopt each other's leftovers), branch manager
e2e_mgr (E2E12A), traders «تاجر آزمایشی الف/ب», transport company «شرکت آزمایشی ۱۲»,
today's USD rate = 70 (entered by e2e_admin), and truck_type HIDDEN for E2E12A + EXPORT
(the hidden-field check). Without --setup everything is removed again, including every
transaction of the two test branches and the history rows of all of it.
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
from finance.models import ExchangeRate  # noqa: E402
from finance.utils import kabul_today  # noqa: E402
from operations.models import Transaction  # noqa: E402
from partners.models import Trader, TransportCompany  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_history import purge_history  # noqa: E402

PASSWORD = 'E2e-Stage12-Pass-2026'
BRANCHES = {'E2E12A': 'بندر آزمایشی کابل', 'E2E12B': 'بندر آزمایشی تورخم'}
USERS = {'e2e_admin': None, 'e2e_mgr': 'E2E12A'}
TRADERS = ['تاجر آزمایشی الف', 'تاجر آزمایشی ب']
COMPANY = 'شرکت آزمایشی ۱۲'
TRADER_PREFIX = 'تاجر آزمایشی'
COMPANY_PREFIX = 'شرکت آزمایشی'


def setup():
    branches = {code: Branch.objects.get_or_create(code=code, defaults={'name': name})[0]
                for code, name in BRANCHES.items()}  # post_save seeds their 172 FieldConfig rows
    for username, code in USERS.items():
        defaults = ({'role': 'super_admin', 'first_name': 'ادمین', 'last_name': 'آزمایشی'} if code is None
                    else {'role': 'branch_manager', 'branch': branches[code], 'first_name': 'مدیر', 'last_name': code})
        user, _ = User.objects.get_or_create(username=username, defaults=defaults)
        user.set_password(PASSWORD)
        user.is_active = True
        user.save()
    for name in TRADERS:
        Trader.objects.get_or_create(name=name)
    TransportCompany.objects.get_or_create(name=COMPANY)
    admin = User.objects.get(username='e2e_admin')
    ExchangeRate.objects.update_or_create(date=kabul_today(), currency='USD',
                                          defaults={'rate': Decimal('70'), 'created_by': admin})
    FieldConfig.objects.filter(branch=branches['E2E12A'], trade_type='EXPORT',
                               field_name='truck_type').update(visibility='HIDDEN')
    AccessAttempt.objects.filter(username__in=USERS).delete()
    print(f'setup: users {list(USERS)} (password {PASSWORD}), branches {list(BRANCHES)}, '
          f'traders {TRADERS}, company {COMPANY}, USD rate today = 70, E2E12A/EXPORT truck_type hidden')


def cleanup():
    with transaction.atomic():
        admin = User.objects.filter(username='e2e_admin').first()
        branch_ids = list(Branch.objects.filter(code__in=BRANCHES).values_list('id', flat=True))
        txns = Transaction.objects.filter(branch_id__in=branch_ids).delete()[0]
        # After the delete: deleting writes one more «-» history row per transaction.
        tx_history = Transaction.history.filter(branch_id__in=branch_ids).delete()[0]
        traders = Trader.objects.filter(name__startswith=TRADER_PREFIX).delete()[0]
        companies = TransportCompany.objects.filter(name__startswith=COMPANY_PREFIX).delete()[0]
        history = (Trader.history.filter(name__startswith=TRADER_PREFIX).delete()[0]
                   + TransportCompany.history.filter(name__startswith=COMPANY_PREFIX).delete()[0])
        # Rates the run entered, and every USD rate deleted-and-re-entered for today by the test.
        rates = ExchangeRate.objects.filter(created_by=admin).delete()[0] if admin else 0
        users = User.objects.filter(username__in=USERS).delete()[0]
        branches = Branch.objects.filter(code__in=BRANCHES).delete()[0]
        attempts = AccessAttempt.objects.filter(username__in=USERS).delete()[0]
        audit = purge_history(BRANCHES, USERS, admin.id if admin else None, branch_ids)
    print(f'removed: transactions={txns} (+{tx_history} history), traders={traders}, companies={companies}, '
          f'partner history={history}, rates={rates}, users={users}, branch rows (incl. FieldConfig)={branches}, '
          f'axes={attempts}, other history={audit}')


if __name__ == '__main__':
    setup() if '--setup' in sys.argv else cleanup()
