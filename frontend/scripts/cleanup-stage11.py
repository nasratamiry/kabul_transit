"""
Test fixtures for scripts/verify-stage11.mjs.

    ..\\.venv\\Scripts\\python scripts\\cleanup-stage11.py --setup   # before the run
    ..\\.venv\\Scripts\\python scripts\\cleanup-stage11.py           # after the run

--setup (idempotent) creates or resets: super_admin e2e_admin, branches E2E11A / E2E11B and
branch managers e2e_mgr (E2E11A) / e2e_mgr_b (E2E11B), all with the password in PASSWORD.
Without --setup it removes all of that again, plus the traders / transport companies the
run created (names starting with «تاجر آزمایشی» / «شرکت آزمایشی»), the test transaction,
the rates e2e_admin entered, their history rows and the test users' axes records.
"""
import os
import sys
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
from finance.models import ExchangeRate  # noqa: E402
from operations.models import Transaction  # noqa: E402
from partners.models import Trader, TransportCompany  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_history import purge_history  # noqa: E402

PASSWORD = 'E2e-Stage11-Pass-2026'
BRANCHES = {'E2E11A': 'بندر آزمایشی ۱۱ الف', 'E2E11B': 'بندر آزمایشی ۱۱ ب'}
MANAGERS = {'e2e_mgr': 'E2E11A', 'e2e_mgr_b': 'E2E11B'}
USERS = ['e2e_admin', *MANAGERS]
TRADER_PREFIX = 'تاجر آزمایشی'
COMPANY_PREFIX = 'شرکت آزمایشی'


def setup():
    branches = {code: Branch.objects.get_or_create(code=code, defaults={'name': name})[0]
                for code, name in BRANCHES.items()}
    admin, _ = User.objects.get_or_create(username='e2e_admin', defaults={
        'role': 'super_admin', 'first_name': 'ادمین', 'last_name': 'آزمایشی'})
    admin.set_password(PASSWORD)
    admin.is_active = True
    admin.save()
    for username, code in MANAGERS.items():
        user, _ = User.objects.get_or_create(username=username, defaults={
            'role': 'branch_manager', 'branch': branches[code], 'first_name': 'مدیر', 'last_name': code})
        user.set_password(PASSWORD)
        user.is_active = True
        user.save()
    AccessAttempt.objects.filter(username__in=USERS).delete()
    print(f'setup: users {USERS} (password {PASSWORD}), branches {list(BRANCHES)}')


def cleanup():
    with transaction.atomic():
        admin = User.objects.filter(username='e2e_admin').first()
        branch_ids = list(Branch.objects.filter(code__in=BRANCHES).values_list('id', flat=True))
        txn_count = Transaction.objects.filter(branch_id__in=branch_ids).delete()[0]
        # After the delete: deleting writes one more «-» history row per transaction.
        txn_history = Transaction.history.filter(branch_id__in=branch_ids).delete()[0]
        traders = Trader.objects.filter(name__startswith=TRADER_PREFIX).delete()[0]
        companies = TransportCompany.objects.filter(name__startswith=COMPANY_PREFIX).delete()[0]
        history = (Trader.history.filter(name__startswith=TRADER_PREFIX).delete()[0]
                   + TransportCompany.history.filter(name__startswith=COMPANY_PREFIX).delete()[0])
        rates = ExchangeRate.objects.filter(created_by=admin).delete()[0] if admin else 0
        users = User.objects.filter(username__in=USERS).delete()[0]
        branches = Branch.objects.filter(code__in=BRANCHES).delete()[0]
        attempts = AccessAttempt.objects.filter(username__in=USERS).delete()[0]
        audit = purge_history(BRANCHES, USERS, admin.id if admin else None, branch_ids)
    print(f'removed: transactions={txn_count} (+{txn_history} history), traders={traders}, '
          f'companies={companies}, partner history={history}, rates={rates}, users={users}, '
          f'branch rows (incl. FieldConfig)={branches}, axes={attempts}, other history={audit}')


if __name__ == '__main__':
    setup() if '--setup' in sys.argv else cleanup()
