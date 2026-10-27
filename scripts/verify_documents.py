"""
Verify customs documents: document types, required documents per branch × trade type, document
fields (type, number, issue date, note), number sync with the transaction, documents_status,
filters, the documents register, history and the admin pages.

    .venv\\Scripts\\python scripts\\verify_documents.py

Runs inside one DB transaction that is rolled back at the end; uploaded files are deleted.
Test branches use the codes ZZDA / ZZDB / ZZDC.
"""
import io
import os
import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'kabulcargo_backend.settings')
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

import django  # noqa: E402

django.setup()

from django.core.files.storage import default_storage  # noqa: E402
from django.core.files.uploadedfile import SimpleUploadedFile  # noqa: E402
from django.core.management import call_command  # noqa: E402
from django.db import connection, transaction  # noqa: E402
from django.test import Client  # noqa: E402
from django.test.utils import CaptureQueriesContext  # noqa: E402
from rest_framework.test import APIClient  # noqa: E402

from accounts.models import Branch, User  # noqa: E402
from config.models import DocumentRequirement  # noqa: E402
from finance.models import ExchangeRate  # noqa: E402
from finance.utils import kabul_today  # noqa: E402
from operations.document_defaults import DEFAULT_DOCUMENT_TYPES, DEFAULT_REQUIREMENTS  # noqa: E402
from operations.models import Document, DocumentType, Transaction  # noqa: E402

PASSWORD = 'Kabul-Verify-Docs-2026!'
PNG = (b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00'
       b'\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00'
       b'\x00\x00\x00IEND\xaeB`\x82')
PDF = b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'
EXE = b'MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff' + b'\x00' * 300
failures = []
number = 0


def check(label, ok, detail=''):
    global number
    number += 1
    print(f"  [{'OK' if ok else 'FAIL'}] {number:02d}. {label}{(' — ' + detail) if detail else ''}")
    if not ok:
        failures.append(f'{number:02d}. {label}')


def client_for(user):
    client = APIClient(HTTP_HOST='127.0.0.1')
    client.force_authenticate(user)
    return client


def results(response):
    data = response.data
    return data['results'] if isinstance(data, dict) and 'results' in data else data


def counts():
    return (Branch.objects.count(), User.objects.count(), Transaction.objects.count(), Document.objects.count(),
            DocumentType.objects.count(), DocumentRequirement.objects.count(), ExchangeRate.objects.count())


class Rollback(Exception):
    pass


before = counts()
stored = []
open_responses = []
today = kabul_today()

try:
    with transaction.atomic():
        ExchangeRate.objects.get_or_create(date=today, currency='USD', defaults={'rate': Decimal('70')})
        branch_a = Branch.objects.create(name='بندر آزمایشی اسناد الف', code='ZZDA')
        branch_b = Branch.objects.create(name='بندر آزمایشی اسناد ب', code='ZZDB')
        admin = User.objects.create_superuser('zz_doc_admin', None, PASSWORD)
        mgr_a = User.objects.create_user('zz_doc_mgr_a', None, PASSWORD, role='branch_manager', branch=branch_a)
        mgr_b = User.objects.create_user('zz_doc_mgr_b', None, PASSWORD, role='branch_manager', branch=branch_b)
        api_admin, api_a, api_b = client_for(admin), client_for(mgr_a), client_for(mgr_b)
        tx_transit = Transaction.objects.create(branch=branch_a, trade_type='TRANSIT', serial_number='ZZD-1')
        tx_export = Transaction.objects.create(branch=branch_a, trade_type='EXPORT', serial_number='ZZD-2')
        tx_b = Transaction.objects.create(branch=branch_b, trade_type='TRANSIT', serial_number='ZZD-B1')

        def upload(client, tx, doc_type='T1', name='t1.pdf', content=PDF, **extra):
            data = {'transaction': tx.pk, 'file': SimpleUploadedFile(name, content), **extra}
            if doc_type is not None:
                data['doc_type'] = doc_type
            response = client.post('/api/documents/', data, format='multipart')
            if response.status_code == 201:
                stored.append(Document.objects.get(pk=response.data['id']).file.name)
            return response

        print('الف) انواع اسناد')
        types = dict(DocumentType.objects.values_list('code', 'number_field'))
        expected = {code: field for code, _, _, _, field, _ in DEFAULT_DOCUMENT_TYPES}
        check('۱۲ نوع پیش‌فرض با فیلد نمبر درست (T1→t1_number، TARIFF_SLIP→bank_tariff_slip_number، ...)',
              all(types.get(code) == field for code, field in expected.items()), str(types))
        total = DocumentType.objects.count()
        call_command('seed_document_types', stdout=io.StringIO())
        call_command('seed_document_types', stdout=io.StringIO())
        check('seed_document_types دو بار اجرا شد؛ چیزی تکرار نشد', DocumentType.objects.count() == total)

        listed = api_a.get('/api/document-types/')
        denied = api_a.post('/api/document-types/', {'code': 'ZZ_X', 'name_fa': 'x'}, format='json')
        check('مدیر بندر انواع را می‌بیند اما ساخته نمی‌تواند (403)',
              listed.status_code == 200 and len(listed.data) == total and denied.status_code == 403,
              f'list={listed.status_code}, post={denied.status_code}')

        made = api_admin.post('/api/document-types/', {'code': 'zz_permit', 'name_fa': 'جواز آزمایشی',
                                                       'name_en': 'Test permit', 'sort_order': 500}, format='json')
        new_type = DocumentType.objects.filter(code='ZZ_PERMIT').first()
        check('سوپر ادمین نوع تازه می‌سازد؛ کود بزرگ می‌شود', made.status_code == 201 and new_type is not None,
              f'status={made.status_code} {made.data}')
        rename = api_admin.patch(f'/api/document-types/{new_type.pk}/', {'name_fa': 'جواز آزمایشی ۲'}, format='json')
        recode = api_admin.patch(f'/api/document-types/{new_type.pk}/', {'code': 'ZZ_OTHER'}, format='json')
        check('نام قابل تغییر است؛ کود بعد از ثبت تغییر نمی‌کند (400)',
              rename.status_code == 200 and recode.status_code == 400 and 'code' in recode.data,
              f'rename={rename.status_code}, recode={recode.status_code}')
        rows = DocumentRequirement.objects.filter(doc_type=new_type)
        check('نوع تازه برای همهٔ بندرها × ۴ نوع معامله ردیف «لازم نیست» گرفت',
              rows.count() == Branch.objects.count() * 4 and not rows.filter(required=True).exists(),
              f'rows={rows.count()}, branches={Branch.objects.count()}')

        print('ب) اسناد لازم (DocumentRequirement)')
        branch_c = Branch.objects.create(name='بندر آزمایشی اسناد ج', code='ZZDC')
        grid = DocumentRequirement.objects.filter(branch=branch_c)
        required = {tt: sorted(grid.filter(trade_type=tt, required=True).values_list('doc_type__code', flat=True))
                    for tt in DEFAULT_REQUIREMENTS}
        check('بندر تازه خودکار جدول کامل اسناد لازم را با پیش‌فرض‌ها گرفت',
              grid.count() == 4 * DocumentType.objects.count()
              and required == {tt: sorted(codes) for tt, codes in DEFAULT_REQUIREMENTS.items()},
              f'rows={grid.count()}, required={required}')
        cell = grid.get(trade_type='TRANSIT', doc_type__code='T1')
        cell.required = False
        cell.save()
        grid.filter(trade_type='IMPORT', doc_type__code='CMR').delete()
        call_command('seed_document_requirements', stdout=io.StringIO())
        cell.refresh_from_db()
        check('seed_document_requirements ردیف گم‌شده را می‌سازد و انتخاب سوپر ادمین را دست نمی‌زند',
              grid.filter(trade_type='IMPORT', doc_type__code='CMR').exists() and cell.required is False)

        mine = api_a.get('/api/document-requirements/')
        set_denied = api_a.post('/api/document-requirements/set/',
                                {'branch': branch_a.pk, 'trade_type': 'TRANSIT', 'doc_type': 'CMR', 'required': True},
                                format='json')
        check('مدیر بندر فقط جدول بندر خودش را می‌بیند و تغییر داده نمی‌تواند (403)',
              mine.status_code == 200 and mine.data and {r['branch'] for r in mine.data} == {branch_a.pk}
              and set_denied.status_code == 403, f'set={set_denied.status_code}')

        print('ج) آپلود سند و همگام‌سازی نمبر')
        no_type = upload(api_a, tx_transit, doc_type=None)
        check('آپلود بدون نوع سند رد می‌شود (400)', no_type.status_code == 400 and 'doc_type' in no_type.data,
              str(no_type.data))
        new_type.is_active = False
        new_type.save()
        inactive = upload(api_a, tx_transit, doc_type='ZZ_PERMIT')
        check('آپلود با نوع غیرفعال رد می‌شود', inactive.status_code == 400 and 'doc_type' in inactive.data)

        status = api_a.get(f'/api/transactions/{tx_transit.pk}/').data['documents_status']
        check('ترانزیت بدون T1 → documents_status.missing = [T1]',
              status == {'required': ['T1'], 'present': [], 'missing': ['T1']}, str(status))

        first = upload(api_a, tx_transit, doc_number='۱۲۳-۴۵', issue_date='۱۴۰۵-۰۷-۱۰', note='صفحهٔ اول')
        tx_transit.refresh_from_db()
        sync = first.data.get('number_sync') or {}
        check('آپلود T1 با نمبر دری → نمبر T1 خالی معامله پر شد (filled)',
              first.status_code == 201 and sync.get('status') == 'filled' and tx_transit.t1_number == '123-45'
              and first.data['doc_number'] == '123-45' and first.data['issue_date'] == '1405-07-10',
              f'status={first.status_code} sync={sync} t1={tx_transit.t1_number!r}')
        changes = [c['field'] for e in api_a.get(f'/api/transactions/{tx_transit.pk}/history/').data
                   for c in e['changes']]
        check('پر شدن نمبر در تاریخچهٔ معامله ثبت شد', 't1_number' in changes, str(changes))

        second = upload(api_a, tx_transit, doc_number='999', name='t1-page2.png', content=PNG)
        tx_transit.refresh_from_db()
        sync = second.data.get('number_sync') or {}
        check('نمبر متفاوت → هشدار دری، هیچ‌کدام بازنویسی نشد',
              second.status_code == 201 and sync.get('status') == 'mismatch' and 'فرق دارد' in sync.get('message', '')
              and tx_transit.t1_number == '123-45' and second.data['doc_number'] == '999'
              and second.data['number_mismatch'] == '123-45', f'sync={sync}')
        same = upload(api_a, tx_transit, doc_number=' ۱۲۳-۴۵ ')
        check('همان نمبر با رقم دری/فاصله → same (بدون هشدار)', (same.data.get('number_sync') or {}).get('status') == 'same')
        none = upload(api_a, tx_export, doc_type='CUSTOMS_DECLARATION', doc_number='CD-1')
        check('نوع بدون فیلد نمبر → number_sync تهی؛ چند فایل از یک نوع مجاز است',
              none.status_code == 201 and none.data['number_sync'] is None
              and Document.objects.filter(transaction=tx_transit, doc_type__code='T1').count() == 3)

        status = api_a.get(f'/api/transactions/{tx_transit.pk}/').data['documents_status']
        check('بعد از آپلود T1 → missing خالی', status['missing'] == [] and 'T1' in status['present'], str(status))

        cross = upload(api_b, tx_transit)
        move = api_a.patch(f"/api/documents/{first.data['id']}/", {'transaction': tx_export.pk}, format='json')
        check('مدیر بندر دیگر آپلود کرده نمی‌تواند (403)؛ سند به معاملهٔ دیگر منتقل نمی‌شود (400)',
              cross.status_code == 403 and move.status_code == 400, f'cross={cross.status_code}, move={move.status_code}')
        bad = upload(api_a, tx_transit, name='virus.jpg', content=EXE)
        big = upload(api_a, tx_transit, name='big.pdf', content=b'%PDF' + b'0' * (11 * 1024 * 1024))
        check('قواعد مرحلهٔ ۷ پابرجاست: exe با پسوند jpg و فایل ۱۱ MB رد می‌شوند',
              bad.status_code == 400 and big.status_code == 400 and 'میگابایت' in str(big.data))

        print('د) فیلترها و وضعیت اسناد')
        ids = lambda response: {row['id'] for row in results(response)}  # noqa: E731
        missing = api_a.get('/api/transactions/', {'missing_documents': 'true'})
        complete = api_a.get('/api/transactions/', {'missing_documents': 'false'})
        check('missing_documents=true فقط صادرات بدون برگهٔ خروجی؛ false ترانزیت کامل',
              ids(missing) == {tx_export.pk} and ids(complete) == {tx_transit.pk},
              f'missing={ids(missing)}, complete={ids(complete)}')
        export_status = next(r for r in results(missing) if r['id'] == tx_export.pk)['documents_status']
        check('در فهرست: صادرات → missing = [EXIT_SLIP] (اظهارنامه موجود است)',
              export_status['missing'] == ['EXIT_SLIP'], str(export_status))
        by_type = api_a.get('/api/transactions/', {'doc_type': 't1'})
        row = results(by_type)[0] if results(by_type) else {}
        check('فیلتر doc_type=T1 روی معاملات؛ تعداد اسناد چند برابر نمی‌شود',
              ids(by_type) == {tx_transit.pk} and row.get('documents_count') == 3, f'count={row.get("documents_count")}')
        has = api_a.get('/api/transactions/', {'has_documents': 'true'})
        check('فیلتر has_documents هنوز کار می‌کند', ids(has) == {tx_transit.pk, tx_export.pk})

        extra = [Transaction(branch=branch_a, trade_type='IMPORT', serial_number=f'ZZD-N{i}') for i in range(27)]
        Transaction.objects.bulk_create(extra)

        def list_queries(size):
            with CaptureQueriesContext(connection) as ctx:
                response = api_a.get('/api/transactions/', {'page_size': size})
            return len(ctx.captured_queries), len(results(response))
        small, small_rows = list_queries(3)
        large, large_rows = list_queries(29)
        check('documents_status بدون N+1 (۳ ردیف و ۲۹ ردیف همان تعداد query)',
              small == large and small_rows == 3 and large_rows == 29, f'{small} vs {large}')

        api_admin.post('/api/document-requirements/set/',
                       {'branch': branch_a.pk, 'trade_type': 'TRANSIT', 'doc_type': 'CMR', 'required': True},
                       format='json')
        after = api_a.get(f'/api/transactions/{tx_transit.pk}/').data['documents_status']
        history = api_admin.get(f"/api/document-requirements/"
                                f"{DocumentRequirement.objects.get(branch=branch_a, trade_type='TRANSIT', doc_type__code='CMR').pk}/history/")
        check('سوپر ادمین CMR را برای ترانزیت لازم کرد → چک‌لیست معامله فوراً CMR را ناقص نشان می‌دهد؛ تاریخچه دارد',
              after['missing'] == ['CMR'] and history.status_code == 200 and len(history.data) == 2
              and history.data[0]['user'] == admin.username, f'{after} history={len(history.data)}')
        DocumentType.objects.filter(code='CMR').update(is_active=False)
        after = api_a.get(f'/api/transactions/{tx_transit.pk}/').data['documents_status']
        DocumentType.objects.filter(code='CMR').update(is_active=True)
        check('نوع غیرفعال در اسناد لازم حساب نمی‌شود', after['missing'] == [], str(after))

        created = api_a.post('/api/transactions/', {'branch': branch_a.pk, 'trade_type': 'TRANSIT',
                                                    'serial_number': 'ZZD-NEW', 't1_number': 'T1-٧٧',
                                                    'currency': 'USD', 'exchange_rate': '70'}, format='json')
        check('سند ناقص هرگز مانع ذخیرهٔ معامله نیست؛ t1_number ذخیره می‌شود',
              created.status_code == 201 and created.data['t1_number'] == 'T1-77'
              and created.data['documents_status']['missing'] == ['T1', 'CMR'], f'{created.status_code} {created.data}')
        # Every branch-A row now lacks something: ZZD-1 its CMR, ZZD-2 the exit slip, the imports both
        # papers, ZZD-NEW its T1 and CMR. Branch B's row must not be counted.
        tile = api_a.get('/api/transactions/', {'missing_documents': 'true', 'page_size': 1})
        check('کاشی داشبورد: تعداد معاملات سند ناقص فقط از بندر خودش (همهٔ تاریخ‌ها)',
              tile.status_code == 200 and tile.data['count'] == Transaction.objects.filter(branch=branch_a).count() == 30,
              str(tile.data.get('count')))

        print('ه) فهرست اسناد (register)')
        plain = api_a.get('/api/documents/', {'transaction': tx_transit.pk})
        paged = api_a.get('/api/documents/', {'page': 1})
        check('بدون ?page= آرایهٔ ساده؛ با ?page= صفحه‌بندی {count, results}',
              isinstance(plain.data, list) and len(plain.data) == 3
              and paged.data['count'] == 4 and len(paged.data['results']) == 4)
        b_doc = upload(api_admin, tx_b, doc_number='B-T1')
        own_only = api_a.get('/api/documents/', {'page': 1})
        all_admin = api_admin.get('/api/documents/', {'page': 1, 'branch': branch_b.pk})
        check('مدیر بندر فقط اسناد بندر خودش؛ سوپر ادمین با فیلتر بندر',
              b_doc.status_code == 201 and own_only.data['count'] == 4
              and [r['id'] for r in all_admin.data['results']] == [b_doc.data['id']])
        found = api_a.get('/api/documents/', {'page': 1, 'search': '۱۲۳-۴۵'})
        by_number = api_a.get('/api/documents/', {'page': 1, 'doc_number': '123'})
        check('جستجوی نمبر T1 (رقم دری) سند و معامله‌اش را پیدا می‌کند',
              found.data['count'] == 2 and found.data['results'][0]['transaction_info']['serial_number'] == 'ZZD-1'
              and by_number.data['count'] == 2, f"{found.data['count']} {by_number.data['count']}")
        typed = api_a.get('/api/documents/', {'page': 1, 'doc_type': 'CUSTOMS_DECLARATION', 'trade_type': 'EXPORT'})
        dated = api_a.get('/api/documents/', {'page': 1, 'date_from': '1405-07-01', 'date_to': '1405-07-15'})
        check('فیلتر نوع سند، نوع معامله و بازهٔ تاریخ صدور',
              typed.data['count'] == 1 and dated.data['count'] == 1, f"{typed.data['count']} {dated.data['count']}")

        doc_id = first.data['id']
        download = api_a.get(f'/api/documents/{doc_id}/download/')
        open_responses.append(download)
        anon = APIClient(HTTP_HOST='127.0.0.1').get(f'/api/documents/{doc_id}/download/')
        body = str(paged.data) + str(plain.data) + str(found.data)
        check('دانلود با توکن: نوع درست و نام «سند T1 123-45»؛ بدون توکن 401؛ هیچ /media/ در پاسخ‌ها',
              download.status_code == 200 and download['Content-Type'] == 'application/pdf'
              and 'T1%20123-45' in download['Content-Disposition'] and anon.status_code == 401
              and '/media/' not in body, download.get('Content-Disposition', ''))

        print('و) تاریخچه و پنل ادمین')
        doc_history = api_a.get(f'/api/documents/{doc_id}/history/')
        type_history = api_admin.get(f'/api/document-types/{new_type.pk}/history/')
        check('تاریخچه: آپلود سند با نام کاربر؛ تغییر نام نوع سند',
              doc_history.status_code == 200 and doc_history.data[-1]['type'] == 'ایجاد شد'
              and doc_history.data[-1]['user'] == mgr_a.username
              and any(c['field'] == 'name_fa' for e in type_history.data for c in e['changes']))
        web = Client(HTTP_HOST='127.0.0.1')
        web.force_login(admin)
        pages = {url: web.get(url).status_code for url in (
            '/admin/operations/documenttype/', '/admin/operations/document/', '/admin/config/documentrequirement/',
            f'/admin/operations/document/{doc_id}/change/', f'/admin/operations/transaction/{tx_transit.pk}/change/')}
        check('صفحه‌های ادمین (انواع اسناد، اسناد، اسناد لازم، فورم سند و معامله) باز می‌شوند',
              set(pages.values()) == {200}, str(pages))
        in_use = api_admin.delete(f"/api/document-types/{DocumentType.objects.get(code='T1').pk}/")
        check('حذف نوع سندی که سند دارد → 409 با پیام دری', in_use.status_code == 409, str(in_use.status_code))

        raise Rollback
except Rollback:
    pass
finally:
    for response in open_responses:
        response.close()
    for name in stored:
        default_storage.delete(name)

print('ز) پاک‌کاری')
check('همهٔ داده‌های آزمایشی rollback شد', counts() == before, f'before={before}, after={counts()}')

print()
if failures:
    print(f'{len(failures)} از {number} تست ناکام:')
    for label in failures:
        print(f'  - {label}')
    sys.exit(1)
print(f'همهٔ {number} تست موفق بود.')
