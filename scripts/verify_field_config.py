"""
Verify FieldConfig and the seed_field_config command.

    .venv\\Scripts\\python scripts\\verify_field_config.py

Runs against the configured database inside one DB transaction that is rolled
back at the end, so no test data is left behind.
"""
import os
import re
import sys
from io import StringIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'kabulcargo_backend.settings')
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

import django  # noqa: E402

django.setup()

from django.core.exceptions import ValidationError  # noqa: E402
from django.core.management import call_command  # noqa: E402
from django.db import IntegrityError, transaction  # noqa: E402
from django.test import Client  # noqa: E402

from accounts.models import Branch, User  # noqa: E402
from config.management.commands.seed_field_config import FIELD_SPEC  # noqa: E402
from config.models import FieldConfig, configurable_transaction_fields  # noqa: E402
from operations.models import Transaction  # noqa: E402

failures = []
TRADE_TYPES = [choice[0] for choice in Transaction.TradeType.choices]


def check(label, ok, detail=''):
    print(f"  [{'OK' if ok else 'FAIL'}] {label}{(' — ' + detail) if detail else ''}")
    if not ok:
        failures.append(label)


def seed(**options):
    """Run seed_field_config and return the number of rows it created."""
    out = StringIO()
    call_command('seed_field_config', stdout=out, **options)
    match = re.search(r'ساخته‌شده: (\d+)', out.getvalue())
    return int(match.group(1)) if match else None


def visibility(branch, trade_type, field_name):
    return FieldConfig.objects.get(branch=branch, trade_type=trade_type, field_name=field_name).visibility


def counts():
    return FieldConfig.objects.count(), FieldConfig.history.count(), Branch.objects.count()


class Rollback(Exception):
    pass


before = counts()

try:
    with transaction.atomic():
        branch = Branch.objects.create(name='بندر آزمایشی تنظیمات', code='ZZCFG')

        print('۱. ردیف‌ها seed شدند')
        spec_names = [row[0] for row in FIELD_SPEC]
        model_names = [name for name, _ in configurable_transaction_fields()]
        check('FIELD_SPEC covers every editable Transaction field',
              sorted(spec_names) == sorted(model_names) and len(spec_names) == len(set(spec_names)),
              f'spec={len(spec_names)}, model={len(model_names)}, '
              f'missing={sorted(set(model_names) - set(spec_names))}, extra={sorted(set(spec_names) - set(model_names))}')
        auto_rows = FieldConfig.objects.filter(branch=branch).count()
        FieldConfig.objects.filter(branch=branch).delete()  # like a branch from before the auto-seed signal
        created = seed(branch='zzcfg')
        per_type = {t: FieldConfig.objects.filter(branch=branch, trade_type=t).count() for t in TRADE_TYPES}
        check(f'{len(FIELD_SPEC)} rows for each of the 4 trade types',
              created == len(FIELD_SPEC) * 4 and set(per_type.values()) == {len(FIELD_SPEC)},
              f'created={created}, per type={per_type}')
        check('command backfills the same rows the signal makes', auto_rows == created, f'signal={auto_rows}')

        print('۲. ترتیب فیلدها')
        export_order = list(FieldConfig.objects.filter(branch=branch, trade_type='EXPORT')
                            .order_by('sort_order').values_list('field_name', flat=True))
        check('EXPORT starts serial_number → date → status',
              export_order[:3] == ['serial_number', 'date', 'status'], str(export_order[:5]))
        check('plate_afghan (100) after status (30)', export_order.index('plate_afghan') > export_order.index('status'))
        check('customer_payment (400) before khak_puli_cash (440)',
              export_order.index('customer_payment') < export_order.index('khak_puli_cash'))
        check('order follows sort_order, not the alphabet',
              export_order == [row[0] for row in sorted(FIELD_SPEC, key=lambda r: r[2])]
              and export_order != sorted(export_order))
        default_order = list(FieldConfig.objects.filter(branch=branch, trade_type='EXPORT')
                             .values_list('field_name', flat=True))
        check('default model ordering is sort_order too', default_order == export_order)

        print('۳. override تجاری')
        expected = [('TRANSIT', 'motabari', 'REQUIRED'), ('EXPORT', 'motabari', 'HIDDEN'),
                    ('IMPORT', 'motabari', 'HIDDEN'), ('EXPORT', 'seal_expense', 'REQUIRED'),
                    ('IMPORT', 'seal_expense', 'OPTIONAL'), ('EXPORT', 'gate_ticket_expense', 'REQUIRED'),
                    ('TIR_CARNET', 'scale_ticket_expense', 'OPTIONAL')]
        for trade_type, field_name, want in expected:
            got = visibility(branch, trade_type, field_name)
            check(f'{trade_type} + {field_name} → {want}', got == want, got)

        print('۴. unique_together')
        try:
            with transaction.atomic():
                FieldConfig.objects.create(branch=branch, trade_type='EXPORT', field_name='serial_number',
                                           field_label_fa='تکراری')
            check('duplicate (branch, trade_type, field_name) blocked', False)
        except IntegrityError:
            check('duplicate (branch, trade_type, field_name) blocked', True, 'IntegrityError')

        print('۵. فیلد ناموجود رد می‌شود')
        for bad in ('fake_field', 'balance', 'documents', 'id', 'branch'):
            try:
                FieldConfig(branch=branch, trade_type='IMPORT', field_name=bad, field_label_fa='x').full_clean()
                check(f'{bad!r} rejected', False)
            except ValidationError as exc:
                check(f'{bad!r} rejected', 'field_name' in exc.message_dict, exc.message_dict['field_name'][0])

        print('۶. seed دوباره چیزی تغییر نمی‌دهد')
        custom = FieldConfig.objects.get(branch=branch, trade_type='IMPORT', field_name='goods_type')
        custom.visibility, custom.field_label_fa, custom.sort_order = 'REQUIRED', 'برچسب سفارشی', 5
        custom.save()
        created = seed()
        custom.refresh_from_db()
        check('rerun created 0 rows', created == 0, f'created={created}')
        check('custom visibility, label and order kept',
              (custom.visibility, custom.field_label_fa, custom.sort_order) == ('REQUIRED', 'برچسب سفارشی', 5),
              f'{custom.visibility} / {custom.field_label_fa} / {custom.sort_order}')
        dry = seed(dry_run=True)
        check('dry-run reports 0 and saves nothing', dry == 0)

        print('۷. seed برای بندر جدید')
        rows_before = {b.pk: b.field_configs.count() for b in Branch.objects.all()}
        new_branch = Branch.objects.create(name='بندر آزمایشی دوم', code='ZZCFG2')
        created = seed()
        rows_after = {b.pk: b.field_configs.count() for b in Branch.objects.all()}
        others_unchanged = all(rows_after[pk] == count for pk, count in rows_before.items())
        check('new branch has its rows; manual seed adds nothing; other branches unchanged',
              created == 0 and rows_after[new_branch.pk] == len(FIELD_SPEC) * 4 and others_unchanged,
              f'created={created}, new branch rows={rows_after[new_branch.pk]}')

        print('۸. صفحات پنل مدیریت')
        admin_user = User.objects.create_superuser('zz_verify_cfg', None, 'Verify-Pass-123')
        client = Client(HTTP_HOST='127.0.0.1')
        client.force_login(admin_user)
        row = FieldConfig.objects.get(branch=branch, trade_type='EXPORT', field_name='serial_number')
        pages = ['/admin/config/fieldconfig/', '/admin/config/fieldconfig/add/',
                 f'/admin/config/fieldconfig/{row.pk}/change/', f'/admin/config/fieldconfig/{row.pk}/history/']
        codes = [client.get(page).status_code for page in pages]
        check('all pages return 200', codes == [200] * len(pages), str(codes))
        response = client.post('/admin/config/fieldconfig/add/', {
            'branch': new_branch.pk, 'trade_type': 'EXPORT', 'field_name': 'fake_field',
            'field_label_fa': 'x', 'visibility': 'OPTIONAL', 'sort_order': '1'})
        check('add form rejects an unknown field name', response.status_code == 200)
        FieldConfig.objects.filter(branch=new_branch, trade_type='EXPORT', field_name='remarks').delete()
        response = client.post('/admin/config/fieldconfig/add/', {
            'branch': new_branch.pk, 'trade_type': 'EXPORT', 'field_name': 'remarks',
            'field_label_fa': 'ملاحظات', 'visibility': 'HIDDEN', 'sort_order': '299'})
        check('add form accepts a real field name', response.status_code == 302 and FieldConfig.objects.filter(
            branch=new_branch, trade_type='EXPORT', field_name='remarks', visibility='HIDDEN').exists(),
              f'status={response.status_code}')

        print('۹. list_editable کار می‌کند')
        url = f'/admin/config/fieldconfig/?branch__id__exact={branch.pk}&trade_type__exact=EXPORT&q=serial_number'
        response = client.post(url, {
            'form-TOTAL_FORMS': '1', 'form-INITIAL_FORMS': '1', 'form-MIN_NUM_FORMS': '0', 'form-MAX_NUM_FORMS': '1000',
            'form-0-id': row.pk, 'form-0-visibility': 'OPTIONAL', 'form-0-sort_order': '15', '_save': 'ذخیره',
        })
        row.refresh_from_db()
        check('inline edit saved (302)', response.status_code == 302 and row.visibility == 'OPTIONAL'
              and row.sort_order == 15, f'status={response.status_code}, {row.visibility}/{row.sort_order}')

        print('۱۰. تاریخچه')
        check('row has 2 history entries (create + edit)', row.history.count() == 2, str(row.history.count()))
        check('admin user recorded on the edit', row.history.first().history_user == admin_user)

        print('۱۲. ساختن بندر خودکار seed می‌کند')
        auto_branch = Branch.objects.create(name='بندر خودکار', code='ZZAUTO')
        auto_rows = FieldConfig.objects.filter(branch=auto_branch).count()
        check('بندر جدید خودکار 172 ردیف گرفت', auto_rows == len(FIELD_SPEC) * 4,
              f'{auto_rows} rows')
        # verify trade-type override applied automatically
        auto_motabari_transit = FieldConfig.objects.get(
            branch=auto_branch, trade_type='TRANSIT', field_name='motabari').visibility
        check('override تجاری خودکار اعمال شد (TRANSIT + motabari = REQUIRED)',
              auto_motabari_transit == 'REQUIRED', auto_motabari_transit)
        check('auto rows have history too', FieldConfig.history.filter(branch=auto_branch).count() == auto_rows)

        response = client.post('/admin/accounts/branch/add/', {'name': 'بندر از پنل', 'code': 'ZZADM',
                                                               'is_active': 'on'})
        admin_branch = Branch.objects.filter(code='ZZADM').first()
        admin_history = FieldConfig.history.filter(branch=admin_branch)
        check('branch added in admin → 172 rows, history credited to the admin user',
              response.status_code == 302 and admin_branch is not None
              and admin_branch.field_configs.count() == len(FIELD_SPEC) * 4
              and admin_history.count() == len(FIELD_SPEC) * 4
              and not admin_history.exclude(history_user=admin_user).exists(),
              f'status={response.status_code}')
        check('editing a branch does not seed again',
              (auto_branch.save() or True) and FieldConfig.objects.filter(branch=auto_branch).count() == auto_rows)

        raise Rollback
except Rollback:
    pass

print('۱۱. پاکسازی (آخر کار)')
after = counts()
check('no leftover rows', before == after, f'before={before}, after={after}')

print(f"\nنتیجه: {'همه آزمایش‌ها موفق ✅' if not failures else 'ناکام: ' + ', '.join(failures)}")
sys.exit(1 if failures else 0)
