"""
Verify the REST API (JWT, role access, port scoping, daily-rate soft lock, FormConfig, Dari digits).

    .venv\\Scripts\\python scripts\\verify_api.py

Runs against the configured database inside one DB transaction that is rolled
back at the end, so no test data is left behind. Test branches use the codes
ZZKBL / ZZTKH so they never clash with real branches.
"""
import os
import sys
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'kabulcargo_backend.settings')
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

import django  # noqa: E402

django.setup()

from axes.models import AccessAttempt  # noqa: E402
from django.core.files.uploadedfile import SimpleUploadedFile  # noqa: E402
from django.db import transaction  # noqa: E402
from rest_framework.test import APIClient  # noqa: E402
from rest_framework_simplejwt.tokens import AccessToken  # noqa: E402

from accounts.models import Branch, User  # noqa: E402
from config.models import FieldConfig  # noqa: E402
from finance.models import ExchangeRate, Hawala, OfficeExpense  # noqa: E402
from finance.utils import kabul_today  # noqa: E402
from operations.models import Document, Transaction  # noqa: E402
from partners.models import Trader  # noqa: E402

PASSWORD = 'Kabul-Verify-2026!'
failures = []
number = 0


def check(label, ok, detail=''):
    global number
    number += 1
    print(f"  [{'OK' if ok else 'FAIL'}] {number:02d}. {label}{(' — ' + detail) if detail else ''}")
    if not ok:
        failures.append(f'{number:02d}. {label}')


def to_dari(text):
    return str(text).translate(str.maketrans('0123456789', '۰۱۲۳۴۵۶۷۸۹'))


def login(username, password=PASSWORD):
    client = APIClient(HTTP_HOST='127.0.0.1')
    response = client.post('/api/auth/login/', {'username': username, 'password': password}, format='json')
    if response.status_code == 200:
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")
    return client, response


def results(response):
    data = response.data
    return data['results'] if isinstance(data, dict) and 'results' in data else data


def counts():
    return (Branch.objects.count(), User.objects.count(), Trader.objects.count(), Transaction.objects.count(),
            Document.objects.count(), ExchangeRate.objects.count(), Hawala.objects.count(),
            OfficeExpense.objects.count(), FieldConfig.objects.count(), AccessAttempt.objects.count())


class Rollback(Exception):
    pass


before = counts()
today = kabul_today()
tomorrow = today + timedelta(days=1)

try:
    with transaction.atomic():
        ExchangeRate.objects.filter(date=today).delete()  # start with no rate today (rolled back)
        branch_a = Branch.objects.create(name='بندر آزمایشی API کابل', code='ZZKBL')
        branch_b = Branch.objects.create(name='بندر آزمایشی API تورخم', code='ZZTKH')
        admin = User.objects.create_superuser('zz_api_admin', None, PASSWORD)
        manager_a = User.objects.create_user('zz_api_mgr_a', None, PASSWORD, role='branch_manager', branch=branch_a)
        manager_b = User.objects.create_user('zz_api_mgr_b', None, PASSWORD, role='branch_manager', branch=branch_b)
        trader = Trader.objects.create(name='تاجر آزمایشی API')
        tx_a = Transaction.objects.create(branch=branch_a, trade_type='EXPORT', serial_number='ZZ-A-1',
                                          trader=trader, plate_afghan='ZZ-111')
        tx_b = Transaction.objects.create(branch=branch_b, trade_type='EXPORT', serial_number='ZZ-B-1',
                                          trader=trader)
        hawala_b = Hawala.objects.create(branch=branch_b, from_party='الف', to_party='ب', amount=100, currency='AFN')

        print('الف) ورود و توکن (Auth)')
        admin_client, response = login(admin.username)
        check('سوپر ادمین وارد می‌شود و access + refresh + user می‌گیرد',
              response.status_code == 200 and {'access', 'refresh', 'user'} <= set(response.data)
              and response.data['user']['role'] == 'super_admin', f'status={response.status_code}')
        admin_refresh = response.data.get('refresh')

        _, response = login(admin.username, 'wrong-password')
        check('رمز اشتباه رد می‌شود (401)', response.status_code == 401, f'status={response.status_code}')

        client_a, response = login(manager_a.username)
        claims = AccessToken(response.data['access'])
        check('توکن نقش و بندر را دارد', claims['role'] == 'branch_manager' and claims['branch_id'] == branch_a.id,
              f"role={claims['role']}, branch_id={claims['branch_id']}")

        response = client_a.get('/api/auth/me/')
        check('/api/auth/me/ کاربر و بندرش را برمی‌گرداند',
              response.status_code == 200 and response.data['username'] == manager_a.username
              and response.data['branch']['id'] == branch_a.id, f'status={response.status_code}')

        response = APIClient(HTTP_HOST='127.0.0.1').get('/api/transactions/')
        check('بدون توکن دسترسی نیست (401)', response.status_code == 401, f'status={response.status_code}')

        anon = APIClient(HTTP_HOST='127.0.0.1')
        refreshed = anon.post('/api/auth/refresh/', {'refresh': admin_refresh}, format='json')
        logout = admin_client.post('/api/auth/logout/', {'refresh': admin_refresh}, format='json')
        after_logout = anon.post('/api/auth/refresh/', {'refresh': admin_refresh}, format='json')
        check('refresh کار می‌کند؛ بعد از خروج همان refresh باطل است',
              refreshed.status_code == 200 and 'access' in refreshed.data and logout.status_code == 200
              and after_logout.status_code == 401,
              f'refresh={refreshed.status_code}, logout={logout.status_code}, after={after_logout.status_code}')
        admin_client, _ = login(admin.username)  # fresh session for the rest
        client_b, _ = login(manager_b.username)

        print('ب) دسترسی نقش‌ها (Role access)')
        response = client_a.get('/api/users/')
        check('مدیر بندر در فهرست کاربران فقط خودش را می‌بیند',
              response.status_code == 200 and [u['id'] for u in results(response)] == [manager_a.id],
              f'status={response.status_code}')

        response = client_a.post('/api/users/', {'username': 'zz_api_hack', 'password': PASSWORD,
                                                 'role': 'super_admin'}, format='json')
        check('مدیر بندر نمی‌تواند کاربر بسازد (403)', response.status_code == 403, f'status={response.status_code}')

        response = admin_client.post('/api/users/', {'username': 'zz_api_new', 'password': PASSWORD,
                                                     'role': 'branch_manager', 'branch': branch_a.id,
                                                     'phone': '۰۷۹۹۱۲۳۴۵۶'}, format='json')
        new_user = User.objects.filter(username='zz_api_new').first()
        check('سوپر ادمین کاربر می‌سازد؛ رمز hash و تلفن انگلیسی می‌شود',
              response.status_code == 201 and new_user is not None and new_user.check_password(PASSWORD)
              and new_user.phone == '0799123456' and 'password' not in response.data,
              f'status={response.status_code}, data={response.data if response.status_code != 201 else ""}')

        denied = client_a.post('/api/branches/', {'name': 'بندر هک', 'code': 'ZZHAK'}, format='json')
        created = admin_client.post('/api/branches/', {'name': 'بندر آزمایشی API هرات', 'code': 'zzhir'},
                                    format='json')
        check('بندر: مدیر 403، سوپر ادمین 201 (کود بزرگ می‌شود)',
              denied.status_code == 403 and created.status_code == 201 and created.data['code'] == 'ZZHIR',
              f'manager={denied.status_code}, admin={created.status_code}')

        field_config = FieldConfig.objects.filter(branch=branch_a, trade_type='EXPORT').first()
        denied = client_a.patch(f'/api/field-configs/{field_config.id}/', {'sort_order': 1}, format='json')
        allowed = admin_client.patch(f'/api/field-configs/{field_config.id}/', {'sort_order': 1}, format='json')
        check('تنظیم فیلد: مدیر 403، سوپر ادمین 200',
              denied.status_code == 403 and allowed.status_code == 200,
              f'manager={denied.status_code}, admin={allowed.status_code}')

        print('ج) محدودیت بندر (Port scoping)')
        response = client_a.get('/api/transactions/')
        branches_seen = {row['branch'] for row in results(response)}
        check('مدیر A فقط معاملات بندر A را می‌بیند', response.status_code == 200 and branches_seen == {branch_a.id},
              f'branches={branches_seen}')

        response = client_a.get(f'/api/transactions/{tx_b.id}/')
        check('مدیر A معاملهٔ بندر B را باز کرده نمی‌تواند (404)', response.status_code == 404,
              f'status={response.status_code}')

        denied = client_a.patch(f'/api/hawala/{hawala_b.id}/', {'note': 'hack'}, format='json')
        admin_list = admin_client.get('/api/transactions/', {'branch': branch_b.id})
        check('مدیر A حوالهٔ B را تغییر داده نمی‌تواند؛ سوپر ادمین همه را می‌بیند',
              denied.status_code == 404 and admin_list.status_code == 200
              and [row['id'] for row in results(admin_list)] == [tx_b.id],
              f'manager={denied.status_code}, admin={admin_list.status_code}')

        # Soft lock needs today's rate for the spoofing test; add it, then remove for group (د).
        rate = ExchangeRate.objects.create(date=today, currency='USD', rate=Decimal('70.5'))
        response = client_a.post('/api/transactions/', {'branch': branch_b.id, 'trade_type': 'IMPORT',
                                                        'serial_number': 'ZZ-SPOOF'}, format='json')
        spoof = Transaction.objects.filter(serial_number='ZZ-SPOOF').first()
        check('جعل بندر: مدیر A با branch=B می‌فرستد، اما در A ذخیره می‌شود',
              response.status_code == 201 and spoof is not None and spoof.branch_id == branch_a.id
              and spoof.created_by_id == manager_a.id,
              f'status={response.status_code}, saved_branch={spoof.branch_id if spoof else None}')

        moved = client_a.patch(f'/api/transactions/{tx_a.id}/', {'branch': branch_b.id}, format='json')
        tx_a.refresh_from_db()
        upload = client_a.post('/api/documents/', {'transaction': tx_b.id, 'title': 'hack',
                                                   # a valid PDF, so the branch check (403) is what refuses it
                                                   'file': SimpleUploadedFile('x.pdf', b'%PDF-1.4\n%%EOF\n')},
                                  format='multipart')
        check('مدیر A معامله را به B برده نمی‌تواند و به معاملهٔ B سند وصل کرده نمی‌تواند',
              moved.status_code == 200 and tx_a.branch_id == branch_a.id and upload.status_code == 403,
              f'patch={moved.status_code}, branch={tx_a.branch_id}, upload={upload.status_code}')
        rate.delete()

        print('د) قفل نرم نرخ روز')
        for label, url, body in (
            ('معامله بدون نرخ امروز → 428', '/api/transactions/',
             {'branch': branch_a.id, 'trade_type': 'EXPORT', 'serial_number': 'ZZ-LOCK'}),
            ('حواله بدون نرخ امروز → 428', '/api/hawala/',
             {'branch': branch_a.id, 'from_party': 'الف', 'to_party': 'ب', 'amount': '10', 'currency': 'USD'}),
            ('مصرف دفتر بدون نرخ امروز → 428', '/api/office-expenses/',
             {'branch': branch_a.id, 'category': 'SALARY', 'amount': '10', 'currency': 'USD'}),
        ):
            response = client_a.post(url, body, format='json')
            check(label, response.status_code == 428 and response.data.get('code') == 'TODAY_RATE_MISSING',
                  f"status={response.status_code}, code={getattr(response, 'data', {}).get('code')}")

        future = client_a.post('/api/exchange-rates/', {'date': str(tomorrow), 'currency': 'USD', 'rate': '71'},
                               format='json')
        response = client_a.post('/api/exchange-rates/', {'date': to_dari(today), 'currency': 'USD',
                                                          'rate': '۷۰٫۵'}, format='json')
        rate = ExchangeRate.objects.filter(date=today, currency='USD').first()
        check('نرخ فردا رد می‌شود (400)؛ نرخ امروز با ارقام دری ثبت می‌شود (201)',
              future.status_code == 400 and response.status_code == 201 and rate is not None
              and rate.rate == Decimal('70.5') and rate.created_by_id == manager_a.id,
              f'future={future.status_code}, today={response.status_code}')

        response = client_a.post('/api/office-expenses/', {'branch': branch_b.id, 'category': 'SALARY',
                                                           'amount': '10', 'currency': 'USD'}, format='json')
        expense = OfficeExpense.objects.filter(pk=response.data.get('id')).first() if response.status_code == 201 else None
        check('بعد از ثبت نرخ، همان درخواست موفق است (نرخ ۷۰.۵ ذخیره، بندر A)',
              expense is not None and expense.rate_used == Decimal('70.5') and expense.branch_id == branch_a.id
              and response.data['amount_afn'] == '705.00',
              f'status={response.status_code}')

        print('ه) محتوای معامله')
        body = {'branch': branch_a.id, 'trade_type': 'TRANSIT', 'serial_number': 'ZZ-T-1', 'trader': trader.id,
                'plate_afghan': 'ZZ-777', 'currency': 'USD', 'exchange_rate': '70.5',
                'customer_payment': '1000', 'khak_puli_cash': '200', 'transit_right': '100'}
        response = client_a.post('/api/transactions/', body, format='json')
        tx = Transaction.objects.filter(serial_number='ZZ-T-1').first()
        check('معامله ثبت شد؛ بیلانس = پرداخت مشتری − مصارف (۷۰۰)',
              response.status_code == 201 and tx is not None and tx.balance == Decimal('700')
              and response.data['balance'] == '700.00' and tx.created_by_id == manager_a.id,
              f'status={response.status_code}, data={response.data if response.status_code != 201 else ""}')

        summary = response.data.get('row_summary', {}) if response.status_code == 201 else {}
        check('row_summary: مصرف ۲۱۱۵۰ افغانی / ۳۰۰ دالر، مفاد ۴۹۳۵۰ افغانی / ۷۰۰ دالر',
              summary == {'total_expense_afn': '21150.00', 'fee_per_dollar_afn': '70.50000000',
                          'total_expense_usd': '300.00', 'profit_or_loss_afn': '49350.00',
                          'profit_or_loss_usd': '700.00'}, str(summary))

        shamsi = client_a.get('/api/transactions/', {'date_from': str(today), 'trade_type': 'TRANSIT'})
        gregorian = client_a.get('/api/transactions/', {'date_to': str(today.togregorian()), 'trade_type': 'TRANSIT'})
        check('تاریخ شمسی برگشت؛ فلتر تاریخ با شمسی و میلادی هر دو کار می‌کند',
              response.data.get('date') == str(today)
              and [r['id'] for r in results(shamsi)] == [tx.id] and [r['id'] for r in results(gregorian)] == [tx.id],
              f"date={response.data.get('date')}, shamsi={shamsi.status_code}, gregorian={gregorian.status_code}")

        response = client_a.get('/api/transactions/', {'search': 'ZZ-777'})
        check('جستجو با نمبر پلیت کار می‌کند', [r['id'] for r in results(response)] == [tx.id],
              f'status={response.status_code}')

        print('و) فورم پویا (FormConfig)')
        response = client_a.get('/api/form-config/', {'branch': branch_b.id, 'trade_type': 'EXPORT'})
        check('مدیر A با branch=B هم فورم بندر A را می‌گیرد',
              response.status_code == 200 and response.data['branch'] == branch_a.id,
              f"status={response.status_code}, branch={response.data.get('branch')}")

        response = admin_client.get('/api/form-config/', {'branch': branch_b.id, 'trade_type': 'EXPORT'})
        missing = admin_client.get('/api/form-config/', {'trade_type': 'EXPORT'})
        check('سوپر ادمین branch=B را می‌گیرد؛ بدون branch → 400',
              response.status_code == 200 and response.data['branch'] == branch_b.id and missing.status_code == 400,
              f'with={response.status_code}, without={missing.status_code}')

        FieldConfig.objects.filter(branch=branch_b, trade_type='EXPORT', field_name='remarks').update(visibility='HIDDEN')
        response = admin_client.get('/api/form-config/', {'branch': branch_b.id, 'trade_type': 'EXPORT'})
        fields = response.data['form_fields']
        orders = [f['sort_order'] for f in fields]
        check('فیلدهای پنهان حذف و بقیه به ترتیب sort_order اند',
              'remarks' not in [f['field_name'] for f in fields] and orders == sorted(orders)
              and all(f['required'] == (f['visibility'] == 'REQUIRED') for f in fields),
              f'{len(fields)} fields')

        print('ز) ارقام دری در API')
        response = client_a.post('/api/transactions/', {'branch': branch_a.id, 'trade_type': 'EXPORT',
                                                        'serial_number': '۴۵۶', 'currency': 'AFN',
                                                        'customer_payment': '۱٬۲۰۰', 'expense_labor': '٢٠٠'},
                                 format='json')
        tx = Transaction.objects.filter(pk=response.data.get('id')).first() if response.status_code == 201 else None
        check('مبلغ و سریال با ارقام دری/عربی ذخیره و انگلیسی می‌شوند',
              tx is not None and tx.serial_number == '456' and tx.customer_payment == Decimal('1200')
              and tx.balance == Decimal('1000'),
              f'status={response.status_code}, data={response.data if response.status_code != 201 else ""}')

        dari = client_a.get('/api/transactions/', {'date': to_dari(today), 'search': '456'})
        bad = client_a.get('/api/transactions/', {'date': 'not-a-date'})
        check('فلتر تاریخ با ارقام دری کار می‌کند؛ تاریخ غلط → 400',
              dari.status_code == 200 and [r['id'] for r in results(dari)] == [tx.id if tx else None]
              and bad.status_code == 400, f'dari={dari.status_code}, bad={bad.status_code}')

        print('ح) باز کردن قفل حساب و حذف محافظت‌شده')
        AccessAttempt.objects.create(username=manager_b.username, ip_address='10.9.9.9', user_agent='verify',
                                     http_accept='', path_info='/api/auth/login/', get_data='', post_data='',
                                     failures_since_start=5)
        listed = {row['username']: row['is_locked'] for row in results(admin_client.get('/api/users/'))}
        locked_out = login(manager_b.username)[1]
        check('حساب قفل‌شده در فهرست کاربران is_locked=true دارد و ورودش ۴۲۳ است',
              listed.get(manager_b.username) is True and listed.get(manager_a.username) is False
              and locked_out.status_code == 423, f'listed={listed.get(manager_b.username)}, login={locked_out.status_code}')

        denied = client_a.post(f'/api/users/{manager_b.id}/unlock/')
        check('مدیر بندر نمی‌تواند قفل را باز کند (403)',
              denied.status_code == 403 and AccessAttempt.objects.filter(username=manager_b.username).exists(),
              f'status={denied.status_code}')

        unlocked = admin_client.post(f'/api/users/{manager_b.id}/unlock/')
        _, relogin = login(manager_b.username)
        check('سوپر ادمین قفل را باز می‌کند: تلاش‌های axes پاک و ورود دوباره ۲۰۰',
              unlocked.status_code == 200 and unlocked.data['reset'] >= 1
              and not AccessAttempt.objects.filter(username=manager_b.username).exists()
              and relogin.status_code == 200, f'status={unlocked.status_code}, data={unlocked.data}, login={relogin.status_code}')

        protected = admin_client.delete(f'/api/branches/{branch_a.id}/')
        check('حذف بندری که کاربر دارد → 409 با پیام دری (نه 500)',
              protected.status_code == 409 and protected.data.get('code') == 'PROTECTED'
              and 'کاربران' in protected.data['detail'] and Branch.objects.filter(pk=branch_a.id).exists(),
              f'status={protected.status_code}, data={getattr(protected, "data", None)}')

        raise Rollback
except Rollback:
    pass

print('ط) پاک‌کاری')
check('همهٔ داده‌های آزمایشی rollback شد', counts() == before, f'before={before}, after={counts()}')

print()
if failures:
    print(f'{len(failures)} از {number} تست ناکام:')
    for label in failures:
        print(f'  - {label}')
    sys.exit(1)
print(f'همهٔ {number} تست موفق بود.')
