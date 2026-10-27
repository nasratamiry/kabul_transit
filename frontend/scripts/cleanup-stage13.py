"""
Test fixtures for scripts/verify-stage13.mjs.

    ..\\.venv\\Scripts\\python scripts\\cleanup-stage13.py --setup   # before the run
    ..\\.venv\\Scripts\\python scripts\\cleanup-stage13.py           # after the run

--setup (idempotent): super_admin e2e_admin, branches E2E13A / E2E13B with branch managers
e2e_mgr / e2e_mgr_b, rates entered by e2e_admin: USD 80 and PKR 0.25 ten days ago, USD 70
today. Without --setup everything is removed again: the hawala and office expenses of the
two branches, every rate a test user entered, and the history rows of all of it.
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
from finance.models import ExchangeRate, Hawala, OfficeExpense  # noqa: E402
from finance.utils import kabul_today  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_history import purge_history  # noqa: E402

PASSWORD = 'E2e-Stage13-Pass-2026'
BRANCHES = {'E2E13A': 'بندر آزمایشی ۱۳ الف', 'E2E13B': 'بندر آزمایشی ۱۳ ب'}
USERS = {'e2e_admin': None, 'e2e_mgr': 'E2E13A', 'e2e_mgr_b': 'E2E13B'}


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
    for date, currency, rate in [(today - timedelta(days=10), 'USD', '80'),
                                 (today - timedelta(days=10), 'PKR', '0.25'),
                                 (today, 'USD', '70')]:
        ExchangeRate.objects.update_or_create(date=date, currency=currency,
                                              defaults={'rate': Decimal(rate), 'created_by': admin})
    AccessAttempt.objects.filter(username__in=USERS).delete()
    print(f'setup: users {list(USERS)} (password {PASSWORD}), branches {list(BRANCHES)}, '
          f'USD 80 / PKR 0.25 ten days ago, USD 70 today')


def cleanup():
    with transaction.atomic():
        users = list(User.objects.filter(username__in=USERS))
        branch_ids = list(Branch.objects.filter(code__in=BRANCHES).values_list('id', flat=True))
        hawala = Hawala.objects.filter(branch_id__in=branch_ids).delete()[0]
        expenses = OfficeExpense.objects.filter(branch_id__in=branch_ids).delete()[0]
        rates = ExchangeRate.objects.filter(created_by__in=users).delete()[0]
        removed_users = User.objects.filter(username__in=USERS).delete()[0]
        branches = Branch.objects.filter(code__in=BRANCHES).delete()[0]
        attempts = AccessAttempt.objects.filter(username__in=USERS).delete()[0]
        # After the deletes (each writes one more «-» row); covers hawala / office-expense history too.
        history = purge_history(BRANCHES, list(USERS), None, branch_ids)
        for user in users:  # rates any test user entered (a manager enters today's rate in the run)
            history += purge_history(rate_author=user.id)
    print(f'removed: hawala={hawala}, office expenses={expenses}, rates={rates}, users={removed_users}, '
          f'branch rows (incl. FieldConfig)={branches}, axes={attempts}, history={history}')


if __name__ == '__main__':
    setup() if '--setup' in sys.argv else cleanup()
