from decimal import Decimal

import jdatetime
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone
from django_jalali.db import models as jmodels
from simple_history.models import HistoricalRecords

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
        For USD records this is the record's own rate. For other currencies the
        day's USD rate will come from finance.ExchangeRate (later stage); until
        then it is unknown and the USD figures are None.
        """
        if self.currency == self.Currency.USD:
            return Decimal(self.exchange_rate)
        return None

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


class Document(models.Model):
    """A scanned / uploaded file attached to a transaction."""

    transaction = models.ForeignKey(Transaction, verbose_name='معامله', on_delete=models.CASCADE,
                                    related_name='documents')
    file = models.FileField('فایل سند', upload_to='documents/%Y/%m/')
    title = models.CharField('عنوان سند', max_length=120, blank=True)
    uploaded_at = models.DateTimeField('تاریخ آپلود', auto_now_add=True)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, verbose_name='آپلودکننده', on_delete=models.SET_NULL,
                                    null=True, blank=True, related_name='documents_uploaded', editable=False)

    history = HistoricalRecords(verbose_name='تاریخچهٔ سند')

    class Meta:
        verbose_name = 'سند'
        verbose_name_plural = 'اسناد'
        ordering = ['-uploaded_at']

    def __str__(self):
        return self.title or self.file.name.rsplit('/', 1)[-1]
