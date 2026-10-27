"""
Test fixtures for scripts/verify-field-settings.mjs (the super admin's field settings page).

    ..\\.venv\\Scripts\\python scripts\\cleanup-field-settings.py --setup   # before the run
    ..\\.venv\\Scripts\\python scripts\\cleanup-field-settings.py           # after the run

--setup (idempotent): super_admin e2e_fc_admin, branches E2EFC / E2EFC2 (each gets its 172
FieldConfig rows from the signal) with branch managers e2e_fc_mgr / e2e_fc_mgr2, and three
IMPORT transactions on E2EFC with goods_type filled in (the «hidden field still has data»
warning counts them). The run also uses «copy to all branches», which writes into every real
branch too, so --setup first saves the settings of every non-test branch to a snapshot file.

Without --setup the snapshot is written back (rows untouched by the run are left as they are),
every history row an E2E user wrote is removed, then the transactions of every E2EFC* branch
(also E2EFC3, made during the run), the branches, users and their history — the database is
back at its baseline.
"""
import json
import os
import sys
import tempfile
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
from operations.models import Transaction  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_history import purge_history  # noqa: E402

PASSWORD = 'E2e-Fields-Pass-2026'
PREFIX = 'E2EFC'
BRANCHES = {'E2EFC': 'بندر آزمایشی فیلدها', 'E2EFC2': 'بندر آزمایشی فیلدها دوم'}
USERS = {'e2e_fc_admin': None, 'e2e_fc_mgr': 'E2EFC', 'e2e_fc_mgr2': 'E2EFC2'}
GOODS = ('آرد-E2EFC', 'برنج-E2EFC', 'روغن-E2EFC')
SNAPSHOT = Path(tempfile.gettempdir()) / 'kc-e2e-field-settings-snapshot.json'


def setup():
    if not SNAPSHOT.exists():  # a second --setup must not overwrite the real baseline
        rows = FieldConfig.objects.exclude(branch__code__startswith=PREFIX).values_list(
            'id', 'visibility', 'sort_order')
        SNAPSHOT.write_text(json.dumps({str(pk): [vis, order] for pk, vis, order in rows}), encoding='utf-8')
    branches = {code: Branch.objects.get_or_create(code=code, defaults={'name': name})[0]
                for code, name in BRANCHES.items()}
    for username, code in USERS.items():
        defaults = ({'role': 'super_admin', 'first_name': 'ادمین', 'last_name': 'فیلدها'} if code is None
                    else {'role': 'branch_manager', 'branch': branches[code], 'first_name': 'مدیر',
                          'last_name': code})
        user, _ = User.objects.get_or_create(username=username, defaults=defaults)
        user.set_password(PASSWORD)
        user.is_active = True
        user.save()
    for i, goods in enumerate(GOODS, start=1):
        Transaction.objects.get_or_create(
            branch=branches['E2EFC'], trade_type='IMPORT', serial_number=f'E2EFC-{i}',
            defaults={'goods_type': goods, 'customer_payment': 1000})
    AccessAttempt.objects.filter(username__in=USERS).delete()
    print(f'setup: users {list(USERS)} (password {PASSWORD}), branches {list(BRANCHES)}, '
          f'{len(GOODS)} IMPORT transactions on E2EFC, snapshot {SNAPSHOT}')


def cleanup():
    with transaction.atomic():
        restored = 0
        if SNAPSHOT.exists():
            saved = json.loads(SNAPSHOT.read_text(encoding='utf-8'))
            for row in FieldConfig.objects.filter(pk__in=[int(pk) for pk in saved]):
                visibility, sort_order = saved[str(row.pk)]
                if (row.visibility, row.sort_order) != (visibility, sort_order):
                    # update(), not save(): restoring must not write history of its own.
                    FieldConfig.objects.filter(pk=row.pk).update(visibility=visibility, sort_order=sort_order)
                    restored += 1
        users = list(User.objects.filter(username__in=USERS))
        # Every settings change the run made, real branches included (before the users: deleting
        # a user would set history_user to NULL and hide which rows were the run's).
        history = FieldConfig.history.filter(history_user__in=users).delete()[0]
        branch_ids = list(Branch.history.filter(code__startswith=PREFIX).values_list('id', flat=True).distinct())
        codes = list(Branch.history.filter(code__startswith=PREFIX).values_list('code', flat=True).distinct())
        tx_ids = list(Transaction.history.filter(branch_id__in=branch_ids).values_list('id', flat=True).distinct())
        txns = Transaction.objects.filter(id__in=tx_ids).delete()[0]
        removed_users = User.objects.filter(username__in=USERS).delete()[0]
        branches = Branch.objects.filter(id__in=branch_ids).delete()[0]
        attempts = AccessAttempt.objects.filter(username__in=USERS).delete()[0]
        history += Transaction.history.filter(id__in=tx_ids).delete()[0]
        history += purge_history(codes, list(USERS), None, branch_ids)
    SNAPSHOT.unlink(missing_ok=True)
    print(f'removed: transactions={txns}, users={removed_users}, branch rows (incl. FieldConfig)={branches}, '
          f'axes={attempts}, history={history}; real branch settings restored={restored}')


if __name__ == '__main__':
    setup() if '--setup' in sys.argv else cleanup()
