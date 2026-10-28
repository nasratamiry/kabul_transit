from django.core.management.base import BaseCommand
from django.db import transaction
from simple_history.utils import bulk_create_with_history

from finance.models import OfficeIncomeCategory, StatementLine
from finance.signals import sync_statement_line
from operations.models import MoneyFieldType

# (code, section, source_field, label_fa, label_en, sort_order)
# Every built-in money column appears exactly once, so the statement's revenue minus the
# transaction expense lines always equals the sum of the transactions' balances.
STANDARD_LINES = [
    # REVENUE — customer_payment is always revenue
    ('REV_CUST_PAY',        'REVENUE', 'customer_payment',     'پرداخت مشتری',          'Customer payment',           10),
    # COGS — direct costs of the transit service, per truck
    ('COGS_KHAK_CASH',      'COGS',    'khak_puli_cash',       'خاک‌پولی نقدی',          'Khak-puli (cash)',           100),
    ('COGS_KHAK_BANK',      'COGS',    'khak_puli_bank',       'خاک‌پولی تحویلی بانک',   'Khak-puli (bank)',           105),
    ('COGS_ESTRAS',         'COGS',    'revenue_estras',       'بندر والی',             'Bandar Wali',                110),
    ('COGS_TRANSPORT',      'COGS',    'revenue_transport',    'ترانسپورت',             'Transport',                  120),
    ('COGS_T2',             'COGS',    't2_delivery_expense',  'تحویلی T2',             'T2 delivery',                125),
    ('COGS_TRANSIT_RIGHT',  'COGS',    'transit_right',        'حق‌العبور',             'Transit right',              130),
    ('COGS_CUSTOMS',        'COGS',    'tariff_expense',       'مصارف تعرفه',           'Customs tariff',             140),
    ('COGS_LABOR',          'COGS',    'expense_labor',        'مصرف جوالی',            'Loading / unloading labour', 145),
    ('COGS_SEAL',           'COGS',    'seal_expense',         'مبلغ سیم سرغچ',         'Seal',                       150),
    ('COGS_SCALE',          'COGS',    'scale_ticket_expense', 'تکت ترازو',             'Scale ticket',               155),
    ('COGS_GATE',           'COGS',    'gate_ticket_expense',  'تکت دروازه',            'Border gate ticket',         160),
    # OPEX — running the offices (not per truck)
    ('OPEX_OFFICE',         'OPEX',    '@office_expense',      'مصارف دفتر',            'Office expenses',            200),
    ('OPEX_SALARY',         'OPEX',    '@office_salary',       'معاش کارمندان',         'Salaries',                   210),
    ('OPEX_HAWALA_FEE',     'OPEX',    '@hawala_fee',          'مصرف حواله',            'Hawala fees',                220),
    # OTHER — delay charges (the closest real fields to "penalties")
    ('OTH_DEMURRAGE_INT',   'OTHER',   'demurrage_internal',   'توقف داخلی',            'Demurrage (internal)',       300),
    ('OTH_DEMURRAGE_TRUCK', 'OTHER',   'demurrage_truck',      'توقف موتر / خارجی',     'Demurrage (truck)',          310),
]

_FIELDS = ('section', 'source_field', 'label_fa', 'label_en', 'sort_order')


class Command(BaseCommand):
    help = ('Seed the standard income-statement lines. Re-runnable: missing lines are created, existing ones '
            'are left as the super admin edited them unless --reset is given.')

    def add_arguments(self, parser):
        parser.add_argument('--reset', action='store_true',
                            help='Also restore section, source, labels and order of existing lines to the defaults.')

    @transaction.atomic
    def handle(self, *args, **options):
        existing = {line.code: line for line in StatementLine.objects.all()}
        new_rows, updated, unchanged = [], 0, 0

        for code, section, source, label_fa, label_en, sort_order in STANDARD_LINES:
            defaults = dict(zip(_FIELDS, (section, source, label_fa, label_en, sort_order)))
            line = existing.get(code)
            if line is None:
                new_rows.append(StatementLine(code=code, **defaults))
            elif options['reset'] and any(getattr(line, name) != value for name, value in defaults.items()):
                for name, value in defaults.items():
                    setattr(line, name, value)
                line.save()
                updated += 1
            else:
                unchanged += 1

        if new_rows:
            bulk_create_with_history(new_rows, StatementLine)

        # Every revenue / expense type added later and every office-income category has its own
        # line; one deleted by hand comes back (an existing one, active or not, is left alone).
        before = StatementLine.objects.count()
        for t in MoneyFieldType.objects.filter(column=''):
            sync_statement_line(t.source, 'MNY_', t.code, 'REVENUE' if t.kind == 'REVENUE' else t.section,
                                t.name_fa, t.name_en, None, False)
        for c in OfficeIncomeCategory.objects.all():
            sync_statement_line(c.source, 'OI_', c.code, 'OTHER_INCOME', c.name_fa, c.name_en, None, False)
        added = StatementLine.objects.count() - before

        self.stdout.write(self.style.SUCCESS(
            f'سطرهای ساخته‌شده: {len(new_rows) + added} | به‌روزشده: {updated} | بدون تغییر: {unchanged}'))
