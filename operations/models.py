from decimal import Decimal

import jdatetime
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator
from django.db import models
from django.utils import timezone
from django_jalali.db import models as jmodels
from simple_history.models import HistoricalRecords

from kabulcargo_backend.utils import normalize_digits

from .validators import validate_file_extension, validate_file_magic, validate_file_size

TWO_PLACES = Decimal('0.01')


def money_field(verbose_name, **kwargs):
    return models.DecimalField(verbose_name, max_digits=14, decimal_places=2, default=0, **kwargs)


def kabul_today():
    return jdatetime.date.fromgregorian(date=timezone.localdate())


class Transaction(models.Model):
    """
    One truck / one registration. All four trade types live in this model.
    The ONLY revenue is customer_payment; every other money field is an expense.
    """

    class TradeType(models.TextChoices):
        EXPORT = 'EXPORT', 'صادرات'
        IMPORT = 'IMPORT', 'واردات'
        TRANSIT = 'TRANSIT', 'ترانزیت'
        TIR_CARNET = 'TIR_CARNET', 'تیر کارنت'

    class Status(models.TextChoices):
        WAITING = 'WAITING', 'در انتظار تفتیش'
        SEALED = 'SEALED', 'سیم‌شده'
        EXITED = 'EXITED', 'خارج‌شده'

    class Currency(models.TextChoices):
        AFN = 'AFN', 'افغانی (AFN)'
        USD = 'USD', 'دالر امریکایی (USD)'
        PKR = 'PKR', 'کلدار پاکستانی (PKR)'
        EUR = 'EUR', 'یورو (EUR)'
        IRR = 'IRR', 'تومان / ریال ایرانی (IRR)'

    # Every field deducted from customer_payment. Order = order shown in the admin.
    EXPENSE_FIELDS = (
        'khak_puli_cash', 'khak_puli_bank',
        'revenue_estras', 'revenue_transport', 't2_delivery_expense',
        'transit_right', 'tariff_expense',
        'expense_labor', 'demurrage_internal', 'demurrage_truck',
        'seal_expense', 'scale_ticket_expense', 'gate_ticket_expense',
    )

    # --- Meta / common ------------------------------------------------------
    branch = models.ForeignKey('accounts.Branch', verbose_name='بندر / شعبه', on_delete=models.PROTECT,
                               related_name='transactions')
    trade_type = models.CharField('نوع معامله', max_length=20, choices=TradeType.choices)
    serial_number = models.CharField('شماره / سریال', max_length=50)
    date = jmodels.jDateField('تاریخ', default=kabul_today,
                              help_text='تاریخ شمسی، مثلاً ۱۴۰۵/۰۷/۲۹')
    status = models.CharField('وضعیت', max_length=20, choices=Status.choices, default=Status.WAITING)
    motabari = models.BooleanField('معتبری', default=False, help_text='فقط برای ترانزیت')
    remarks = models.TextField('ملاحظات', blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, verbose_name='ثبت‌کننده', on_delete=models.SET_NULL,
                                   null=True, blank=True, related_name='transactions_created', editable=False)
    created_at = models.DateTimeField('تاریخ ثبت', auto_now_add=True)
    updated_at = models.DateTimeField('آخرین تغییر', auto_now=True)

    # --- Documents / registration ------------------------------------------
    t1_number = models.CharField('نمبر T1', max_length=60, blank=True)
    t2_number = models.CharField('نمبر T2', max_length=60, blank=True)
    cmr_number = models.CharField('نمبر CMR', max_length=60, blank=True)
    mafi_number = models.CharField('نمبر مافی', max_length=60, blank=True)
    exit_slip_number = models.CharField('نمبر برگهٔ خروجی', max_length=60, blank=True)
    plate_afghan = models.CharField('نمبر پلیت افغانی', max_length=40, blank=True)
    plate_foreign = models.CharField('نمبر پلیت خارجی / واگون', max_length=40, blank=True)
    truck_type = models.CharField('نوع موتر', max_length=60, blank=True)
    driver_name = models.CharField('اسم راننده', max_length=120, blank=True)
    driver_phone = models.CharField('نمبر راننده یا نماینده', max_length=40, blank=True)
    trader = models.ForeignKey('partners.Trader', verbose_name='تاجر / مشتری', on_delete=models.PROTECT,
                               null=True, blank=True, related_name='transactions')
    transport_company = models.ForeignKey('partners.TransportCompany', verbose_name='شرکت ترانسپورت',
                                          on_delete=models.PROTECT, null=True, blank=True,
                                          related_name='transactions')
    goods_type = models.CharField('نوع جنس', max_length=120, blank=True)
    weight = models.DecimalField('وزن', max_digits=14, decimal_places=2, default=0)
    quantity = models.PositiveIntegerField('تعداد', default=0)
    customs_origin = models.CharField('گمرک سرحدی', max_length=120, blank=True)
    customs_destination = models.CharField('گمرک مقصد', max_length=120, blank=True)
    bank_tariff_slip_number = models.CharField('نمبر آویز تعرفهٔ بانکی', max_length=60, blank=True)
    scale_weight = models.DecimalField('وزن ترازو', max_digits=14, decimal_places=2, default=0)
    scale_ticket_number = models.CharField('نمبر تکت ترازو', max_length=60, blank=True)
    seal_number = models.CharField('نمبر سیم / سرب', max_length=60, blank=True)

    # --- Finance: the ONLY revenue -----------------------------------------
    customer_payment = money_field('پرداخت مشتری', help_text='یگانه عاید: پولی که مشتری برای این موتر می‌پردازد')

    # --- Currency & rate ----------------------------------------------------
    currency = models.CharField('نوع ارز', max_length=3, choices=Currency.choices, default=Currency.USD)
    # 8 decimals so tiny rates (e.g. 1 IRR ≈ 0.0016 AFN) keep their precision.
    exchange_rate = models.DecimalField('نرخ اسعار', max_digits=14, decimal_places=8, default=1,
                                        help_text='یک واحد این ارز چند افغانی است (برای افغانی همیشه ۱)')

    # --- Expenses (all deducted from the balance) ---------------------------
    khak_puli_cash = money_field('خاک‌پولی نقدی')
    khak_puli_bank = money_field('خاک‌پولی تحویلی بانک')
    revenue_estras = money_field('عواید استراس', help_text='با وجود نام «عواید»، این یک مصرف است')
    revenue_transport = money_field('عواید ترانسپورت', help_text='با وجود نام «عواید»، این یک مصرف است')
    t2_delivery_expense = money_field('تحویلی T2')
    transit_right = money_field('حق‌العبور')
    tariff_expense = money_field('مصارف تعرفه')
    expense_labor = money_field('مصرف جوالی')
    demurrage_internal = money_field('توقف داخلی')
    demurrage_truck = money_field('توقف موتر / خارجی')
    seal_expense = money_field('مبلغ سیم سرغچ')
    scale_ticket_expense = money_field('تکت ترازو')
    gate_ticket_expense = money_field('تکت دروازه')

    # --- Informational only (NOT part of the balance formula) ---------------
    customer_balance = money_field('باقیات از قبل', help_text='فقط برای معلومات؛ در حساب مفاد/ضرر شامل نیست')

    # --- Stored result ------------------------------------------------------
    balance = money_field('بیلانس', editable=False,
                          help_text='پرداخت مشتری منهای همه مصارف، به ارز همین معامله')

    history = HistoricalRecords(verbose_name='تاریخچهٔ معامله', excluded_fields=['updated_at'])

    class Meta:
        verbose_name = 'معامله'
        verbose_name_plural = 'معاملات'
        ordering = ['-date', '-id']
        indexes = [
            models.Index(fields=['branch', 'trade_type', 'date'], name='txn_branch_type_date'),
            models.Index(fields=['serial_number'], name='txn_serial'),
            models.Index(fields=['plate_afghan'], name='txn_plate_afghan'),
        ]

    def __str__(self):
        return f'{self.get_trade_type_display()} — {self.serial_number}'

    def clean(self):
        if self.motabari and self.trade_type != self.TradeType.TRANSIT:
            raise ValidationError({'motabari': 'معتبری فقط برای معاملات ترانزیت است.'})
        if self.exchange_rate is not None and self.exchange_rate <= 0:
            raise ValidationError({'exchange_rate': 'نرخ اسعار باید بیشتر از صفر باشد.'})

    def save(self, *args, **kwargs):
        if self.currency == self.Currency.AFN:
            self.exchange_rate = Decimal('1')
        self.balance = self.customer_payment - self.total_expense
        update_fields = kwargs.get('update_fields')
        if update_fields is not None:
            kwargs['update_fields'] = {*update_fields, 'balance', 'exchange_rate'}
        super().save(*args, **kwargs)

    # --- Row summary (computed, read-only) ----------------------------------
    @property
    def total_expense(self):
        """Sum of all expenses in this record's own currency."""
        return sum((Decimal(getattr(self, name) or 0) for name in self.EXPENSE_FIELDS), Decimal('0'))

    @property
    def rate_to_afn(self):
        return Decimal('1') if self.currency == self.Currency.AFN else Decimal(self.exchange_rate)

    @property
    def total_expense_afn(self):
        """جمله مصرف افغانی"""
        return (self.total_expense * self.rate_to_afn).quantize(TWO_PLACES)

    @property
    def fee_per_dollar_afn(self):
        """
        فی دالر — how many AFN one USD is worth for this record.
        For USD records this is the record's own rate. For other currencies it is the
        USD rate of the record's own date (else the latest earlier one; never today's) —
        the income statement's rule, finance.utils.usd_rate_on. None (USD figures unknown)
        when no USD rate exists on or before that date. Lists preload it for all rows with
        finance.utils.attach_usd_rates; a single record looks it up once and keeps it.
        """
        if self.currency == self.Currency.USD:
            return Decimal(self.exchange_rate)
        if not hasattr(self, '_usd_rate'):
            from finance.utils import usd_rate_on  # finance.models imports this module
            self._usd_rate = usd_rate_on(self.date) if self.date else None
        return self._usd_rate

    @property
    def total_expense_usd(self):
        """جمله مصرف دالر"""
        rate = self.fee_per_dollar_afn
        return (self.total_expense_afn / rate).quantize(TWO_PLACES) if rate else None

    @property
    def profit_or_loss_afn(self):
        """مفاد یا ضرر (افغانی)"""
        return (Decimal(self.balance) * self.rate_to_afn).quantize(TWO_PLACES)

    @property
    def profit_or_loss_usd(self):
        """مفاد یا ضرر (دالر)"""
        rate = self.fee_per_dollar_afn
        return (self.profit_or_loss_afn / rate).quantize(TWO_PLACES) if rate else None


# Transaction fields that hold a document's number; a DocumentType may point at one of them.
DOCUMENT_NUMBER_FIELDS = (
    't1_number', 't2_number', 'cmr_number', 'mafi_number', 'exit_slip_number',
    'bank_tariff_slip_number', 'scale_ticket_number', 'seal_number',
)


def _same_number(a, b):
    """Document numbers compare without case, spaces or digit script (۱۲۳ == 123)."""
    def plain(value):
        return ''.join(normalize_digits(value or '').split()).casefold()
    return plain(a) == plain(b)


class DocumentType(models.Model):
    """A kind of customs / transport paper (T1, CMR, ...). Managed by the super admin."""

    code = models.CharField('کود', max_length=30, unique=True,
                            validators=[RegexValidator(r'^[A-Z][A-Z0-9_]*$',
                                                       'کود فقط حروف بزرگ انگلیسی، عدد و _ باشد (مثلاً T1).')],
                            help_text='کود انگلیسی کوتاه با حروف بزرگ، مثلاً T1 یا CMR. بعد از ثبت تغییر نمی‌کند.')
    name_fa = models.CharField('نام (دری)', max_length=100)
    name_ps = models.CharField('نام (پشتو)', max_length=100, blank=True)
    name_en = models.CharField('نام (انگلیسی)', max_length=100, blank=True)
    number_field = models.CharField(
        'فیلد نمبر در معامله', max_length=40, blank=True,
        choices=[(name, Transaction._meta.get_field(name).verbose_name) for name in DOCUMENT_NUMBER_FIELDS],
        help_text='اگر انتخاب شود، نمبر این سند با همین فیلد معامله مقایسه / پر می‌شود.')
    sort_order = models.PositiveIntegerField('ترتیب نمایش', default=100, help_text='عدد کمتر = بالاتر در فهرست')
    is_active = models.BooleanField('فعال', default=True,
                                    help_text='نوع غیرفعال برای آپلود تازه نشان داده نمی‌شود؛ اسناد قبلی می‌مانند.')

    history = HistoricalRecords(verbose_name='تاریخچهٔ نوع سند')

    class Meta:
        verbose_name = 'نوع سند'
        verbose_name_plural = 'انواع اسناد'
        ordering = ['sort_order', 'code']

    def __str__(self):
        return f'{self.name_fa} ({self.code})'

    def clean(self):
        self.code = (self.code or '').strip().upper()


class Document(models.Model):
    """A scanned / uploaded file attached to a transaction. Several files per type are fine (multi-page T1)."""

    transaction = models.ForeignKey(Transaction, verbose_name='معامله', on_delete=models.CASCADE,
                                    related_name='documents')
    doc_type = models.ForeignKey(DocumentType, verbose_name='نوع سند', on_delete=models.PROTECT,
                                 related_name='documents')
    doc_number = models.CharField('نمبر سند', max_length=60, blank=True)
    issue_date = jmodels.jDateField('تاریخ صدور', null=True, blank=True, help_text='تاریخ شمسی صدور سند')
    note = models.TextField('یادداشت', blank=True)
    file = models.FileField('فایل سند', upload_to='documents/%Y/%m/',
                            validators=[validate_file_size, validate_file_extension, validate_file_magic],
                            help_text='PDF، JPG، PNG یا WEBP — حداکثر ۱۰ میگابایت')
    title = models.CharField('عنوان سند', max_length=120, blank=True)
    uploaded_at = models.DateTimeField('تاریخ آپلود', auto_now_add=True)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, verbose_name='آپلودکننده', on_delete=models.SET_NULL,
                                    null=True, blank=True, related_name='documents_uploaded', editable=False)

    history = HistoricalRecords(verbose_name='تاریخچهٔ سند')

    class Meta:
        verbose_name = 'سند'
        verbose_name_plural = 'اسناد'
        ordering = ['-uploaded_at']
        indexes = [models.Index(fields=['doc_number'], name='doc_number_idx')]

    def __str__(self):
        if self.title:
            return self.title
        if self.doc_type_id:
            return f'{self.doc_type.name_fa} {self.doc_number}'.strip()
        return self.file.name.rsplit('/', 1)[-1]

    def clean(self):
        self.doc_number = normalize_digits(self.doc_number or '')

    @property
    def number_field(self):
        return self.doc_type.number_field if self.doc_type_id else ''

    def number_mismatch(self):
        """The transaction's own number when it differs from this document's number, else None."""
        field = self.number_field
        if not field or not self.doc_number:
            return None
        current = getattr(self.transaction, field) or ''
        return current if current and not _same_number(current, self.doc_number) else None

    def sync_number(self):
        """
        Copy doc_number into the transaction's matching number field (DocumentType.number_field)
        when that field is empty. When it already holds a different number nothing is
        overwritten: both are kept and a Dari warning comes back. Returns None when there is
        nothing to compare, else {field, label, status: filled|same|mismatch, transaction_value, message}.
        """
        field, number = self.number_field, (self.doc_number or '').strip()
        if not field or not number:
            return None
        tx = self.transaction
        current = (getattr(tx, field) or '').strip()
        label = str(Transaction._meta.get_field(field).verbose_name)
        result = {'field': field, 'label': label, 'transaction_value': current or number}
        if not current:
            setattr(tx, field, number)
            tx.save(update_fields=[field, 'updated_at'])
            return {**result, 'status': 'filled', 'message': f'«{label}» معامله از روی این سند پر شد: {number}'}
        if _same_number(current, number):
            return {**result, 'status': 'same', 'message': ''}
        return {**result, 'status': 'mismatch',
                'message': f'نمبر این سند ({number}) با «{label}» معامله ({current}) فرق دارد. '
                           'هیچ‌کدام تغییر داده نشد؛ اگر لازم است، معامله را اصلاح کنید.'}
