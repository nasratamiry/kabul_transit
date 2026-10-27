"""
Remove what scripts/verify-stage10.mjs created, so the live check can run again.

    ..\\.venv\\Scripts\\python scripts\\cleanup-stage10.py --setup          # e2e_admin with PASSWORD
    ..\\.venv\\Scripts\\python scripts\\cleanup-stage10.py [admin-username] [--drop-admin]

Deletes the test users (e2e_sa2, e2e_mgr2), the test branches (TESTKC, DELKC) with their
FieldConfig rows, every exchange rate the admin user entered, and the axes records of the
test users; puts OPEX_OFFICE / COGS_SEAL back to their seed defaults. With an admin
username it also removes that user's StatementLine history rows (the test's own edits);
--drop-admin then deletes that user too (the one --setup made).
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
from finance.management.commands.seed_statement_lines import STANDARD_LINES  # noqa: E402
from finance.models import ExchangeRate, StatementLine  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_history import purge_history  # noqa: E402

TEST_USERS = ['e2e_sa2', 'e2e_mgr2']
TEST_BRANCHES = ['TESTKC', 'DELKC']
RESTORE = {'OPEX_OFFICE', 'COGS_SEAL'}
PASSWORD = 'E2e-Stage10-Pass-2026'

if '--setup' in sys.argv:
    admin, _ = User.objects.get_or_create(username='e2e_admin', defaults={
        'role': 'super_admin', 'first_name': 'ادمین', 'last_name': 'آزمایشی'})
    admin.set_password(PASSWORD)
    admin.is_active = True
    admin.save()
    AccessAttempt.objects.filter(username__in=['e2e_admin', *TEST_USERS]).delete()
    print(f'setup: e2e_admin (password {PASSWORD})')
    sys.exit(0)

names = [arg for arg in sys.argv[1:] if not arg.startswith('--')]
admin = User.objects.filter(username=names[0]).first() if names else None

with transaction.atomic():
    for code, section, source, label_fa, label_en, sort_order in STANDARD_LINES:
        if code in RESTORE:
            StatementLine.objects.filter(code=code).update(
                section=section, source_field=source, label_fa=label_fa, label_en=label_en,
                sort_order=sort_order, is_active=True)
    history = 0
    if admin:
        history, _ = StatementLine.history.filter(history_user=admin).delete()
        rates, _ = ExchangeRate.objects.filter(created_by=admin).delete()
    else:
        rates = 0
    branch_ids = list(Branch.objects.filter(code__in=TEST_BRANCHES).values_list('id', flat=True))
    users, _ = User.objects.filter(username__in=TEST_USERS).delete()
    branches, _ = Branch.objects.filter(code__in=TEST_BRANCHES).delete()
    attempts, _ = AccessAttempt.objects.filter(username__in=TEST_USERS).delete()
    # Branches deleted during the run (DELKC) are gone already; their history matches by code.
    audit = purge_history(TEST_BRANCHES, TEST_USERS, admin.id if admin else None, branch_ids)
    if admin and '--drop-admin' in sys.argv:
        AccessAttempt.objects.filter(username=admin.username).delete()
        admin.delete()
        audit += purge_history(usernames=[admin.username])

print(f'removed: users={users}, branch rows (incl. FieldConfig)={branches}, rates={rates}, '
      f'axes={attempts}, statement-line history={history}, other history={audit}; '
      f'restored {sorted(RESTORE)}')
