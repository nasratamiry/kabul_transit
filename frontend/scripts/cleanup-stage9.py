"""
Test fixtures for scripts/verify-e2e.mjs (stage 9: login, layout, languages, lockout).

    ..\\.venv\\Scripts\\python scripts\\cleanup-stage9.py --setup   # before the run
    ..\\.venv\\Scripts\\python scripts\\cleanup-stage9.py           # after the run

--setup (idempotent): super_admin e2e_admin and branch manager e2e_manager of branch E2E09,
both with the password in PASSWORD. Without --setup everything is removed again, history rows
included, and so are the axes records of the two users: the run's last check locks e2e_admin
and this IP (the lock lives in that same record, so deleting it lifts both).
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

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_history import purge_history  # noqa: E402

PASSWORD = 'E2e-Stage09-Pass-2026'
BRANCH = ('E2E09', 'بندر آزمایشی ۹')
USERS = ['e2e_admin', 'e2e_manager']


def setup():
    branch, _ = Branch.objects.get_or_create(code=BRANCH[0], defaults={'name': BRANCH[1]})
    for username, role in (('e2e_admin', 'super_admin'), ('e2e_manager', 'branch_manager')):
        user, _ = User.objects.get_or_create(username=username, defaults={
            'role': role, 'branch': branch if role == 'branch_manager' else None,
            'first_name': 'کاربر', 'last_name': 'آزمایشی'})
        user.set_password(PASSWORD)
        user.is_active = True
        user.save()
    AccessAttempt.objects.filter(username__in=USERS).delete()
    print(f'setup: users {USERS} (password {PASSWORD}), branch {BRANCH[0]}')


def cleanup():
    with transaction.atomic():
        admin = User.objects.filter(username='e2e_admin').first()
        branch_ids = list(Branch.objects.filter(code=BRANCH[0]).values_list('id', flat=True))
        users = User.objects.filter(username__in=USERS).delete()[0]
        branches = Branch.objects.filter(code=BRANCH[0]).delete()[0]
        attempts = AccessAttempt.objects.filter(username__in=USERS).delete()[0]
        audit = purge_history([BRANCH[0]], USERS, admin.id if admin else None, branch_ids)
    print(f'removed: users={users}, branch rows (incl. FieldConfig)={branches}, axes={attempts}, '
          f'history={audit}')


if __name__ == '__main__':
    setup() if '--setup' in sys.argv else cleanup()
