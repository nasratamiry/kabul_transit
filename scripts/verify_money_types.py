"""
Verify the revenue / expense types and office income (the «revenue only if its type is REVENUE» rule).

    .venv\\Scripts\\python scripts\\verify_money_types.py

Covers: the 14 built-in types seeded by the migration, «بندر والی» instead of «استراس» everywhere,
adding a REVENUE / EXPENSE type (form, balance, row summary, statement, dashboard, Excel,
drill-down), kind changes (allowed without amounts, 409 with them, never for customer_payment),
REQUIRED enforced by the API, hiding per branch, deactivating, deleting, office income (CRUD,
scoping, 428, rate snapshot, «سایر عواید»), the invariants, and the branch manager's limits.
Runs inside one DB transaction that is rolled back: no test data is left behind.
"""
import os
import sys
from decimal import Decimal
from io import BytesIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'kabulcargo_backend.settings')
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

import django  # noqa: E402

django.setup()

import jdatetime  # noqa: E402
from django.db import connection, transaction  # noqa: E402
from django.test.utils import CaptureQueriesContext  # noqa: E402
from openpyxl import load_workbook  # noqa: E402
from rest_framework.test import APIClient  # noqa: E402

from accounts.models import Branch, User  # noqa: E402
from config.models import FieldConfig  # noqa: E402
from finance.dashboard import dashboard_summary  # noqa: E402
from finance.models import (ExchangeRate, OfficeExpense, OfficeIncome, OfficeIncomeCategory,  # noqa: E402
                            StatementLine)
from finance.reports import income_statement  # noqa: E402
from finance.utils import kabul_today  # noqa: E402
from operations.models import MoneyFieldType, Transaction, TransactionMoneyLine  # noqa: E402
from operations.money import BUILTIN_MONEY_TYPES  # noqa: E402

D = Decimal
failures = []
number = 0


def check(label, ok, detail=''):
    global number
    number += 1
    print(f"  [{'OK' if ok else 'FAIL'}] {number:02d}. {label}{(' — ' + str(detail)) if detail else ''}")
    if not ok:
        failures.append(f'{number:02d}. {label}')


def client_for(user):
    client = APIClient(HTTP_HOST='127.0.0.1')
    client.force_authenticate(user)
    return client


def counts():
    return (MoneyFieldType.objects.count(), MoneyFieldType.history.count(), TransactionMoneyLine.objects.count(),
            FieldConfig.objects.count(), StatementLine.objects.count(), OfficeIncome.objects.count(),
            OfficeIncomeCategory.objects.count(), Transaction.objects.count(), Branch.objects.count())


def line_amount(report, source):
    line = next((line for line in report['lines'] if line['source_field'] == source), None)
    return (line['section'], line['amount_afn']) if line else None


def form_fields(client, branch, trade_type):
    response = client.get('/api/form-config/', {'branch': branch.pk, 'trade_type': trade_type})
    return {f['field_name']: f for f in response.data['form_fields']}


class Rollback(Exception):
    pass


before = counts()
today = kabul_today()

try:
    with transaction.atomic():
        print('الف) مایگریشن: ۱۴ نوع داخلی، «بندر والی» به جای «استراس»')
        builtins = {t.column: t for t in MoneyFieldType.objects.exclude(column='')}
        check('۱۴ نوع داخلی با ستون، نوع و بخش درست',
              len(builtins) == 14 and all(builtins[c].kind == k and builtins[c].is_builtin
                                          for c, _, _, _, _, k, _, _ in BUILTIN_MONEY_TYPES),
              f'{len(builtins)} types')
        check('پرداخت مشتری عاید و قفل؛ ۱۳ ستون دیگر مصرف',
              builtins['customer_payment'].kind == 'REVENUE' and builtins['customer_payment'].locked
              and sum(t.kind == 'EXPENSE' for t in builtins.values()) == 13)
        estras = builtins['revenue_estras']
        check('«عواید بندر والی» مصرف است (تصمیم مالک)', estras.kind == 'EXPENSE' and estras.name_fa == 'عواید بندر والی'
              and estras.name_ps == 'د بندر والي عواید' and estras.name_en == 'Bandar Wali')
        texts = ([str(f.verbose_name) for f in Transaction._meta.fields]
                 + list(FieldConfig.objects.values_list('field_label_fa', flat=True))
                 + [v for row in StatementLine.objects.values_list('label_fa', 'label_en') for v in row]
                 + [v for row in MoneyFieldType.objects.values_list('name_fa', 'name_ps', 'name_en') for v in row])
        check('هیچ برچسب مدل، فیلد، سطر گزارش یا نوع «استراس» / Estras ندارد',
              not any('استراس' in t or 'Estras' in t for t in texts))
        check('ردیف‌های FieldConfig ستون‌های پولی به نوع خود وصل‌اند',
              not FieldConfig.objects.filter(field_name__in=Transaction.MONEY_COLUMNS, money_type__isnull=True).exists())

        print('ب) آماده‌سازی')
        ExchangeRate.objects.update_or_create(date=today, currency='USD', defaults={'rate': D('70')})
        branch_a = Branch.objects.create(name='بندر آزمایشی پول الف', code='ZZMNA')
        branch_b = Branch.objects.create(name='بندر آزمایشی پول ب', code='ZZMNB')
        admin = User.objects.create_superuser('zz_money_admin', None, 'Money-Verify-2026!')
        manager_a = User.objects.create_user('zz_money_mgr_a', None, 'Money-Verify-2026!', role='branch_manager',
                                             branch=branch_a)
        manager_b = User.objects.create_user('zz_money_mgr_b', None, 'Money-Verify-2026!', role='branch_manager',
                                             branch=branch_b)
        api, api_a, api_b = client_for(admin), client_for(manager_a), client_for(manager_b)
        check('بندر تازه ردیف‌های همهٔ انواع پولی را گرفت',
              FieldConfig.objects.filter(branch=branch_a, money_type__isnull=False).count()
              == 4 * MoneyFieldType.objects.count())

        print('ج) نوع عاید تازه')
        response = api.post('/api/money-types/', {'name_fa': 'کمیشن خدمات آزمایشی', 'name_ps': 'د خدماتو کمیشن',
                                                  'name_en': 'ZZ service commission', 'kind': 'REVENUE',
                                                  'sort_order': 15}, format='json')
        revenue_type = MoneyFieldType.objects.filter(pk=response.data.get('id')).first()
        check('سوپر ادمین نوع عاید ساخت (کود از نام انگلیسی)',
              response.status_code == 201 and revenue_type is not None and revenue_type.code == 'ZZ_SERVICE_COMMISSION'
              and revenue_type.section == 'REVENUE', f'{response.status_code} {response.data}')
        source = revenue_type.source
        rows = FieldConfig.objects.filter(money_type=revenue_type)
        check('برای هر بندر × نوع تجارت یک ردیف «اختیاری»',
              rows.count() == 4 * Branch.objects.count() and set(rows.values_list('visibility', flat=True)) == {'OPTIONAL'},
              rows.count())
        line = StatementLine.objects.filter(source_field=source).first()
        check('سطر گزارش خودکار در بخش عاید', line is not None and line.section == 'REVENUE' and line.is_active
              and line.label_fa == 'کمیشن خدمات آزمایشی', line and (line.code, line.section))
        fields = form_fields(api_a, branch_a, 'IMPORT')
        check('form-config: نوع تازه با kind=REVENUE، بعد از پرداخت مشتری',
              source in fields and fields[source]['money']['kind'] == 'REVENUE'
              and fields['customer_payment']['money']['kind'] == 'REVENUE'
              and fields['customer_payment']['sort_order'] < fields[source]['sort_order'], fields.get(source))

        print('د) نوع مصرف تازه')
        response = api.post('/api/money-types/', {'name_fa': 'مصرف پارکنگ آزمایشی', 'name_en': 'ZZ parking',
                                                  'kind': 'EXPENSE', 'section': 'COGS', 'sort_order': 230},
                            format='json')
        expense_type = MoneyFieldType.objects.filter(pk=response.data.get('id')).first()
        check('نوع مصرف ساخته شد با سطر در بخش COGS',
              response.status_code == 201 and expense_type is not None
              and StatementLine.objects.filter(source_field=expense_type.source, section='COGS').exists(),
              response.status_code)
        bad = api.post('/api/money-types/', {'name_fa': 'x', 'kind': 'EXPENSE', 'section': 'REVENUE'}, format='json')
        check('مصرف در بخش عاید → ۴۰۰', bad.status_code == 400, bad.status_code)

        print('هـ) معامله با هر دو نوع')
        body = {'branch': branch_a.pk, 'trade_type': 'IMPORT', 'serial_number': 'ZZM-1', 'currency': 'USD',
                'exchange_rate': '70', 'customer_payment': '1000', 'khak_puli_cash': '100',
                'money_amounts': {revenue_type.code: '۲۵۰', expense_type.code: '50'}}
        response = api_a.post('/api/transactions/', body, format='json')
        tx = Transaction.objects.filter(serial_number='ZZM-1').first()
        check('معامله ثبت شد (رقم دری در مبلغ نوع تازه)', response.status_code == 201 and tx is not None,
              f'{response.status_code} {getattr(response, "data", "")}')
        check('بیلانس = (۱۰۰۰ + ۲۵۰) − (۱۰۰ + ۵۰) = ۱۱۰۰', tx.balance == D('1100'), tx.balance)
        summary = response.data['row_summary']
        check('row_summary: عاید ۸۷۵۰۰ افغانی / ۱۲۵۰ دالر، مصرف ۱۰۵۰۰، مفاد ۷۷۰۰۰',
              summary['total_revenue_afn'] == '87500.00' and summary['total_revenue_usd'] == '1250.00'
              and summary['total_expense_afn'] == '10500.00' and summary['profit_or_loss_afn'] == '77000.00',
              summary)
        items = {i['code']: i for i in response.data['money_items']}
        check('money_items: هر مبلغ با نوع و نام سه‌زبانه',
              items[revenue_type.code]['kind'] == 'REVENUE' and items[revenue_type.code]['amount_afn'] == '17500.00'
              and items[expense_type.code]['kind'] == 'EXPENSE' and 'CUSTOMER_PAYMENT' in items
              and items[revenue_type.code]['names']['ps'] == 'د خدماتو کمیشن', list(items))
        check('money_amounts برمی‌گردد', response.data['money_amounts'] == {revenue_type.code: '250.00',
                                                                         expense_type.code: '50.00'},
              response.data['money_amounts'])
        lines_before = TransactionMoneyLine.history.filter(transaction_id=tx.pk).count()
        response = api_a.patch(f'/api/transactions/{tx.pk}/', {'money_amounts': {expense_type.code: '0'}},
                               format='json')
        tx.refresh_from_db()
        check('ویرایش: مبلغ ۰ سطر را حذف می‌کند، بیلانس تازه، تاریخچه ثبت شد',
              response.status_code == 200 and tx.balance == D('1150')
              and not TransactionMoneyLine.objects.filter(transaction=tx, field_type=expense_type).exists()
              and TransactionMoneyLine.history.filter(transaction_id=tx.pk).count() == lines_before + 1,
              tx.balance)
        api_a.patch(f'/api/transactions/{tx.pk}/', {'money_amounts': {expense_type.code: '50'}}, format='json')
        tx.refresh_from_db()
        preview = api_a.post('/api/transactions/preview-summary/', {
            'branch': branch_a.pk, 'currency': 'USD', 'exchange_rate': '70', 'customer_payment': '1000',
            'khak_puli_cash': '100', 'money_amounts': {revenue_type.code: '250', expense_type.code: '50'}},
            format='json')
        check('preview-summary همان ارقام معاملهٔ ذخیره‌شده',
              preview.data['total_revenue_afn'] == '87500.00' and preview.data['profit_or_loss_afn'] == '77000.00'
              and tx.balance == D('1100'), preview.data)
        bad = api_a.post('/api/transactions/', {**body, 'serial_number': 'ZZM-X', 'money_amounts': {'NOPE': '1'}},
                         format='json')
        negative = api_a.post('/api/transactions/', {**body, 'serial_number': 'ZZM-Y',
                                                     'money_amounts': {revenue_type.code: '-5'}}, format='json')
        check('کود ناشناخته و مبلغ منفی → ۴۰۰', bad.status_code == 400 and negative.status_code == 400,
              f'{bad.status_code}/{negative.status_code}')

        print('و) گزارش، داشبورد، Excel، drill-down')
        report = income_statement(branch_a.pk, today, today)
        check('گزارش: سطر عاید تازه ۱۷۵۰۰، سطر مصرف تازه ۳۵۰۰ در COGS',
              line_amount(report, source) == ('REVENUE', '17500.00')
              and line_amount(report, expense_type.source) == ('COGS', '3500.00'),
              (line_amount(report, source), line_amount(report, expense_type.source)))
        check('عاید گزارش = پرداخت مشتری + عاید تازه = ۸۷۵۰۰', report['totals']['revenue_afn'] == '87500.00',
              report['totals']['revenue_afn'])
        dash = dashboard_summary(branch_a.pk)['current']
        check('داشبورد همان عاید و مفاد گزارش', dash['revenue_afn'] == report['summary']['revenue_afn']
              and dash['net_profit_afn'] == report['summary']['net_profit_afn'], dash['revenue_afn'])
        drill = api_a.get('/api/transactions/', {'nonzero': source})
        check('drill-down nonzero=@money:<کود> فقط همین معامله', [r['id'] for r in drill.data['results']] == [tx.pk],
              drill.data.get('count'))
        export = api_a.get('/api/transactions/export/', {'date_from': str(today), 'date_to': str(today)})
        sheet = load_workbook(BytesIO(export.content)).active
        headers = [c.value for c in sheet[4]]
        check('Excel معاملات: ستون نوع عاید و مصرف تازه + جمله عواید',
              'کمیشن خدمات آزمایشی (عاید)' in headers and 'مصرف پارکنگ آزمایشی (مصرف)' in headers
              and 'جمله عواید' in headers and not any('استراس' in str(h) for h in headers), len(headers))

        print('ز) تغییر نوع (kind)')
        Transaction.objects.update(revenue_estras=0)  # rolled back: «بدون داده» for the test
        response = api.patch(f'/api/money-types/{estras.pk}/', {'kind': 'REVENUE'}, format='json')
        estras.refresh_from_db()
        estras_line = StatementLine.objects.filter(source_field='revenue_estras').first()
        check('«بندر والی» بدون مبلغ → عاید شد؛ سطر گزارش به بخش عاید رفت؛ تاریخچه ثبت شد',
              response.status_code == 200 and estras.kind == 'REVENUE' and estras.section == 'REVENUE'
              and estras_line.section == 'REVENUE' and estras.history.first().kind == 'REVENUE',
              f'{response.status_code} {response.data}')
        tx.revenue_estras = D('10')
        tx.save()
        check('مبلغ «بندر والی» حالا به بیلانس اضافه می‌شود', tx.balance == D('1110'), tx.balance)
        response = api.patch(f'/api/money-types/{estras.pk}/', {'kind': 'EXPENSE'}, format='json')
        check('با مبلغ → ۴۰۹ با پیام دری', response.status_code == 409 and 'معامله' in response.data['detail'],
              response.status_code)
        tx.revenue_estras = D('0')
        tx.save()
        response = api.patch(f'/api/money-types/{estras.pk}/', {'kind': 'EXPENSE', 'section': 'COGS'}, format='json')
        check('دوباره مصرف (بدون مبلغ) → ۲۰۰، سطر به COGS برگشت', response.status_code == 200
              and StatementLine.objects.get(source_field='revenue_estras').section == 'COGS', response.status_code)
        locked = api.patch(f'/api/money-types/{builtins["customer_payment"].pk}/', {'kind': 'EXPENSE'}, format='json')
        off = api.patch(f'/api/money-types/{builtins["customer_payment"].pk}/', {'is_active': False}, format='json')
        check('پرداخت مشتری: تغییر نوع ۴۰۹، غیرفعال ۴۰۰', locked.status_code == 409 and off.status_code == 400,
              f'{locked.status_code}/{off.status_code}')
        response = api.post('/api/money-types/bulk/', {'types': [
            {'id': revenue_type.pk, 'name_fa': 'نام تازهٔ آزمایشی'}, {'id': revenue_type.pk, 'kind': 'EXPENSE'}]},
            format='json')
        revenue_type.refresh_from_db()
        check('bulk همه یا هیچ: تغییر نوع با مبلغ ۴۰۹ و نام هم ذخیره نشد',
              response.status_code == 409 and revenue_type.name_fa == 'کمیشن خدمات آزمایشی', response.status_code)
        response = api.post('/api/money-types/bulk/', {'types': [
            {'id': revenue_type.pk, 'name_fa': 'کمیشن خدمات', 'sort_order': 12}]}, format='json')
        check('تغییر نام → برچسب سطر گزارش و فورم هم عوض شد', response.status_code == 200
              and StatementLine.objects.get(source_field=source).label_fa == 'کمیشن خدمات'
              and form_fields(api_a, branch_a, 'IMPORT')[source]['label_fa'] == 'کمیشن خدمات', response.data)

        print('ح) نمایش برای هر بندر × نوع تجارت')
        response = api.post('/api/money-types/bulk/', {'visibility': {
            'branch': branch_a.pk, 'trade_type': 'IMPORT',
            'rows': [{'money_type': revenue_type.pk, 'visibility': 'REQUIRED'},
                     {'money_type': builtins['khak_puli_bank'].pk, 'visibility': 'HIDDEN'}]}}, format='json')
        fields_a, fields_b = form_fields(api_a, branch_a, 'IMPORT'), form_fields(api_b, branch_b, 'IMPORT')
        check('بندر الف: نوع تازه «لازم»، خاک‌پولی بانکی مخفی؛ بندر ب بدون تغییر',
              response.status_code == 200 and fields_a[source]['required'] and 'khak_puli_bank' not in fields_a
              and not fields_b[source]['required'] and 'khak_puli_bank' in fields_b, response.data)
        missing = api_a.post('/api/transactions/', {**body, 'serial_number': 'ZZM-2', 'money_amounts': {}},
                             format='json')
        with_it = api_a.post('/api/transactions/', {**body, 'serial_number': 'ZZM-3'}, format='json')
        check('«لازم» در API هم اجرا می‌شود: بدون مبلغ ۴۰۰، با مبلغ ۲۰۱',
              missing.status_code == 400 and 'money_amounts' in missing.data and with_it.status_code == 201,
              f'{missing.status_code}/{with_it.status_code}')
        lock = api.post('/api/money-types/bulk/', {'visibility': {
            'branch': branch_a.pk, 'trade_type': 'IMPORT',
            'rows': [{'money_type': builtins['customer_payment'].pk, 'visibility': 'HIDDEN'}]}}, format='json')
        check('پرداخت مشتری را مخفی کرده نمی‌توانید → ۴۰۰', lock.status_code == 400, lock.status_code)
        response = api.post('/api/money-types/bulk/', {'visibility': {
            'branch': branch_a.pk, 'trade_type': 'IMPORT', 'all_branches': True, 'all_trade_types': True,
            'rows': [{'money_type': expense_type.pk, 'visibility': 'HIDDEN'}]}}, format='json')
        check('«اعمال به همهٔ بندرها و انواع تجارت»',
              response.status_code == 200 and set(FieldConfig.objects.filter(money_type=expense_type)
                                                   .values_list('visibility', flat=True)) == {'HIDDEN'},
              response.data)
        visibility = {r['code']: r for r in api.get('/api/money-types/visibility/',
                                                    {'branch': branch_a.pk, 'trade_type': 'IMPORT'}).data}
        check('visibility/: وضعیت و تعداد معاملات دارای مبلغ در همین بندر × نوع',
              visibility[revenue_type.code]['visibility'] == 'REQUIRED' and visibility[revenue_type.code]['count'] == 2
              and visibility['CUSTOMER_PAYMENT']['count'] == 2, visibility[revenue_type.code])
        listed = {t['code']: t for t in api.get('/api/money-types/').data}
        check('فهرست: تعداد کل معاملات دارای مبلغ (برای هشدار)', listed[revenue_type.code]['amounts_count'] == 2,
              listed[revenue_type.code]['amounts_count'])

        print('ط) غیرفعال و حذف')
        api.patch(f'/api/money-types/{expense_type.pk}/', {'is_active': False}, format='json')
        report = income_statement(branch_a.pk, today, today)
        check('غیرفعال: از فورم رفت، مبلغ قبلی در گزارش و جزئیات ماند',
              expense_type.source not in form_fields(api_a, branch_a, 'EXPORT')
              and line_amount(report, expense_type.source) == ('COGS', '7000.00')  # ZZM-1 + ZZM-3
              and any(i['code'] == expense_type.code for i in api_a.get(f'/api/transactions/{tx.pk}/').data['money_items']))
        new_amount = api_a.patch(f'/api/transactions/{tx.pk}/', {'money_amounts': {expense_type.code: '60'}},
                                 format='json')
        check('برای نوع غیرفعال مبلغ تازه ثبت نمی‌شود → ۴۰۰', new_amount.status_code == 400, new_amount.status_code)
        used = api.delete(f'/api/money-types/{expense_type.pk}/')
        builtin_delete = api.delete(f'/api/money-types/{builtins["seal_expense"].pk}/')
        check('حذف نوع دارای مبلغ ۴۰۹؛ حذف نوع داخلی ۴۰۹', used.status_code == 409 and builtin_delete.status_code == 409,
              f'{used.status_code}/{builtin_delete.status_code}')
        spare = api.post('/api/money-types/', {'name_fa': 'نوع بی‌مبلغ آزمایشی', 'kind': 'EXPENSE',
                                               'section': 'OTHER'}, format='json').data
        spare_source = f"@money:{spare['code']}"
        gone = api.delete(f"/api/money-types/{spare['id']}/")
        check('نوع بی‌مبلغ حذف شد؛ سطر گزارش و ردیف‌های فورم هم رفتند',
              gone.status_code == 204 and not StatementLine.objects.filter(source_field=spare_source).exists()
              and not FieldConfig.objects.filter(field_name=spare_source).exists(), gone.status_code)

        print('ی) عواید دفتر')
        response = api.post('/api/office-income-categories/', {'name_fa': 'کتگوری آزمایشی', 'name_en': 'ZZ test cat'},
                            format='json')
        category = OfficeIncomeCategory.objects.filter(pk=response.data.get('id')).first()
        check('کتگوری تازه با سطر «سایر عواید»', response.status_code == 201 and StatementLine.objects.filter(
            source_field=category.source, section='OTHER_INCOME').exists(), response.status_code)
        income_body = {'branch': branch_b.pk, 'date': str(today), 'category': category.code, 'amount': '۱۰۰',
                       'currency': 'USD', 'person': 'آزمایشی', 'reference_number': '۴۵'}
        response = api_a.post('/api/office-incomes/', income_body, format='json')
        income = OfficeIncome.objects.filter(pk=response.data.get('id')).first()
        check('مدیر بندر عاید دفتر ثبت کرد — همیشه در بندر خودش؛ رقم دری؛ نرخ روز ذخیره شد',
              response.status_code == 201 and income.branch == branch_a and income.amount == D('100')
              and income.reference_number == '45' and income.rate_used == D('70')
              and response.data['amount_afn'] == '7000.00', f'{response.status_code} {response.data}')
        ExchangeRate.objects.filter(date=today, currency='USD').update(rate=D('80'))
        income.refresh_from_db()
        check('تغییر بعدی نرخ عاید قبلی را تغییر نمی‌دهد', income.rate_used == D('70'), income.rate_used)
        ExchangeRate.objects.filter(date=today, currency='USD').update(rate=D('70'))
        other_view = api_b.get(f'/api/office-incomes/{income.pk}/')
        other_list = api_b.get('/api/office-incomes/')
        check('مدیر بندر دیگر نمی‌بیند (۴۰۴، فهرست خالی)', other_view.status_code == 404
              and other_list.data['count'] == 0, other_view.status_code)
        listing = api_a.get('/api/office-incomes/', {'date_from': str(today), 'date_to': str(today)})
        report = income_statement(branch_a.pk, today, today)
        check('«سایر عواید» گزارش = جمع صفحهٔ عواید دفتر = ۷۰۰۰',
              line_amount(report, category.source) == ('OTHER_INCOME', '7000.00')
              and report['totals']['other_income_afn'] == listing.data['totals']['afn'] == '7000.00'
              and listing.data['totals']['groups'][category.code]['afn'] == '7000.00', listing.data['totals'])
        net = report['totals']
        check('مفاد خالص = ناخالص − عملیاتی − سایر مصارف + سایر عواید',
              D(net['net_profit_afn']) == D(net['gross_profit_afn']) - D(net['opex_afn']) - D(net['other_afn'])
              + D(net['other_income_afn']), net['net_profit_afn'])
        dash = dashboard_summary(branch_a.pk)['current']
        check('داشبورد: «عواید دفتر این ماه»', dash['other_income_afn'] == '7000.00', dash['other_income_afn'])
        drill = api_a.get('/api/office-incomes/', {'category': category.code.lower()})
        check('drill-down ?category=<کود>', drill.data['count'] == 1, drill.data['count'])
        ExchangeRate.objects.filter(date=today, currency='USD').delete()
        blocked = api_a.post('/api/office-incomes/', income_body, format='json')
        ExchangeRate.objects.create(date=today, currency='USD', rate=D('70'))
        check('بدون نرخ امروز → ۴۲۸ TODAY_RATE_MISSING', blocked.status_code == 428
              and blocked.data.get('code') == 'TODAY_RATE_MISSING', blocked.status_code)
        history = api_a.get(f'/api/office-incomes/{income.pk}/history/')
        protected = api.delete(f'/api/office-income-categories/{category.pk}/')
        check('تاریخچه دارد؛ کتگوری دارای عاید حذف نمی‌شود (۴۰۹)',
              history.status_code == 200 and len(history.data) == 1 and protected.status_code == 409,
              f'{history.status_code}/{protected.status_code}')
        OfficeExpense.objects.create(branch=branch_a, date=today, category='RENT', amount=D('1400'), currency='AFN')
        expenses = api_a.get('/api/office-expenses/', {'date_from': str(today), 'date_to': str(today)}).data['totals']
        report = income_statement(branch_a.pk, today, today)
        check('مصارف دفتر صفحه = سطرهای OPEX گزارش', expenses['non_salary']['afn']
              == line_amount(report, '@office_expense')[1], expenses['non_salary'])

        print('ک) قاعدهٔ یگانه: جمع بیلانس معاملات = عاید − مصارف معامله در گزارش')
        everything = income_statement(None, jdatetime.date(1390, 1, 1), jdatetime.date(1410, 12, 29))
        tx_sources = set(Transaction.MONEY_COLUMNS) | {t.source for t in MoneyFieldType.objects.filter(column='')}
        expense_lines = sum(D(line['amount_afn']) for line in everything['lines']
                            if line['source_field'] in tx_sources and line['section'] != 'REVENUE')
        balances = sum(t.profit_or_loss_afn for t in Transaction.objects.all())
        check('Σ بیلانس (افغانی) = عاید گزارش − مصارف معامله‌ای گزارش',
              D(everything['totals']['revenue_afn']) - expense_lines == balances,
              f"{everything['totals']['revenue_afn']} − {expense_lines} vs {balances}")
        if not MoneyFieldType.objects.filter(kind='EXPENSE', section='OPEX').exists():
            check('با بخش‌های پیش‌فرض: عاید − COGS − سایر مصارف = Σ بیلانس',
                  D(everything['totals']['revenue_afn']) - D(everything['totals']['cogs_afn'])
                  - D(everything['totals']['other_afn']) == balances)
        unmapped = [w for w in everything['warnings'] if 'هیچ سطر فعالی' in w]
        check('هیچ منبعی بدون سطر فعال نیست', not unmapped, unmapped)

        print('ل) مدیر بندر')
        denied = [api_a.post('/api/money-types/', {'name_fa': 'x', 'kind': 'REVENUE'}, format='json').status_code,
                  api_a.post('/api/money-types/bulk/', {'types': [{'id': revenue_type.pk, 'name_fa': 'x'}]},
                             format='json').status_code,
                  api_a.get('/api/money-types/visibility/', {'branch': branch_a.pk, 'trade_type': 'IMPORT'}).status_code,
                  api_a.delete(f'/api/money-types/{revenue_type.pk}/').status_code,
                  api_a.post('/api/office-income-categories/', {'name_fa': 'x'}, format='json').status_code]
        check('مدیر بندر انواع و کتگوری‌ها را تغییر داده نمی‌تواند (۴۰۳)، ولی می‌خواند',
              denied == [403] * 5 and api_a.get('/api/money-types/').status_code == 200, denied)

        print('م) فهرست بدون N+1')

        def list_queries(size):
            with CaptureQueriesContext(connection) as ctx:
                api_a.get('/api/transactions/', {'page_size': size})
            return len(ctx.captured_queries)
        for i in range(4, 12):
            Transaction.objects.create(branch=branch_a, trade_type='IMPORT', serial_number=f'ZZM-{i}',
                                       customer_payment=D(i))
        small, large = list_queries(2), list_queries(10)
        check('تعداد query فهرست به اندازهٔ صفحه وابسته نیست', small == large, f'{small} vs {large}')

        raise Rollback
except Rollback:
    pass

after = counts()
check('همهٔ داده‌های آزمایشی rollback شد', before == after, f'before={before}, after={after}')
print()
if failures:
    print(f'{len(failures)} تست ناکام:')
    for failure in failures:
        print('  -', failure)
    sys.exit(1)
print(f'همهٔ {number} تست موفق بود.')
