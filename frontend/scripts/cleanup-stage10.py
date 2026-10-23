"""
Remove what scripts/verify-stage10.mjs created, so the live check can run again.

    ..\\.venv\\Scripts\\python scripts\\cleanup-stage10.py [admin-username]

Deletes the test users (e2e_sa2, e2e_mgr2), the test branches (TESTKC, DELKC) with their
FieldConfig rows, every exchange rate the admin user entered, and the axes records of the
test users; puts OPEX_OFFICE / COGS_SEAL back to their seed defaults. With an admin
username it also removes that user's StatementLine history rows (the test's own edits).
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

TEST_USERS = ['e2e_sa2', 'e2e_mgr2']
TEST_BRANCHES = ['TESTKC', 'DELKC']
RESTORE = {'OPEX_OFFICE', 'COGS_SEAL'}

admin = User.objects.filter(username=sys.argv[1]).first() if len(sys.argv) > 1 else None

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
    users, _ = User.objects.filter(username__in=TEST_USERS).delete()
    branches, _ = Branch.objects.filter(code__in=TEST_BRANCHES).delete()
    attempts, _ = AccessAttempt.objects.filter(username__in=TEST_USERS).delete()

print(f'removed: users={users}, branch rows (incl. FieldConfig)={branches}, rates={rates}, '
      f'axes={attempts}, statement-line history={history}; restored {sorted(RESTORE)}')
