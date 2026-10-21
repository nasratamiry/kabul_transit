"""
Verify the Transaction model end to end.

    .venv\\Scripts\\python scripts\\verify_transaction.py

Runs against the configured database inside one DB transaction that is rolled
back at the end, so no test data is left behind.
"""
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

from django.db import transaction  # noqa: E402
from django.test import Client  # noqa: E402

from accounts.models import Branch, User  # noqa: E402
from operations.models import Transaction  # noqa: E402
from partners.models import Trader, TransportCompany  # noqa: E402

failures = []


def check(label, ok, detail=''):
    print(f"  [{'OK' if ok else 'FAIL'}] {label}{(' — ' + detail) if detail else ''}")
    if not ok:
        failures.append(label)


class Rollback(Exception):
    pass


try:
    with transaction.atomic():
        print('۱. ساختن بندر، تاجر و شرکت ترانسپورت')
        branch = Branch.objects.create(name='بندر آزمایشی', code='ZZTEST')
        trader = Trader.objects.create(name='تاجر آزمایشی', company_name='شرکت آزمایشی')
        company = TransportCompany.objects.create(name='ترانسپورت آزمایشی', country='افغانستان')
        check('records created', bool(branch.pk and trader.pk and company.pk))

        print('۲. ساختن معامله: پرداخت مشتری 1000 دالر، نرخ 70')
        expenses = {
            'khak_puli_cash': Decimal('50'), 'khak_puli_bank': Decimal('25'),
            'revenue_estras': Decimal('40'), 'revenue_transport': Decimal('300'),
            'transit_right': Decimal('60'), 'expense_labor': Decimal('15.50'),
            'gate_ticket_expense': Decimal('4.50'),
        }
        txn = Transaction.objects.create(
            branch=branch, trade_type=Transaction.TradeType.TRANSIT, serial_number='TEST-001',
            trader=trader, transport_company=company, plate_afghan='KBL-1234',
            customer_payment=Decimal('1000'), currency=Transaction.Currency.USD,
            exchange_rate=Decimal('70'), **expenses,
        )
        txn.refresh_from_db()
        expense_sum = sum(expenses.values())

        print('۳. بیلانس = 1000 − جمع مصارف (به دالر)')
        check('balance', txn.balance == Decimal('1000') - expense_sum,
              f'{txn.balance} == 1000 − {expense_sum}')

        print('۴. جمله مصرف افغانی = جمع مصارف × 70')
        check('total_expense_afn', txn.total_expense_afn == expense_sum * 70,
              f'{txn.total_expense_afn} == {expense_sum} × 70')

        print('۵. خلاصه ردیف')
        print(f'     جمله مصرف افغانی : {txn.total_expense_afn:>12,.2f} AFN')
        print(f'     فی دالر           : {txn.fee_per_dollar_afn:>12,.4f} AFN')
        print(f'     جمله مصرف دالر    : {txn.total_expense_usd:>12,.2f} USD')
        print(f'     مفاد یا ضرر       : {txn.profit_or_loss_afn:>12,.2f} AFN | {txn.profit_or_loss_usd:,.2f} USD')
        check('total_expense_usd', txn.total_expense_usd == expense_sum)
        check('profit_or_loss_usd', txn.profit_or_loss_usd == txn.balance)

        print('۶. تاریخچه')
        check('history row on create', txn.history.count() == 1)
        txn.demurrage_truck = Decimal('100')
        txn.save()
        check('history row on edit + balance recalculated',
              txn.history.count() == 2 and txn.balance == Decimal('1000') - expense_sum - 100,
              f'rows={txn.history.count()}, balance={txn.balance}')

        print('۷. حالت‌های دیگر')
        afn = Transaction.objects.create(branch=branch, trade_type=Transaction.TradeType.IMPORT,
                                         serial_number='TEST-002', currency=Transaction.Currency.AFN,
                                         exchange_rate=Decimal('99'), customer_payment=Decimal('5000'),
                                         tariff_expense=Decimal('6000'))
        check('AFN forces rate 1 and shows a loss',
              afn.exchange_rate == 1 and afn.profit_or_loss_afn == Decimal('-1000'),
              f'rate={afn.exchange_rate}, P/L={afn.profit_or_loss_afn}')
        check('customer_balance not in formula',
              Transaction(customer_payment=10, customer_balance=999, currency='AFN').total_expense == 0)

        print('۸. فورم پنل مدیریت با ارقام دری')
        admin_user = User.objects.create_superuser('zz_verify_admin', None, 'Verify-Pass-123')
        client = Client(HTTP_HOST='127.0.0.1')
        client.force_login(admin_user)
        form = {
            'branch': branch.pk, 'trade_type': 'EXPORT', 'serial_number': '۷۷۷', 'date': '1405-07-29',
            'status': 'WAITING', 'customer_payment': '۱٬۲۰۰٫۵۰', 'currency': 'USD', 'exchange_rate': '۷۰',
            'khak_puli_cash': '۲۰۰', 'plate_afghan': 'کابل ۱۲۳',
            'documents-TOTAL_FORMS': '0', 'documents-INITIAL_FORMS': '0',
        }
        for name in Transaction.EXPENSE_FIELDS:
            form.setdefault(name, '0')
        form.update({'customer_balance': '0', 'weight': '0', 'quantity': '0', 'scale_weight': '0'})
        response = client.post('/admin/operations/transaction/add/', form)
        saved = Transaction.objects.filter(serial_number='777').first()
        check('admin accepts Dari digits', response.status_code == 302 and saved is not None,
              f'status={response.status_code}')
        if saved:
            check('admin values parsed', saved.customer_payment == Decimal('1200.50') and saved.balance == Decimal('1000.50'),
                  f'payment={saved.customer_payment}, balance={saved.balance}')
            check('plate kept exactly as typed', saved.plate_afghan == 'کابل ۱۲۳', repr(saved.plate_afghan))
            check('created_by + history user recorded',
                  saved.created_by == admin_user and saved.history.first().history_user == admin_user)
            pages = [f'/admin/operations/transaction/{saved.pk}/change/', '/admin/operations/transaction/',
                     f'/admin/operations/transaction/{saved.pk}/history/', '/admin/operations/document/add/']
            codes = [client.get(page).status_code for page in pages]
            check('admin pages open', codes == [200] * len(pages), str(codes))

        raise Rollback
except Rollback:
    print('\nهمه داده‌های آزمایشی پاک شد (rollback).')

print(f"\nنتیجه: {'همه آزمایش‌ها موفق ✅' if not failures else 'ناکام: ' + ', '.join(failures)}")
sys.exit(1 if failures else 0)
