"""
Sample data for the user-guide screenshots (scripts/capture-guide.mjs).

    ..\\.venv\\Scripts\\python scripts\\guide_demo.py --setup   # before capturing
    ..\\.venv\\Scripts\\python scripts\\guide_demo.py           # afterwards: removes all of it

--setup (idempotent): branches GDA «بندر نمونه» and GDB «بندر نمونهٔ دوم», super admin guide_admin,
branch manager guide_mgr (GDA), two traders, a transport company, USD rates for the last 40 days
except TODAY (the guide shows entering it), transactions this month and last month, a document,
hawala and office expenses. Everything is removed again without --setup, history included.
"""
import os
import sys
from datetime import timedelta
from decimal import Decimal
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'kabulcargo_backend.settings')
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

import django  # noqa: E402

django.setup()

from axes.models import AccessAttempt  # noqa: E402
from django.core.files.base import ContentFile  # noqa: E402
from django.db import transaction  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

from accounts.models import Branch, User  # noqa: E402
from finance.models import ExchangeRate, Hawala, OfficeExpense  # noqa: E402
from finance.utils import kabul_today  # noqa: E402
from operations.models import Document, Transaction  # noqa: E402
from partners.models import Trader, TransportCompany  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_history import purge_history  # noqa: E402

PASSWORD = 'Guide-Demo-Pass-2026'
BRANCHES = {'GDA': ('بندر نمونه', 'کابل'), 'GDB': ('بندر نمونهٔ دوم', 'هرات')}
USERS = {'guide_admin': None, 'guide_mgr': 'GDA', 'guide_mgr_b': 'GDB'}
TRADERS = ['شرکت تجارتی نمونه', 'تجارتخانهٔ نمونهٔ دوم']
COMPANY = 'شرکت ترانسپورتی نمونه'


def scan_image():
    """A plain 'scanned document' picture for the documents panel."""
    image = Image.new('RGB', (900, 640), '#f8fafc')
    draw = ImageDraw.Draw(image)
    draw.rectangle((40, 40, 860, 600), outline='#0C514C', width=6)
    draw.rectangle((80, 90, 500, 130), fill='#0C514C')
    for y in range(180, 560, 48):
        draw.rectangle((80, y, 820 if y % 96 else 640, y + 14), fill='#cbd5e1')
    buffer = BytesIO()
    image.save(buffer, 'PNG')
    return buffer.getvalue()


def setup():
    branches = {code: Branch.objects.get_or_create(code=code, defaults={'name': name, 'city': city})[0]
                for code, (name, city) in BRANCHES.items()}
    for username, code in USERS.items():
        defaults = ({'role': 'super_admin', 'first_name': 'مدیر', 'last_name': 'کل'} if code is None else
                    {'role': 'branch_manager', 'branch': branches[code], 'first_name': 'مدیر',
                     'last_name': BRANCHES[code][0]})
        user, _ = User.objects.get_or_create(username=username, defaults=defaults)
        user.set_password(PASSWORD)
        user.is_active = True
        user.save()
    admin = User.objects.get(username='guide_admin')
    manager = User.objects.get(username='guide_mgr')
    today = kabul_today()
    ExchangeRate.objects.filter(date=today, currency='USD', created_by__username__startswith='guide_').delete()
    for days in range(1, 41):
        ExchangeRate.objects.update_or_create(date=today - timedelta(days=days), currency='USD',
                                              defaults={'rate': Decimal('70.25'), 'created_by': admin})
    first, second = (Trader.objects.get_or_create(name=name, defaults={'phone': '0799000000'})[0]
                     for name in TRADERS)
    company, _ = TransportCompany.objects.get_or_create(name=COMPANY)
    a, b = branches['GDA'], branches['GDB']
    if not Transaction.objects.filter(branch__in=[a, b]).exists():
        rows = [  # branch, serial, days ago, type, currency, rate, trader, amounts
            (a, 'KC-1405-101', 1, 'EXPORT', 'AFN', 1, first,
             {'customer_payment': '185000', 'tariff_expense': '42000', 'khak_puli_cash': '9000'}),
            (a, 'KC-1405-102', 2, 'IMPORT', 'USD', '70.25', second,
             {'customer_payment': '2400', 'tariff_expense': '650', 'revenue_transport': '300'}),
            (a, 'KC-1405-103', 4, 'TRANSIT', 'AFN', 1, first,
             {'customer_payment': '96000', 'tariff_expense': '21000'}),
            (a, 'KC-1405-104', 6, 'TIR_CARNET', 'AFN', 1, second,
             {'customer_payment': '120000', 'tariff_expense': '38000', 'khak_puli_cash': '4000'}),
            (a, 'KC-1405-090', 35, 'EXPORT', 'AFN', 1, first,
             {'customer_payment': '150000', 'tariff_expense': '40000'}),
            (b, 'KC-1405-201', 3, 'EXPORT', 'AFN', 1, second,
             {'customer_payment': '88000', 'tariff_expense': '19000'}),
        ]
        for branch, serial, days, trade, currency, rate, trader, amounts in rows:
            Transaction.objects.create(
                branch=branch, trade_type=trade, serial_number=serial, date=today - timedelta(days=days),
                currency=currency, exchange_rate=Decimal(rate), trader=trader, transport_company=company,
                driver_name='محمد نبی', driver_phone='0700123456', plate_afghan='کابل ۴۵۸۲۱',
                goods_type='کشمش', weight=Decimal('24000'), created_by=manager,
                **{key: Decimal(value) for key, value in amounts.items()})
        tx = Transaction.objects.get(serial_number='KC-1405-101')
        document = Document(transaction=tx, title='بارنامه', uploaded_by=manager)
        document.file.save('بارنامه.png', ContentFile(scan_image()), save=True)
        for days, category, amount in ((1, 'RENT', '15000'), (2, 'SALARY', '30000'), (5, 'FUEL', '2500')):
            OfficeExpense.objects.create(branch=a, date=today - timedelta(days=days), category=category,
                                         amount=Decimal(amount), currency='AFN', created_by=manager)
        Hawala.objects.create(branch=a, date=today - timedelta(days=1), from_party='دفتر کابل',
                              to_party='بندر نمونه', amount=Decimal('250000'), currency='AFN',
                              fee=Decimal('1250'), created_by=manager)
    AccessAttempt.objects.filter(username__in=USERS).delete()
    print(f'setup: users {list(USERS)} (password {PASSWORD}), branches {list(BRANCHES)}')


def cleanup():
    with transaction.atomic():
        users = list(User.objects.filter(username__in=USERS))
        branch_ids = list(Branch.objects.filter(code__in=BRANCHES).values_list('id', flat=True))
        tx_ids = list(Transaction.history.filter(branch_id__in=branch_ids).values_list('id', flat=True).distinct())
        files = [doc.file.name for doc in Document.objects.filter(transaction_id__in=tx_ids)]
        removed = Transaction.objects.filter(id__in=tx_ids).delete()[0]
        removed += OfficeExpense.objects.filter(branch_id__in=branch_ids).delete()[0]
        removed += Hawala.objects.filter(branch_id__in=branch_ids).delete()[0]
        removed += Trader.objects.filter(name__in=TRADERS).delete()[0]
        removed += TransportCompany.objects.filter(name=COMPANY).delete()[0]
        removed += ExchangeRate.objects.filter(created_by__in=users).delete()[0]
        removed += User.objects.filter(username__in=USERS).delete()[0]
        removed += Branch.objects.filter(code__in=BRANCHES).delete()[0]
        AccessAttempt.objects.filter(username__in=USERS).delete()
        history = (Transaction.history.filter(id__in=tx_ids).delete()[0]
                   + Document.history.filter(transaction_id__in=tx_ids).delete()[0]
                   + Trader.history.filter(name__in=TRADERS).delete()[0]
                   + TransportCompany.history.filter(name=COMPANY).delete()[0]
                   + purge_history(BRANCHES, list(USERS), None, branch_ids))
        for user in users:
            history += purge_history(rate_author=user.id)
    from django.core.files.storage import default_storage
    for name in files:
        default_storage.delete(name)
    print(f'removed: {removed} rows, {history} history rows, {len(files)} files')


if __name__ == '__main__':
    setup() if '--setup' in sys.argv else cleanup()
