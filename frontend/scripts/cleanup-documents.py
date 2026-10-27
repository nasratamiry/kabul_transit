"""
Test fixtures for scripts/verify-documents.mjs (customs documents).

    ..\\.venv\\Scripts\\python scripts\\cleanup-documents.py --setup   # before the run
    ..\\.venv\\Scripts\\python scripts\\cleanup-documents.py           # after the run

--setup (idempotent): super_admin e2e_doc_admin, branches E2EDOC / E2EDOC2 (each gets its
FieldConfig and document-requirement grid from the signals) with branch managers e2e_doc_mgr /
e2e_doc_mgr2, and today's USD rate 70 — only when nobody has entered one yet (a real user's rate
is never touched). On E2EDOC the TRANSIT form needs only serial + payment (plate, driver and
trader optional), so the run can create a transaction through the form quickly.

Without --setup everything the run made is removed: transactions of every E2EDOC* branch (also
E2EDOC3, made during the run) with their files on disk, document types whose code starts with
E2EDOC, the branches, users, the rate if the fixture made it, and the history rows of all of it.
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
from django.core.files.storage import default_storage  # noqa: E402
from django.db import transaction  # noqa: E402

from accounts.models import Branch, User  # noqa: E402
from config.models import DocumentRequirement, FieldConfig  # noqa: E402
from finance.models import ExchangeRate  # noqa: E402
from finance.utils import kabul_today  # noqa: E402
from operations.models import Document, DocumentType, Transaction  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_history import purge_history  # noqa: E402

PASSWORD = 'E2e-Docs-Pass-2026'
PREFIX = 'E2EDOC'
BRANCHES = {'E2EDOC': 'بندر آزمایشی اسناد', 'E2EDOC2': 'بندر آزمایشی اسناد دوم'}
USERS = {'e2e_doc_admin': None, 'e2e_doc_mgr': 'E2EDOC', 'e2e_doc_mgr2': 'E2EDOC2'}
OPTIONAL_ON_TRANSIT = ('plate_afghan', 'driver_name', 'trader')


def setup():
    branches = {code: Branch.objects.get_or_create(code=code, defaults={'name': name})[0]
                for code, name in BRANCHES.items()}
    for username, code in USERS.items():
        defaults = ({'role': 'super_admin', 'first_name': 'ادمین', 'last_name': 'اسناد'} if code is None
                    else {'role': 'branch_manager', 'branch': branches[code], 'first_name': 'مدیر',
                          'last_name': code})
        user, _ = User.objects.get_or_create(username=username, defaults=defaults)
        user.set_password(PASSWORD)
        user.is_active = True
        user.save()
    FieldConfig.objects.filter(branch=branches['E2EDOC'], trade_type='TRANSIT',
                               field_name__in=OPTIONAL_ON_TRANSIT).update(visibility='OPTIONAL')
    admin = User.objects.get(username='e2e_doc_admin')
    _, made = ExchangeRate.objects.get_or_create(date=kabul_today(), currency='USD',
                                                 defaults={'rate': Decimal('70'), 'created_by': admin})
    AccessAttempt.objects.filter(username__in=USERS).delete()
    print(f'setup: users {list(USERS)} (password {PASSWORD}), branches {list(BRANCHES)}, '
          f"today's USD rate {'70 (made by the fixture)' if made else 'already set — left as it is'}")


def cleanup():
    with transaction.atomic():
        users = list(User.objects.filter(username__in=USERS))
        branch_ids = list(Branch.history.filter(code__startswith=PREFIX).values_list('id', flat=True).distinct())
        codes = list(Branch.history.filter(code__startswith=PREFIX).values_list('code', flat=True).distinct())
        # Also transactions the run itself deleted: they only live on in their history rows.
        tx_ids = list(Transaction.history.filter(branch_id__in=branch_ids).values_list('id', flat=True).distinct())
        files = list(Document.objects.filter(transaction_id__in=tx_ids).values_list('file', flat=True))
        txns = Transaction.objects.filter(id__in=tx_ids).delete()[0]
        type_ids = list(DocumentType.history.filter(code__startswith=PREFIX).values_list('id', flat=True).distinct())
        types = DocumentType.objects.filter(id__in=type_ids).delete()[0]
        # Before the users: deleting a user sets created_by to NULL, and the rate would stay.
        rates = ExchangeRate.objects.filter(created_by__in=users).delete()[0]
        removed_users = User.objects.filter(username__in=USERS).delete()[0]
        branches = Branch.objects.filter(id__in=branch_ids).delete()[0]
        attempts = AccessAttempt.objects.filter(username__in=USERS).delete()[0]
        # After the deletes: deleting writes one more «-» history row per object.
        history = (Transaction.history.filter(id__in=tx_ids).delete()[0]
                   + Document.history.filter(transaction_id__in=tx_ids).delete()[0]
                   + DocumentType.history.filter(id__in=type_ids).delete()[0]
                   + DocumentRequirement.history.filter(doc_type_id__in=type_ids).delete()[0])
        history += purge_history(codes, list(USERS), None, branch_ids)
        for user in users:
            history += purge_history(rate_author=user.id)
    for name in files:
        default_storage.delete(name)
    print(f'removed: transactions={txns}, files={len(files)}, document types={types}, users={removed_users}, '
          f'branch rows (incl. FieldConfig + requirements)={branches}, rates={rates}, axes={attempts}, '
          f'history={history}')


if __name__ == '__main__':
    setup() if '--setup' in sys.argv else cleanup()
