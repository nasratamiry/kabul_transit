from django.core.management.base import BaseCommand
from django.db import transaction

from accounts.models import Branch
from config.models import FieldConfig
from operations.models import Transaction

# (field_name, label_fa, default_sort_order, default_visibility)
# Visibility defaults; trade-type overrides are applied after.
FIELD_SPEC = [
    # Common (1-99)
    ('serial_number',          'شماره / سریال',            10,  'REQUIRED'),
    ('date',                   'تاریخ',                    20,  'REQUIRED'),
    ('status',                 'وضعیت',                    30,  'REQUIRED'),
    ('motabari',               'معتبری',                   35,  'HIDDEN'),  # TRANSIT override
    # Documents (100-299)
    ('plate_afghan',           'نمبر پلیت افغانی',          100, 'REQUIRED'),
    ('plate_foreign',          'نمبر پلیت خارجی / واگون',   110, 'OPTIONAL'),
    ('truck_type',             'نوع موتر',                 120, 'OPTIONAL'),
    ('driver_name',            'اسم راننده',               130, 'REQUIRED'),
    ('driver_phone',           'نمبر راننده یا نماینده',    140, 'OPTIONAL'),
    ('trader',                 'تاجر / مشتری',              150, 'REQUIRED'),
    ('transport_company',      'شرکت ترانسپورت',            160, 'OPTIONAL'),
    ('goods_type',             'نوع جنس',                  170, 'OPTIONAL'),
    ('weight',                 'وزن',                      180, 'OPTIONAL'),
    ('quantity',               'تعداد',                    190, 'OPTIONAL'),
    ('customs_origin',         'گمرک سرحدی',               200, 'OPTIONAL'),
    ('customs_destination',    'گمرک مقصد',                210, 'OPTIONAL'),
    ('bank_tariff_slip_number', 'نمبر آویز تعرفهٔ بانکی',   220, 'OPTIONAL'),
    ('t1_number',              'نمبر T1',                  230, 'OPTIONAL'),
    ('t2_number',              'نمبر T2',                  240, 'OPTIONAL'),
    ('cmr_number',             'نمبر CMR',                 250, 'OPTIONAL'),
    ('mafi_number',            'نمبر مافی',                260, 'OPTIONAL'),
    ('exit_slip_number',       'نمبر برگهٔ خروجی',          270, 'OPTIONAL'),
    ('scale_weight',           'وزن ترازو',                280, 'OPTIONAL'),
    ('scale_ticket_number',    'نمبر تکت ترازو',            285, 'OPTIONAL'),
    ('seal_number',            'نمبر سیم / سرب',            290, 'OPTIONAL'),
    ('remarks',                'ملاحظات',                  299, 'OPTIONAL'),
    # Finance (400-499)
    ('customer_payment',       'پرداخت مشتری',              400, 'REQUIRED'),
    ('currency',               'نوع ارز',                  410, 'REQUIRED'),
    ('exchange_rate',          'نرخ اسعار',                420, 'REQUIRED'),
    ('customer_balance',       'باقیات از قبل',             430, 'OPTIONAL'),
    ('khak_puli_cash',         'خاک‌پولی نقدی',              440, 'OPTIONAL'),
    ('khak_puli_bank',         'خاک‌پولی تحویلی بانک',       450, 'OPTIONAL'),
    ('revenue_estras',         'عواید استراس',              455, 'OPTIONAL'),
    ('revenue_transport',      'عواید ترانسپورت',           460, 'OPTIONAL'),
    ('t2_delivery_expense',    'تحویلی T2',                465, 'OPTIONAL'),
    ('transit_right',          'حق‌العبور',                470, 'OPTIONAL'),
    ('tariff_expense',         'مصارف تعرفه',              475, 'OPTIONAL'),
    ('expense_labor',          'مصرف جوالی',               480, 'OPTIONAL'),
    ('demurrage_internal',     'توقف داخلی',               482, 'OPTIONAL'),
    ('demurrage_truck',        'توقف موتر / خارجی',         484, 'OPTIONAL'),
    ('seal_expense',           'مبلغ سیم سرغچ',             490, 'OPTIONAL'),  # EXPORT override
    ('scale_ticket_expense',   'تکت ترازو',                492, 'OPTIONAL'),  # EXPORT override
    ('gate_ticket_expense',    'تکت دروازه',               494, 'OPTIONAL'),  # EXPORT override
]

# Trade-type-specific overrides. { trade_type: { field_name: 'VISIBILITY' } }
TRADE_OVERRIDES = {
    'TRANSIT': {
        'motabari': 'REQUIRED',  # معتبری is only required for TRANSIT
    },
    'EXPORT': {
        'seal_expense': 'REQUIRED',
        'scale_ticket_expense': 'REQUIRED',
        'gate_ticket_expense': 'REQUIRED',
    },
}


class Command(BaseCommand):
    help = 'Seed FieldConfig rows for every Branch × every TradeType × every Transaction field.'

    def add_arguments(self, parser):
        parser.add_argument('--branch', help='Only seed for this branch code.')
        parser.add_argument('--dry-run', action='store_true')

    @transaction.atomic
    def handle(self, *args, **options):
        branches = Branch.objects.all()
        if options.get('branch'):
            branches = branches.filter(code=options['branch'].upper())
        if not branches.exists():
            self.stdout.write(self.style.WARNING('هیچ بندری یافت نشد. اول حداقل یک بندر بسازید.'))
            return

        trade_types = [c[0] for c in Transaction.TradeType.choices]
        created = skipped = 0

        for branch in branches:
            for trade_type in trade_types:
                for field_name, label_fa, sort_order, visibility in FIELD_SPEC:
                    final_visibility = TRADE_OVERRIDES.get(trade_type, {}).get(field_name, visibility)
                    _, was_created = FieldConfig.objects.get_or_create(
                        branch=branch, trade_type=trade_type, field_name=field_name,
                        defaults={'field_label_fa': label_fa, 'visibility': final_visibility,
                                  'sort_order': sort_order},
                    )
                    if was_created:
                        created += 1
                    else:
                        skipped += 1

        self.stdout.write(self.style.SUCCESS(
            f'ردیف‌های ساخته‌شده: {created} | ردیف‌های بدون تغییر: {skipped}'))
        if options.get('dry_run'):
            transaction.set_rollback(True)
            self.stdout.write(self.style.WARNING('dry-run: تغییرات ذخیره نشد.'))
