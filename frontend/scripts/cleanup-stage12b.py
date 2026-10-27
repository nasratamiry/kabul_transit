"""
Test fixtures for scripts/verify-stage12b.mjs.

    ..\\.venv\\Scripts\\python scripts\\cleanup-stage12b.py --setup   # before the run
    ..\\.venv\\Scripts\\python scripts\\cleanup-stage12b.py           # after the run

--setup (idempotent): super_admin e2e_admin, branches E2E12BA / E2E12BB with branch managers
e2e_mgr / e2e_mgr_b, trader «تاجر آزمایشی ۱۲ب», USD rates 60 (ten days ago) and 70 (today),
both entered by e2e_admin. Without --setup everything is removed again: transactions of the
two branches, their uploaded files on disk, every rate a test user entered, and the history
rows of all of it.
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
from django.core.files.storage import default_storage  # noqa: E402
from django.db import transaction  # noqa: E402

from accounts.models import Branch, User  # noqa: E402
from finance.models import ExchangeRate  # noqa: E402
from finance.utils import kabul_today  # noqa: E402
from operations.models import Document, Transaction  # noqa: E402
from partners.models import Trader  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_history import purge_history  # noqa: E402

PASSWORD = 'E2e-Stage12b-Pass-2026'
BRANCHES = {'E2E12BA': 'بندر آزمایشی ۱۲ب الف', 'E2E12BB': 'بندر آزمایشی ۱۲ب ب'}
USERS = {'e2e_admin': None, 'e2e_mgr': 'E2E12BA', 'e2e_mgr_b': 'E2E12BB'}
TRADER = 'تاجر آزمایشی ۱۲ب'


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
    Trader.objects.get_or_create(name=TRADER)
    admin = User.objects.get(username='e2e_admin')
    today = kabul_today()
    ExchangeRate.objects.update_or_create(date=today - timedelta(days=10), currency='USD',
                                          defaults={'rate': Decimal('60'), 'created_by': admin})
    ExchangeRate.objects.update_or_create(date=today, currency='USD',
                                          defaults={'rate': Decimal('70'), 'created_by': admin})
    AccessAttempt.objects.filter(username__in=USERS).delete()
    print(f'setup: users {list(USERS)} (password {PASSWORD}), branches {list(BRANCHES)}, '
          f'trader {TRADER}, USD 60 ten days ago and 70 today')


def cleanup():
    with transaction.atomic():
        users = list(User.objects.filter(username__in=USERS))
        branch_ids = list(Branch.objects.filter(code__in=BRANCHES).values_list('id', flat=True))
        # Also transactions the run itself deleted: they only live on in their history rows.
        tx_ids = list(Transaction.history.filter(branch_id__in=branch_ids).values_list('id', flat=True).distinct())
        # Files are on disk: deleting the rows (cascade) would leave them behind.
        files = list(Document.objects.filter(transaction_id__in=tx_ids).values_list('file', flat=True))
        txns = Transaction.objects.filter(id__in=tx_ids).delete()[0]
        Trader.objects.filter(name=TRADER).delete()
        # After the deletes: deleting writes one more «-» history row per object.
        history = (Transaction.history.filter(id__in=tx_ids).delete()[0]
                   + Document.history.filter(transaction_id__in=tx_ids).delete()[0]
                   + Trader.history.filter(name=TRADER).delete()[0])
        rates = ExchangeRate.objects.filter(created_by__in=users).delete()[0]
        removed_users = User.objects.filter(username__in=USERS).delete()[0]
        branches = Branch.objects.filter(code__in=BRANCHES).delete()[0]
        attempts = AccessAttempt.objects.filter(username__in=USERS).delete()[0]
        history += purge_history(BRANCHES, list(USERS), None, branch_ids)
        for user in users:  # rates any test user entered (managers enter today's rate in the run)
            history += purge_history(rate_author=user.id)
    for name in files:
        default_storage.delete(name)
    print(f'removed: transactions={txns}, files={len(files)}, rates={rates}, users={removed_users}, '
          f'branch rows (incl. FieldConfig)={branches}, axes={attempts}, history={history}')


if __name__ == '__main__':
    setup() if '--setup' in sys.argv else cleanup()
