"""
Verify the finance app (ExchangeRate, Hawala, OfficeExpense, daily-rate soft lock).

    .venv\\Scripts\\python scripts\\verify_finance.py

Runs against the configured database inside one DB transaction that is rolled
back at the end, so no test data is left behind. Safe to run on live data:
any real rates for today/yesterday are hidden only inside the rolled-back
transaction.
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

from django.core.exceptions import ValidationError  # noqa: E402
from django.db import IntegrityError, transaction  # noqa: E402
from django.test import Client  # noqa: E402

from accounts.models import Branch, User  # noqa: E402
from finance.models import ExchangeRate, Hawala, OfficeExpense  # noqa: E402
from finance.utils import TodayRateMissing, kabul_today, require_todays_usd_rate  # noqa: E402

failures = []


def check(label, ok, detail=''):
    print(f"  [{'OK' if ok else 'FAIL'}] {label}{(' — ' + detail) if detail else ''}")
    if not ok:
        failures.append(label)


def validation_error(obj):
    """Run full_clean and return the error dict, or None if valid."""
    try:
        obj.full_clean()
    except ValidationError as exc:
        return exc.message_dict
    return None


def counts():
    return (ExchangeRate.objects.count(), Hawala.objects.count(), OfficeExpense.objects.count(),
            ExchangeRate.history.count(), Hawala.history.count(), OfficeExpense.history.count())


class Rollback(Exception):
    pass


before = counts()
today = kabul_today()
yesterday, tomorrow = today - timedelta(days=1), today + timedelta(days=1)

try:
    with transaction.atomic():
        ExchangeRate.objects.filter(date__in=[today, yesterday]).delete()  # start clean (rolled back)
        branch = Branch.objects.create(name='بندر آزمایشی مالی', code='ZZFIN')

        print('۱. نرخ اسعار (ExchangeRate)')
        usd_today = ExchangeRate(date=today, currency='USD', rate=Decimal('70.5'))
        check('USD today 70.5 valid', validation_error(usd_today) is None)
        usd_today.save()

        errors = validation_error(ExchangeRate(date=tomorrow, currency='USD', rate=Decimal('71')))
        check('tomorrow rejected', errors is not None and 'نمی‌توان برای تاریخ آینده نرخ ثبت کرد.' in errors.get('date', []),
              str(errors))
        errors = validation_error(ExchangeRate(date=yesterday, currency='EUR', rate=Decimal('0')))
        check('rate=0 rejected', errors is not None and 'rate' in errors, str(errors))

        usd_yesterday = ExchangeRate(date=yesterday, currency='USD', rate=Decimal('70'))
        check('USD yesterday 70 valid', validation_error(usd_yesterday) is None)
        usd_yesterday.save()

        try:
            with transaction.atomic():
                ExchangeRate.objects.create(date=today, currency='USD', rate=Decimal('72'))
            check('duplicate (date, currency) blocked', False)
        except IntegrityError:
            check('duplicate (date, currency) blocked', True, 'IntegrityError')

        print('۲. قفل نرم نرخ روز')
        admin_user = User.objects.create_superuser('zz_verify_fin', None, 'Verify-Pass-123')
        client = Client(HTTP_HOST='127.0.0.1')
        client.force_login(admin_user)

        usd_today.delete()
        try:
            require_todays_usd_rate()
            check('missing rate raises TodayRateMissing', False)
        except TodayRateMissing as exc:
            check('missing rate raises TodayRateMissing', exc.code == 'TODAY_RATE_MISSING', exc.code)
        locked = [client.get(url) for url in ('/admin/finance/officeexpense/add/', '/admin/finance/hawala/add/',
                                              '/admin/operations/transaction/add/')]
        check('admin add forms redirect to rate form',
              all(r.status_code == 302 and '/admin/finance/exchangerate/add/' in r['Location'] for r in locked),
              locked[0].get('Location', ''))

        response = client.post(locked[0]['Location'], {'date': str(today), 'currency': 'USD', 'rate': '۷۰٫۵'})
        usd_today = ExchangeRate.objects.filter(date=today, currency='USD').first()
        check('rate form (Dari digits) saves and returns to expense form',
              usd_today is not None and usd_today.rate == Decimal('70.5') and usd_today.created_by == admin_user
              and response.status_code == 302 and response['Location'] == '/admin/finance/officeexpense/add/',
              f"status={response.status_code}, to={response.get('Location')}")
        check('require_todays_usd_rate returns the rate', require_todays_usd_rate() == usd_today)

        print('۳. مصرف دفتر (OfficeExpense)')
        oe_afn = OfficeExpense(branch=branch, date=today, category='SALARY', amount=Decimal('12400'),
                               currency='AFN', person='حبیب', bill_number='۱۲۳')
        check('AFN expense valid', validation_error(oe_afn) is None)
        oe_afn.save()
        check('bill number digits normalized', oe_afn.bill_number == '123', repr(oe_afn.bill_number))
        check('AFN: no rate, amount_afn = amount', oe_afn.rate_used is None and oe_afn.amount_afn == Decimal('12400'))

        oe_usd = OfficeExpense.objects.create(branch=branch, date=today, category='RENT', amount=Decimal('100'),
                                              currency='USD')
        check('USD: rate_used auto-set', oe_usd.rate_used == Decimal('70.5'), str(oe_usd.rate_used))
        check('USD: amount_afn = 7050.00', oe_usd.amount_afn == Decimal('7050.00'), str(oe_usd.amount_afn))

        usd_today.rate = Decimal('71')  # the day's rate is corrected later...
        usd_today.save()
        oe_usd.amount = Decimal('200')  # ...and the expense amount is edited
        oe_usd.save()
        oe_usd.refresh_from_db()
        check('edit amount keeps the snapshot rate', oe_usd.rate_used == Decimal('70.5'),
              f'rate_used={oe_usd.rate_used}, amount_afn={oe_usd.amount_afn}')

        ExchangeRate.objects.create(date=today, currency='IRR', rate=Decimal('0.00163275'))
        oe_irr = OfficeExpense.objects.create(branch=branch, date=today, category='FUEL', amount=Decimal('1000000'),
                                              currency='IRR')
        check('IRR: rate_used from IRR rate (8 decimals)', oe_irr.rate_used == Decimal('0.00163275'),
              f'rate_used={oe_irr.rate_used}, amount_afn={oe_irr.amount_afn}')
        check('IRR: amount_afn = 1632.75', oe_irr.amount_afn == Decimal('1632.75'))

        oe_irr.currency = 'USD'
        oe_irr.save()
        check('currency change re-reads the rate', oe_irr.rate_used == Decimal('71'), str(oe_irr.rate_used))
        oe_eur = OfficeExpense.objects.create(branch=branch, date=today, category='OTHER', amount=Decimal('5'),
                                              currency='EUR')
        check('no rate for that day → rate_used None, amount_afn None',
              oe_eur.rate_used is None and oe_eur.amount_afn is None)

        print('۴. حواله (Hawala)')
        hw_usd = Hawala(branch=branch, date=today, from_party='ا', to_party='ب', amount=Decimal('500'),
                        fee=Decimal('10'), currency='USD')
        check('USD hawala valid', validation_error(hw_usd) is None)
        hw_usd.save()
        check('USD: rate_used auto-set', hw_usd.rate_used == Decimal('71'), str(hw_usd.rate_used))
        hw_afn = Hawala.objects.create(branch=branch, date=today, from_party='ج', to_party='د',
                                       amount=Decimal('20000'), currency='AFN')
        check('AFN: rate_used stays None', hw_afn.rate_used is None)
        errors = validation_error(Hawala(branch=branch, date=today, from_party='ا', to_party='ب',
                                         amount=Decimal('-100'), currency='USD'))
        check('negative amount rejected', errors is not None and 'amount' in errors, str(errors))
        errors = validation_error(Hawala(branch=branch, date=today, from_party='ا', to_party='ب',
                                         amount=Decimal('100'), fee=Decimal('-1'), currency='USD'))
        check('negative fee rejected', errors is not None and 'fee' in errors, str(errors))

        print('۵. صفحه‌های پنل مدیریت')
        pages = ['/admin/finance/exchangerate/', '/admin/finance/exchangerate/add/',
                 '/admin/finance/hawala/', '/admin/finance/hawala/add/',
                 '/admin/finance/officeexpense/', '/admin/finance/officeexpense/add/',
                 f'/admin/finance/hawala/{hw_usd.pk}/change/', f'/admin/finance/officeexpense/{oe_usd.pk}/change/',
                 f'/admin/finance/officeexpense/{oe_usd.pk}/history/']
        codes = [client.get(page).status_code for page in pages]
        check('all pages return 200', codes == [200] * len(pages), str(codes))

        print('۶. ارقام دری در فورم')
        response = client.post('/admin/finance/officeexpense/add/', {
            'branch': branch.pk, 'date': str(today), 'category': 'KITCHEN', 'amount': '۱٬۲۰۰٫۵۰',
            'currency': 'AFN', 'person': 'حبیب', 'bill_number': '۴۵۶', 'description': '',
        })
        saved = OfficeExpense.objects.filter(bill_number='456').first()
        check('form saved', response.status_code == 302 and saved is not None, f'status={response.status_code}')
        if saved:
            check('amount 1200.50, bill 456, created_by set',
                  saved.amount == Decimal('1200.50') and saved.created_by == admin_user,
                  f'amount={saved.amount}, person={saved.person}')

        print('۷. تاریخچه')
        hw_usd.note = 'ویرایش آزمایشی'
        hw_usd.save()
        check('ExchangeRate history (create + edit)', usd_today.history.count() == 2, str(usd_today.history.count()))
        check('OfficeExpense history (create + edit)', oe_usd.history.count() == 2, str(oe_usd.history.count()))
        check('Hawala history (create + edit)', hw_usd.history.count() == 2, str(hw_usd.history.count()))
        check('admin user recorded in history', saved is not None and saved.history.first().history_user == admin_user)

        raise Rollback
except Rollback:
    pass

print('۸. پاکسازی')
after = counts()
check('no leftover rows (finance tables + history)', before == after, f'before={before}, after={after}')

print(f"\nنتیجه: {'همه آزمایش‌ها موفق ✅' if not failures else 'ناکام: ' + ', '.join(failures)}")
sys.exit(1 if failures else 0)
