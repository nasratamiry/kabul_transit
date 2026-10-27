"""
Verify stage 7 security hardening on the real MySQL database.

    .venv\\Scripts\\python scripts\\verify_security.py

Database changes run inside one transaction that is rolled back. Each test
group uses its own fake client IP (REMOTE_ADDR) so rate limits do not leak
between groups. Production settings are checked in a subprocess with real
environment variables. Files the test creates (uploads, backups, a temp .env)
are deleted at the end. Side effects that remain on purpose: lines appended to
logs/security.log, and the database cache table for production
(createcachetable, idempotent — a normal deploy step).
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'kabulcargo_backend.settings')
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

import django  # noqa: E402

django.setup()

import gzip  # noqa: E402

from axes.models import AccessAttempt  # noqa: E402
from django.conf import settings  # noqa: E402
from django.core.cache import cache  # noqa: E402
from django.core.files.uploadedfile import SimpleUploadedFile  # noqa: E402
from django.core.management import call_command  # noqa: E402
from django.db import transaction  # noqa: E402
from django.test import Client  # noqa: E402
from rest_framework.test import APIClient  # noqa: E402

from accounts.models import Branch, User  # noqa: E402
from operations.models import Document, Transaction  # noqa: E402
from partners.models import Trader  # noqa: E402

PASSWORD = 'Kabul-Secure-2026!'
LOG_FILE = Path(settings.LOG_DIR) / 'security.log'
BACKUP_DIR = Path(settings.BACKUP_DIR)
failures = []
number = 0


def check(label, ok, detail=''):
    global number
    number += 1
    print(f"  [{'OK' if ok else 'FAIL'}] {number:02d}. {label}{(' — ' + detail) if detail else ''}")
    if not ok:
        failures.append(f'{number:02d}. {label}')


def api(ip):
    return APIClient(HTTP_HOST='127.0.0.1', REMOTE_ADDR=ip)


def login(ip, username, password=PASSWORD):
    client = api(ip)
    response = client.post('/api/auth/login/', {'username': username, 'password': password}, format='json')
    if response.status_code == 200:
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")
    return client, response


def fresh_rate_window(ip, needed_seconds=15):
    """
    django-ratelimit counts in fixed one-minute windows whose edge depends on the key (the IP).
    Six logins that straddle an edge are split across two windows and the sixth is not refused,
    which made test 01 fail now and then. Wait for the next window when too little of this one
    is left.
    """
    from django_ratelimit.core import _get_window  # the library's own edge, not a copy of it
    left = _get_window(ip, 60) - time.time()
    if left < needed_seconds:
        time.sleep(left + 1)


def code_of(response):
    data = getattr(response, 'data', None)
    if data is None:
        try:
            data = json.loads(response.content)
        except ValueError:
            return None
    return data.get('code') if isinstance(data, dict) else None


def log_position():
    return LOG_FILE.stat().st_size if LOG_FILE.exists() else 0


def log_since(position):
    with open(LOG_FILE, 'rb') as handle:
        handle.seek(position)
        return handle.read().decode('utf-8', 'replace')


def run_production(code, **env):
    """Run python code with production settings in a fresh process; returns (returncode, stdout, stderr)."""
    full_env = {**os.environ, 'DJANGO_SETTINGS_MODULE': 'kabulcargo_backend.settings_production',
                'PYTHONIOENCODING': 'utf-8', **env}
    prelude = f'import sys; sys.path.insert(0, {str(ROOT)!r}); import django; django.setup()\n'
    done = subprocess.run([sys.executable, '-c', prelude + code], env=full_env, capture_output=True,
                          text=True, encoding='utf-8', cwd=ROOT, timeout=120)
    return done.returncode, done.stdout, done.stderr


def pdf_bytes(size):
    head, tail = b'%PDF-1.4\n', b'\n%%EOF\n'
    return head + b'0' * (size - len(head) - len(tail)) + tail


class Rollback(Exception):
    pass


before_counts = (User.objects.count(), Branch.objects.count(), Document.objects.count(), AccessAttempt.objects.count())
backups_before = {p.name for p in BACKUP_DIR.glob('*')} if BACKUP_DIR.exists() else set()
stored_files = []
cache.clear()

try:
    with transaction.atomic():
        branch = Branch.objects.create(name='بندر آزمایشی امنیت', code='ZZSEC')
        admin = User.objects.create_user('zz_sec_admin', password=PASSWORD, role='super_admin',
                                         is_staff=True, is_superuser=True)
        manager = User.objects.create_user('zz_sec_mgr', password=PASSWORD, role='branch_manager', branch=branch)
        for name in ('zz_sec_u2', 'zz_sec_lock'):
            User.objects.create_user(name, password=PASSWORD, role='branch_manager', branch=branch)
        txn = Transaction.objects.create(branch=branch, trade_type='EXPORT', serial_number='ZZ-SEC-1')

        print('الف) محدودیت تعداد درخواست (Rate limiting)')
        fresh_rate_window('10.7.0.1')
        statuses = [login('10.7.0.1', f'zz_nobody_{i}', 'wrong')[1] for i in range(6)]
        sixth = statuses[-1]
        check('۶ تلاش ناموفق از یک IP → ششمی ۴۲۹ (TOO_MANY_LOGIN_ATTEMPTS)',
              sixth.status_code == 429 and code_of(sixth) == 'TOO_MANY_LOGIN_ATTEMPTS'
              and 'Retry-After' in sixth and 'ثانیه' in sixth.data['detail'],
              f'statuses={[r.status_code for r in statuses]}')

        for _ in range(3):
            login('10.7.0.2', 'zz_sec_u2', 'wrong')
        _, ok_login = login('10.7.0.2', 'zz_sec_u2')
        check('لاگین موفق بعد از ۳ تلاش ناموفق → ۲۰۰ (و شمارش axes صفر شد)',
              ok_login.status_code == 200 and not AccessAttempt.objects.filter(username='zz_sec_u2').exists(),
              f'status={ok_login.status_code}')

        cache.clear()
        admin_client, _ = login('10.7.0.3', 'zz_sec_admin')
        codes = [admin_client.get('/api/transactions/').status_code for _ in range(101)]
        throttled = admin_client.get('/api/transactions/')  # 102nd: still throttled, inspect body
        check('۱۰۱ درخواست GET روی /api/transactions/ → درخواست ۱۰۱ام ۴۲۹ با پیام دری',
              codes[:100] == [200] * 100 and codes[100] == 429 and code_of(throttled) == 'TOO_MANY_REQUESTS'
              and 'درخواست' in throttled.data['detail'],
              f'200s={codes.count(200)}, first 429 at #{codes.index(429) + 1 if 429 in codes else None}')

        anon = [api('10.7.0.4').post('/api/auth/refresh/', {'refresh': 'x'}, format='json').status_code
                for _ in range(21)]
        spoofed = api('10.7.0.4').post('/api/auth/refresh/', {'refresh': 'x'}, format='json',
                                       HTTP_X_FORWARDED_FOR='203.0.113.9')
        check('بی‌نام: ۲۰ در دقیقه؛ X-Forwarded-For جعلی محدودیت را دور نمی‌زند',
              anon[:20].count(429) == 0 and anon[20] == 429 and spoofed.status_code == 429,
              f'21st={anon[20]}, spoofed={spoofed.status_code}')
        cache.clear()

        print('ب) قفل حساب (django-axes)')
        lock_statuses = [login(f'10.7.1.{i}', 'zz_sec_lock', 'wrong')[1].status_code for i in range(1, 6)]
        attempts = sum(AccessAttempt.objects.filter(username='zz_sec_lock').values_list('failures_since_start', flat=True))
        check('۵ لاگین ناموفق با یک username (از ۵ IP مختلف) → حساب قفل',
              attempts >= 5 and lock_statuses[-1] == 423, f'statuses={lock_statuses}, failures={attempts}')
        _, locked = login('10.7.1.9', 'zz_sec_lock')
        check('رمز درست بعد از قفل → ۴۲۳ با code=ACCOUNT_LOCKED',
              locked.status_code == 423 and code_of(locked) == 'ACCOUNT_LOCKED', f'status={locked.status_code}')

        browser = Client(HTTP_HOST='127.0.0.1')
        browser.force_login(admin)
        ids = list(AccessAttempt.objects.filter(username='zz_sec_lock').values_list('pk', flat=True))
        page = browser.get('/admin/axes/accessattempt/')
        unlock = browser.post('/admin/axes/accessattempt/',
                              {'action': 'delete_selected', '_selected_action': ids, 'post': 'yes'})
        _, after_unlock = login('10.7.1.10', 'zz_sec_lock')
        check('سوپر ادمین از پنل قفل را برمی‌دارد → لاگین دوباره ۲۰۰',
              page.status_code == 200 and unlock.status_code == 302 and after_unlock.status_code == 200,
              f'admin page={page.status_code}, delete={unlock.status_code}, login={after_unlock.status_code}')
        cache.clear()

        print('ج) هدرهای امنیتی')
        probe = (
            "import json\n"
            "from django.conf import settings\n"
            "from django.core.management import call_command\n"
            "from django.test import Client\n"
            "call_command('createcachetable', verbosity=0)\n"
            "c = Client(HTTP_HOST='127.0.0.1')\n"
            "r = c.get('/api/auth/me/', secure=True)\n"
            "plain = c.get('/api/auth/me/')\n"
            "print(json.dumps({'debug': settings.DEBUG, 'hosts': settings.ALLOWED_HOSTS, 'status': r.status_code,\n"
            "  'xfo': r.headers.get('X-Frame-Options'), 'hsts': r.headers.get('Strict-Transport-Security'),\n"
            "  'csp': r.headers.get('Content-Security-Policy'), 'nosniff': r.headers.get('X-Content-Type-Options'),\n"
            "  'plain_status': plain.status_code, 'plain_location': plain.headers.get('Location'),\n"
            "  'cors': settings.CORS_ALLOWED_ORIGINS, 'cache': settings.CACHES['default']['BACKEND']}))\n"
        )
        rc, out, err = run_production(probe, ALLOWED_HOSTS='127.0.0.1,kabulcargo.example',
                                      CORS_ALLOWED_ORIGINS='https://app.kabulcargo.example')
        prod = json.loads(out.strip().splitlines()[-1]) if rc == 0 and out.strip() else {}
        check('DEBUG=False: پاسخ API هدر X-Frame-Options: DENY دارد', prod.get('xfo') == 'DENY',
              f"xfo={prod.get('xfo')}, status={prod.get('status')}" if prod else err.strip()[-300:])
        check('production: HSTS یک‌ساله + http به https ریدایرکت می‌شود',
              prod.get('hsts') == 'max-age=31536000; includeSubDomains; preload'
              and prod.get('plain_status') == 301 and str(prod.get('plain_location', '')).startswith('https://'),
              f"hsts={prod.get('hsts')}, http→{prod.get('plain_status')}")

        def directives(header):
            # directive name → set of sources (django-csp's directive order is not stable)
            parts = (item.split() for item in (header or '').split(';') if item.strip())
            return {part[0]: set(part[1:]) for part in parts}

        api_csp = directives(api('10.7.2.1').get('/api/auth/me/').headers.get('Content-Security-Policy'))
        admin_csp = directives(browser.get('/admin/').headers.get('Content-Security-Policy'))
        check('هدر CSP موجود است (API سخت؛ پنل فقط استثنای مستند)',
              api_csp.get('script-src') == {"'self'"} and api_csp.get('frame-ancestors') == {"'none'"}
              and "'unsafe-inline'" in admin_csp.get('script-src', set())
              and directives(prod.get('csp')) == api_csp and prod.get('nosniff') == 'nosniff',
              f"api script-src={api_csp.get('script-src')}, admin script-src={admin_csp.get('script-src')}")

        print('د) محدودیت فایل آپلود')
        mgr_client, _ = login('10.7.3.1', 'zz_sec_mgr')

        def upload(name, content):
            return mgr_client.post('/api/documents/', {'doc_type': 'OTHER', 'transaction': txn.pk, 'title': 'آزمایش',
                                                       'file': SimpleUploadedFile(name, content)}, format='multipart')

        big = upload('big.pdf', pdf_bytes(11 * 1024 * 1024))
        check('فایل ۱۱ MB → رد با پیام دری', big.status_code == 400 and 'میگابایت' in str(big.data.get('file')),
              f'status={big.status_code}, {big.data.get("file")}')
        exe = upload('photo.jpg', b'MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff' + b'\x00' * 300)
        check('فایل exe با پسوند jpg → رد (magic bytes)', exe.status_code == 400 and 'file' in exe.data,
              f'status={exe.status_code}, {exe.data.get("file")}')
        good = upload('manifest.pdf', pdf_bytes(5 * 1024 * 1024))
        if good.status_code == 201:
            stored_files.append(Document.objects.get(pk=good.data['id']).file)
        check('PDF معتبر ۵ MB → قبول (۲۰۱)', good.status_code == 201, f'status={good.status_code}')
        fake_pdf = upload('notes.pdf', b'just text pretending to be a pdf')
        svg = upload('logo.svg', b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
        check('متن با پسوند pdf و فایل SVG هم رد می‌شوند', fake_pdf.status_code == 400 and svg.status_code == 400,
              f'fake pdf={fake_pdf.status_code}, svg={svg.status_code}')

        print('هـ) لاگ امنیتی')
        position = log_position()
        login('10.7.4.1', 'zz_sec_admin')
        text = log_since(position)
        check('security.log بعد از لاگین موفق خط دارد (IP، username، user agent)',
              'login_success' in text and "'zz_sec_admin'" in text and "ip='10.7.4.1'" in text and 'ua=' in text,
              text.strip().splitlines()[-1][:120] if text.strip() else 'خالی')

        position = log_position()
        denied = mgr_client.post('/api/branches/', {'name': 'x', 'code': 'ZZX'}, format='json')
        text = log_since(position)
        check('security.log بعد از ۴۰۳ خط دارد', denied.status_code == 403 and 'permission_denied' in text,
              f'status={denied.status_code}')

        position = log_position()
        created = admin_client.post('/api/users/', {'username': 'zz_sec_new', 'password': PASSWORD,
                                                    'role': 'branch_manager', 'branch': branch.pk}, format='json')
        promoted = admin_client.patch(f"/api/users/{created.data.get('id')}/", {'role': 'super_admin', 'branch': None},
                                      format='json') if created.status_code == 201 else None
        text = log_since(position)
        check('security.log بعد از ساخت کاربر خط دارد (و تغییر نقش/بندر هم)',
              created.status_code == 201 and 'user_created' in text and "actor='zz_sec_admin'" in text
              and 'role_changed' in text and 'branch_changed' in text,
              f'create={created.status_code}, patch={getattr(promoted, "status_code", None)}')

        print('و) تنظیمات تولید')
        check('settings_production → DEBUG=False', prod.get('debug') is False, f"debug={prod.get('debug')}")
        rc_short, _, err_short = run_production('', SECRET_KEY='short-key', ALLOWED_HOSTS='kabulcargo.example',
                                                CORS_ALLOWED_ORIGINS='https://app.kabulcargo.example')
        check('SECRET_KEY کوتاه → ImproperlyConfigured', rc_short != 0 and 'ImproperlyConfigured' in err_short,
              err_short.strip().splitlines()[-1][:110] if err_short.strip() else f'rc={rc_short}')
        rc_flag, _, err_flag = run_production('', ALLOWED_HOSTS='kabulcargo.example', KC_LOCAL_HTTP_TEST='true',
                                              CORS_ALLOWED_ORIGINS='https://app.kabulcargo.example')
        rc_local, out_local, _ = run_production(
            'from django.conf import settings as s; print(s.SECURE_SSL_REDIRECT, s.SESSION_COOKIE_SECURE)',
            ALLOWED_HOSTS='localhost,127.0.0.1', KC_LOCAL_HTTP_TEST='true', CORS_ALLOWED_ORIGINS='http://localhost:8080')
        check('KC_LOCAL_HTTP_TEST با دامنهٔ واقعی → ImproperlyConfigured؛ فقط با localhost HTTPS را خاموش می‌کند',
              rc_flag != 0 and 'KC_LOCAL_HTTP_TEST' in err_flag and rc_local == 0
              and out_local.strip().splitlines()[-1] == 'False False',
              f'real={rc_flag}, local={out_local.strip()[-20:]}')
        check('ALLOWED_HOSTS و CORS از env خوانده می‌شوند',
              prod.get('hosts') == ['127.0.0.1', 'kabulcargo.example']
              and prod.get('cors') == ['https://app.kabulcargo.example'],
              f"hosts={prod.get('hosts')}")

        print('ز) اعتبارسنجی ورودی')
        trader = admin_client.post('/api/traders/', {'name': 'تاجر <b>امن</b>',
                                                     'note': '<script>alert(1)</script>یادداشت & ملاحظه'}, format='json')
        saved = Trader.objects.filter(pk=trader.data.get('id')).first() if trader.status_code == 201 else None
        check('note با <script> → تگ‌ها پاک شدند (متن عادی سالم ماند)',
              saved is not None and saved.note == 'alert(1)یادداشت & ملاحظه' and saved.name == 'تاجر امن',
              f'note={saved.note!r}' if saved else f'status={trader.status_code}')
        long_note = admin_client.post('/api/traders/', {'name': 'تاجر طولانی', 'note': 'ا' * 10000}, format='json')
        check('note با ۱۰۰۰۰ حرف → رد با پیام دری',
              long_note.status_code == 400 and 'طولانی' in str(long_note.data.get('note')),
              f'status={long_note.status_code}')

        raise Rollback
except Rollback:
    pass
finally:
    for field_file in stored_files:
        field_file.storage.delete(field_file.name)
    cache.clear()

print('ح) بک‌اپ خودکار')
start = time.time()
call_command('backup_db', verbosity=0, stdout=open(os.devnull, 'w', encoding='utf-8'))
new_backups = [p for p in BACKUP_DIR.glob('kabulcargo-*.sql.gz') if p.stat().st_mtime >= start - 1]
check('python manage.py backup_db → فایل در backups/ ساخته شد', len(new_backups) == 1,
      new_backups[0].name if new_backups else 'هیچ')
if new_backups:
    raw = gzip.open(new_backups[0]).read()
    check('فایل بیشتر از 10 KB است (SQL کامل با «Dump completed»)',
          len(raw) > 10 * 1024 and b'-- Dump completed' in raw[-200:] and raw.count(b'CREATE TABLE') > 20,
          f'gz={new_backups[0].stat().st_size // 1024} KB, sql={len(raw) // 1024} KB, tables={raw.count(b"CREATE TABLE")}')
else:
    check('فایل بیشتر از 10 KB است', False)
old_name = f"kabulcargo-{(datetime.now() - timedelta(days=31)):%Y-%m-%d}-0200.sql.gz"
(BACKUP_DIR / old_name).write_bytes(b'old fake backup')
call_command('backup_db', verbosity=0, stdout=open(os.devnull, 'w', encoding='utf-8'))
check('فایل جعلی ۳۱ روز قبل → اجرای بعدی پاکش کرد', not (BACKUP_DIR / old_name).exists(), old_name)

print('ط) چرخش SECRET_KEY (اضافه)')
temp_dir = Path(tempfile.mkdtemp())
temp_env = temp_dir / '.env'
temp_env.write_text('DEBUG=False\nSECRET_KEY=old-key\nDB_NAME=kabulcargo\n', encoding='utf-8')
call_command('rotate_secret_key', env_file=str(temp_env), noinput=True, stdout=open(os.devnull, 'w', encoding='utf-8'))
rotated = temp_env.read_text(encoding='utf-8').splitlines()
new_key = next(line.split('=', 1)[1] for line in rotated if line.startswith('SECRET_KEY='))
check('rotate_secret_key: کلید ۵۰+ حرفی، پشتیبان ساخته شد، سطرهای دیگر دست نخوردند',
      len(new_key) >= 50 and new_key != 'old-key' and len(list(temp_dir.glob('.env.bak-*'))) == 1
      and rotated[0] == 'DEBUG=False' and rotated[2] == 'DB_NAME=kabulcargo', f'len={len(new_key)}')
shutil.rmtree(temp_dir)

print('ی) پاک‌کاری')
for path in BACKUP_DIR.glob('*'):
    if path.name not in backups_before:
        path.unlink()
after_counts = (User.objects.count(), Branch.objects.count(), Document.objects.count(), AccessAttempt.objects.count())
leftover_files = [f.name for f in stored_files if f.storage.exists(f.name)]
check('هیچ دادهٔ آزمایشی در دیتابیس و هیچ فایل آپلودی نماند',
      before_counts == after_counts and not leftover_files, f'before={before_counts}, after={after_counts}')

print()
if failures:
    print('ناکام:', ', '.join(failures))
    sys.exit(1)
print(f'همهٔ {number} تست موفق بود.')
