"""
A record saved late at night or just after midnight in Kabul lands on Kabul's Shamsi day,
whatever clock the server runs on (Docker images default to UTC).

    .venv\\Scripts\\python scripts\\verify_kabul_day.py
    docker compose exec kabulcargo_backend python scripts/verify_kabul_day.py   (not in the image:
    the production image carries no test scripts; scripts/prod_local_test.ps1 pipes it in)

"Now" is frozen at 23:50 and 00:10 Kabul time (00:10 Kabul is still the previous day in UTC).
Everything runs in one transaction that is rolled back.
"""
import os
import sys
from datetime import datetime, timezone as dt_timezone
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent if '__file__' in globals() else Path('/app')
sys.path.insert(0, str(ROOT))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'kabulcargo_backend.settings')
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

import django  # noqa: E402

django.setup()

import jdatetime  # noqa: E402
from django.db import connection, transaction  # noqa: E402

from accounts.models import Branch  # noqa: E402
from finance.utils import kabul_today  # noqa: E402
from operations.models import Transaction  # noqa: E402

failures = []
number = 0


def check(label, ok, detail=''):
    global number
    number += 1
    print(f"  [{'OK' if ok else 'FAIL'}] {number:02d}. {label}{(' — ' + detail) if detail else ''}")
    if not ok:
        failures.append(label)


class Rollback(Exception):
    pass


# (moment in UTC, the Kabul calendar day it is, label)
MOMENTS = [
    (datetime(2026, 3, 20, 19, 20, tzinfo=dt_timezone.utc), (2026, 3, 20), '23:50 کابل (۱۹:۲۰ UTC)'),
    (datetime(2026, 3, 20, 19, 40, tzinfo=dt_timezone.utc), (2026, 3, 21), '00:10 کابل = روز بعد (UTC هنوز روز قبل)'),
]

try:
    with transaction.atomic():
        branch = Branch.objects.create(name='بندر آزمایشی روز', code='ZZDAY')
        for i, (moment, kabul_day, label) in enumerate(MOMENTS):
            expected = jdatetime.date.fromgregorian(year=kabul_day[0], month=kabul_day[1], day=kabul_day[2])
            with mock.patch('django.utils.timezone.now', return_value=moment):
                txn = Transaction.objects.create(branch=branch, trade_type='EXPORT', serial_number=f'ZZ-DAY-{i}')
                today = kabul_today()
            txn.refresh_from_db()
            check(f'معامله در {label} → روز شمسی کابل {expected}',
                  txn.date == expected and today == expected, f'saved={txn.date!r}, kabul_today={today!r}')
        raise Rollback
except Rollback:
    pass

with connection.cursor() as cursor:
    cursor.execute("SELECT CONVERT_TZ('2026-01-01 00:00', 'UTC', 'Asia/Kabul')")
    converted = cursor.fetchone()[0]
check('MySQL جدول‌های منطقهٔ زمانی را دارد (CONVERT_TZ برای فیلترهای تاریخ پنل)',
      str(converted).startswith('2026-01-01 04:30'), f'CONVERT_TZ={converted}')
check('هیچ دادهٔ آزمایشی نماند', not Branch.objects.filter(code='ZZDAY').exists())

print()
if failures:
    print('ناکام:', ', '.join(failures))
    sys.exit(1)
print(f'همهٔ {number} تست موفق بود.')
