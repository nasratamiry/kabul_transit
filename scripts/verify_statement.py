"""
Verify stage 8: StatementLine, seed_statement_lines, income_statement(), and the API.

    .venv\\Scripts\\python scripts\\verify_statement.py

Runs against the configured database inside one DB transaction that is rolled
back at the end, so no test data is left behind (real statement lines are
restored too). Uses a fixed past period (Shahrivar 1405) so results do not
depend on today's date.
"""
import os
import sys
from decimal import Decimal
from io import StringIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'kabulcargo_backend.settings')
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

import django  # noqa: E402

django.setup()

import jdatetime  # noqa: E402
from django.core.exceptions import ValidationError  # noqa: E402
from django.core.management import call_command  # noqa: E402
from django.db import IntegrityError, transaction  # noqa: E402
from django.test import Client  # noqa: E402
from rest_framework.test import APIClient  # noqa: E402

from accounts.models import Branch, User  # noqa: E402
from finance.management.commands.seed_statement_lines import STANDARD_LINES  # noqa: E402
from finance.models import ExchangeRate, Hawala, OfficeExpense, StatementLine, statement_source_choices  # noqa: E402
from finance.reports import current_shamsi_month, income_statement  # noqa: E402
from finance.utils import kabul_today  # noqa: E402
from operations.models import Transaction  # noqa: E402

PASSWORD = 'Kabul-Statement-2026!'
D = Decimal
failures = []
number = 0


def check(label, ok, detail=''):
    global number
    number += 1
    print(f"  [{'OK' if ok else 'FAIL'}] {number:02d}. {label}{(' — ' + detail) if detail else ''}")
    if not ok:
        failures.append(f'{number:02d}. {label}')


def j(text):
    return jdatetime.date(*(int(part) for part in text.split('-')))


def invalid(line, field):
    """True if full_clean() rejects the line with an error on `field`."""
    try:
        line.full_clean()
    except ValidationError as exc:
        return field in exc.message_dict
    return False


def seed(**options):
    out = StringIO()
    call_command('seed_statement_lines', stdout=out, **options)
    numbers = [int(n) for n in __import__('re').findall(r': (\d+)', out.getvalue())]
    return dict(zip(('created', 'updated', 'unchanged'), numbers))


def line_of(report, code):
    return next((line for line in report['lines'] if line['code'] == code), None)


def counts():
    return (StatementLine.objects.count(), StatementLine.history.count(), Transaction.objects.count(),
            Branch.objects.count(), ExchangeRate.objects.count(), OfficeExpense.objects.count(), Hawala.objects.count())


class Rollback(Exception):
    pass


before = counts()
JUNE = (j('1405-06-01'), j('1405-06-31'))

try:
    with transaction.atomic():
        StatementLine.history.all().delete()
        StatementLine.objects.all().delete()  # fresh start inside the rollback

        print('الف) مدل StatementLine')
        result = seed()
        rev = StatementLine.objects.get(code='REV_CUST_PAY')
        rev.label_en = 'Customer payments'
        rev.save()
        check('StatementLine تاریخچه دارد (ساختن با bulk + ویرایش = ۲ ردیف)', rev.history.count() == 2,
              f'{rev.history.count()} rows')
        try:
            with transaction.atomic():
                StatementLine.objects.create(code='REV_CUST_PAY', section='OTHER', source_field='seal_expense',
                                             label_fa='تکراری', is_active=False)
            check('code تکراری → IntegrityError', False)
        except IntegrityError:
            check('code تکراری → IntegrityError', True)
        try:
            with transaction.atomic():
                StatementLine.objects.create(code='BAD_SECTION', section='BOGUS', source_field='seal_expense',
                                             label_fa='x', is_active=False)
            check('بخش نامعتبر → CheckConstraint در MySQL', False)
        except IntegrityError as exc:
            check('بخش نامعتبر → CheckConstraint در MySQL', 'statementline_section_valid' in str(exc), str(exc)[:80])
        check('REVENUE با منبعی غیر از customer_payment → ValidationError',
              invalid(StatementLine(code='REV_X', section='REVENUE', source_field='seal_expense', label_fa='x'),
                      'source_field'))
        check('منبعی که فیلد پولی معامله نیست → ValidationError',
              invalid(StatementLine(code='COGS_X', section='COGS', source_field='plate_afghan', label_fa='x'),
                      'source_field')
              and invalid(StatementLine(code='COGS_Y', section='COGS', source_field='fake_field', label_fa='x'),
                          'source_field'))
        check('code با حروف کوچک → ValidationError',
              invalid(StatementLine(code='cogs_lower', section='COGS', source_field='seal_expense', label_fa='x',
                                    is_active=False), 'code'))
        check('customer_payment بیرون از REVENUE → ValidationError (یگانه عاید)',
              invalid(StatementLine(code='COGS_PAY', section='COGS', source_field='customer_payment', label_fa='x',
                                    is_active=False), 'section'))
        check('دو سطر فعال با یک منبع → ValidationError (دوبار شمردن)',
              invalid(StatementLine(code='COGS_SEAL2', section='COGS', source_field='seal_expense', label_fa='x'),
                      'source_field'))

        print('ب) دستور seed')
        check(f'seed تازه → {len(STANDARD_LINES)} سطر ساخته شد', result.get('created') == len(STANDARD_LINES),
              str(result))
        gate = StatementLine.objects.get(code='COGS_GATE')
        gate.label_fa = 'برچسب سفارشی'
        gate.save()
        again = seed()
        gate.refresh_from_db()
        check('اجرای دوباره → ۰ تازه، بی‌تکرار، تغییر سوپر ادمین سالم ماند',
              again.get('created') == 0 and StatementLine.objects.count() == len(STANDARD_LINES)
              and gate.label_fa == 'برچسب سفارشی', str(again))
        reset = seed(reset=True)
        gate.refresh_from_db()
        check('--reset پیش‌فرض‌ها را برمی‌گرداند', reset.get('updated') == 2 and gate.label_fa == 'تکت دروازه',
              str(reset))
        valid = dict(statement_source_choices())
        sources = [row[2] for row in STANDARD_LINES]
        check('همهٔ منابع seed واقعی هستند و هر فیلد مصرف معامله دقیقاً یک بار آمده',
              all(source in valid for source in sources) and len(set(sources)) == len(sources)
              and set(Transaction.EXPENSE_FIELDS) <= set(sources))

        print('ج) سرویس income_statement()')
        branch_a = Branch.objects.create(name='بندر آزمایشی الف', code='ZZSTA')
        branch_b = Branch.objects.create(name='بندر آزمایشی ب', code='ZZSTB')
        ExchangeRate.objects.filter(date__gte=j('1405-05-01'), date__lte=j('1405-07-30')).delete()
        ExchangeRate.objects.create(date=j('1405-06-01'), currency='USD', rate=D('70'))
        ExchangeRate.objects.update_or_create(date=kabul_today(), currency='USD', defaults={'rate': D('90')})

        empty = income_statement(branch_a.pk, j('1404-01-01'), j('1404-01-31'))
        check('بازهٔ خالی → همه صفر، بدون خطا',
              all(value == '0.00' for value in empty['totals'].values()) and len(empty['lines']) == len(STANDARD_LINES),
              f"net={empty['totals']['net_profit_afn']}")

        def tx(serial, day, currency, rate=D('1'), branch=branch_a, **amounts):
            return Transaction.objects.create(branch=branch, trade_type='EXPORT', serial_number=serial, date=j(day),
                                              currency=currency, exchange_rate=rate, **amounts)

        t1 = tx('ST-1', '1405-06-05', 'AFN', customer_payment=D('10000'), transit_right=D('5000'))
        one_day = income_statement(branch_a.pk, j('1405-06-05'), j('1405-06-05'))
        rev_line = line_of(one_day, 'REV_CUST_PAY')
        check('یک معامله: پرداخت مشتری 10000 افغانی، نرخ دالر آن روز 70 → 10000 AFN و 142.86 USD',
              rev_line['amount_afn'] == '10000.00' and rev_line['amount_usd'] == '142.86', str(rev_line))
        check('مصرف مستقیم (حق‌العبور) 5000 → سطر COGS = 5000 AFN',
              line_of(one_day, 'COGS_TRANSIT_RIGHT')['amount_afn'] == '5000.00')

        tx('ST-2', '1405-06-10', 'USD', D('70'), customer_payment=D('1000'), tariff_expense=D('200'),
           demurrage_truck=D('50'))
        tx('ST-3', '1405-06-15', 'PKR', D('0.25'), customer_payment=D('80000'), expense_labor=D('8000'))
        OfficeExpense.objects.create(branch=branch_a, date=j('1405-06-12'), category='RENT', amount=D('2000'),
                                     currency='AFN')
        OfficeExpense.objects.create(branch=branch_a, date=j('1405-06-12'), category='SALARY', amount=D('100'),
                                     currency='USD')
        Hawala.objects.create(branch=branch_a, date=j('1405-06-20'), from_party='الف', to_party='ب',
                              amount=D('10000'), fee=D('500'), currency='AFN')
        tx('ST-OUT', '1405-07-02', 'AFN', customer_payment=D('99999'))
        tx('ST-B', '1405-06-10', 'AFN', branch=branch_b, customer_payment=D('30000'))

        month = income_statement(branch_a.pk, *JUNE)
        totals = month['totals']
        # revenue 10000 + 1000×70 + 80000×0.25 = 100000 AFN; COGS 5000 + 200×70 + 8000×0.25 = 21000
        check('سود ناخالص = عاید − مصارف مستقیم (۳ معامله، ۳ ارز)',
              totals['revenue_afn'] == '100000.00' and totals['cogs_afn'] == '21000.00'
              and totals['gross_profit_afn'] == '79000.00' and totals['gross_profit_usd'] == '1128.57',
              f"{totals['revenue_afn']} − {totals['cogs_afn']} = {totals['gross_profit_afn']} AFN "
              f"/ {totals['gross_profit_usd']} USD")
        # OPEX 2000 + 100×70 + 500 = 9500; OTHER 50×70 = 3500
        check('سود خالص = سود ناخالص − OPEX − OTHER',
              totals['opex_afn'] == '9500.00' and totals['other_afn'] == '3500.00'
              and totals['net_profit_afn'] == '66000.00' and totals['net_profit_usd'] == '942.86',
              f"79000 − {totals['opex_afn']} − {totals['other_afn']} = {totals['net_profit_afn']} AFN "
              f"/ {totals['net_profit_usd']} USD")
        check('مصرف دفتر 2000 افغانی → OPEX_OFFICE = 2000 AFN',
              line_of(month, 'OPEX_OFFICE')['amount_afn'] == '2000.00')
        check('مصرف حواله (fee) 500 افغانی → OPEX_HAWALA_FEE = 500 AFN',
              line_of(month, 'OPEX_HAWALA_FEE')['amount_afn'] == '500.00')
        check('معامله بیرون از بازه حساب نشد', month['transactions_count'] == 3 and '99999' not in str(month))
        all_branches = income_statement(None, *JUNE)
        check('معاملهٔ بندر دیگر با فیلتر بندر حساب نشد (و بدون فیلتر حساب شد)',
              totals['revenue_afn'] == '100000.00' and all_branches['totals']['revenue_afn'] == '130000.00',
              f"A={totals['revenue_afn']}, all={all_branches['totals']['revenue_afn']}")
        balances = sum(t.profit_or_loss_afn for t in Transaction.objects.filter(branch=branch_a, date__range=JUNE))
        check('عاید − COGS − OTHER = جمع بیلانس معاملات (هیچ مصرفی جا نماند)',
              D(totals['gross_profit_afn']) - D(totals['other_afn']) == balances, f'{balances}')
        check('معاش دالری بدون نرخ ثبت‌شده در آن روز → نرخ آخرین روز قبل (70)',
              line_of(month, 'OPEX_SALARY')['amount_afn'] == '7000.00')

        StatementLine.objects.filter(code='OTH_DEMURRAGE_TRUCK').update(is_active=False)
        inactive = income_statement(branch_a.pk, *JUNE)
        check('سطر غیرفعال در گزارش نیست (و هشدار «منبع بی‌سطر» می‌آید)',
              line_of(inactive, 'OTH_DEMURRAGE_TRUCK') is None and inactive['totals']['other_afn'] == '0.00'
              and any('demurrage_truck' in warning for warning in inactive['warnings']))
        StatementLine.objects.filter(code='OTH_DEMURRAGE_TRUCK').update(is_active=True)

        check('دالر با نرخ همان روز معامله، نه نرخ امروز (امروز = 90)',
              line_of(month, 'REV_CUST_PAY')['amount_usd'] == '1428.57'
              and income_statement(branch_a.pk, *JUNE)['totals'] == totals,
              f"USD revenue={line_of(month, 'REV_CUST_PAY')['amount_usd']}")
        tx('ST-NORATE', '1404-02-10', 'AFN', customer_payment=D('7000'))
        no_rate = income_statement(branch_a.pk, j('1404-02-01'), j('1404-02-31'))
        check('بدون هیچ نرخ دالر → ستون دالر خالی (None) با هشدار، نه عدد غلط',
              line_of(no_rate, 'REV_CUST_PAY')['amount_usd'] is None
              and no_rate['totals']['revenue_afn'] == '7000.00' and no_rate['warnings'])
        default = income_statement(branch_a.pk)
        first, last = current_shamsi_month()
        check('بدون تاریخ → ماه جاری شمسی', default['period']['from'] == str(first)
              and default['period']['to'] == str(last), f"{default['period']['from']} … {default['period']['to']}")

        print('د) API')
        admin = User.objects.create_user('zz_st_admin', password=PASSWORD, role='super_admin', is_staff=True,
                                         is_superuser=True)
        manager = User.objects.create_user('zz_st_mgr', password=PASSWORD, role='branch_manager', branch=branch_a)
        admin_api, manager_api = APIClient(HTTP_HOST='127.0.0.1'), APIClient(HTTP_HOST='127.0.0.1')
        admin_api.force_authenticate(admin)
        manager_api.force_authenticate(manager)
        june = {'date_from': '1405-06-01', 'date_to': '1405-06-31'}

        forced = manager_api.get('/api/income-statement/', {**june, 'branch': branch_b.pk})
        check('مدیر بندر با ?branch=بندر دیگر → گزارش بندر خودش + هشدار',
              forced.status_code == 200 and forced.data['branch']['id'] == branch_a.pk
              and forced.data['totals']['revenue_afn'] == '100000.00' and forced.data['warnings'],
              f"status={forced.status_code}")
        everything = admin_api.get('/api/income-statement/', june)
        check('سوپر ادمین بدون branch → همهٔ بندرها',
              everything.status_code == 200 and everything.data['branch'] is None
              and everything.data['totals']['revenue_afn'] == '130000.00' and 'generated_at' in everything.data,
              f"revenue={everything.data.get('totals', {}).get('revenue_afn')}")
        dari = admin_api.get('/api/income-statement/', {'date_from': '۱۴۰۵-۰۶-۰۱', 'date_to': '۱۴۰۵-۰۶-۳۱',
                                                         'branch': '{}'.format(branch_a.pk)})
        gregorian = admin_api.get('/api/income-statement/', {'date_from': '2026-08-23', 'date_to': '2026-09-22',
                                                              'branch': branch_a.pk})
        check('تاریخ شمسی با ارقام دری (۱۴۰۵-۰۶-۰۱) و تاریخ میلادی قبول شد',
              dari.status_code == 200 and dari.data['period']['from'] == '1405-06-01'
              and dari.data['totals'] == gregorian.data['totals'],
              f"dari={dari.status_code}, gregorian={gregorian.status_code}")
        too_long = admin_api.get('/api/income-statement/', {'date_from': '1402-01-01', 'date_to': '1405-01-01'})
        check('بازه بیشتر از دو سال → ۴۰۰ با پیام دری',
              too_long.status_code == 400 and 'دو سال' in too_long.data['detail'])
        half = admin_api.get('/api/income-statement/', {'date_from': '1405-06-01'})
        check('فقط date_from بدون date_to → ۴۰۰', half.status_code == 400, half.data.get('detail', ''))
        backwards = admin_api.get('/api/income-statement/', {'date_from': '1405-06-31', 'date_to': '1405-06-01'})
        check('date_from بعد از date_to → ۴۰۰', backwards.status_code == 400)

        line = StatementLine.objects.get(code='COGS_SEAL')
        denied = manager_api.get('/api/statement-lines/')
        bad = admin_api.post('/api/statement-lines/', {'section': 'REVENUE', 'code': 'REV_BAD', 'label_fa': 'x',
                                                       'source_field': 'seal_expense'}, format='json')
        patched = admin_api.patch(f'/api/statement-lines/{line.pk}/', {'sort_order': 151}, format='json')
        history = admin_api.get(f'/api/statement-lines/{line.pk}/history/')
        check('/api/statement-lines/: مدیر بندر ۴۰۳، قانون عاید در API، ویرایش + تاریخچه با نام کاربر',
              denied.status_code == 403 and bad.status_code == 400 and patched.status_code == 200
              and history.status_code == 200 and history.data[0]['user'] == 'zz_st_admin',
              f'manager={denied.status_code}, bad={bad.status_code}, patch={patched.status_code}, '
              f'history={len(history.data) if history.status_code == 200 else history.status_code}')

        browser = Client(HTTP_HOST='127.0.0.1')
        browser.force_login(admin)
        page = browser.get('/admin/finance/statementline/')
        check('پنل ادمین سطرها باز است و دری است',
              page.status_code == 200 and 'سطرهای صورت حساب عاید' in page.content.decode(), f'{page.status_code}')

        raise Rollback
except Rollback:
    pass

print('هـ) پاک‌کاری')
after = counts()
check('هیچ دادهٔ آزمایشی نماند و سطرهای واقعی برگشت', before == after, f'before={before}, after={after}')

print()
if failures:
    print('ناکام:', ', '.join(failures))
    sys.exit(1)
print(f'همهٔ {number} تست موفق بود.')
