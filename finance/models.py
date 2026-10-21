from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django_jalali.db import models as jmodels
from simple_history.models import HistoricalRecords

from kabulcargo_backend.utils import normalize_digits
from operations.models import Transaction

from .utils import kabul_today, kabul_today_lazy

ALL_CURRENCIES = Transaction.Currency.choices
NON_AFN_CURRENCIES = [choice for choice in ALL_CURRENCIES if choice[0] != Transaction.Currency.AFN]


def rate_field(verbose_name, **kwargs):
    return models.DecimalField(verbose_name, max_digits=14, decimal_places=8, **kwargs)


class ExchangeRate(models.Model):
    """Daily rate: how many AFN one unit of a currency is worth. AFN itself is always 1 and not stored."""

    date = jmodels.jDateField('تاریخ', default=kabul_today_lazy)
    currency = models.CharField('ارز', max_length=3, choices=NON_AFN_CURRENCIES)
    rate = rate_field('نرخ', help_text='یک واحد این ارز چند افغانی است')
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, verbose_name='ثبت‌کننده', on_delete=models.SET_NULL,
                                   null=True, blank=True, editable=False, related_name='exchange_rates_created')
    created_at = models.DateTimeField('تاریخ ثبت', auto_now_add=True)

    history = HistoricalRecords(verbose_name='تاریخچهٔ نرخ اسعار')

    class Meta:
        verbose_name = 'نرخ اسعار'
        verbose_name_plural = 'نرخ‌های اسعار'
        unique_together = ('date', 'currency')
        ordering = ['-date', 'currency']
        indexes = [models.Index(fields=['currency', 'date'], name='rate_currency_date')]

    def __str__(self):
        return f'{self.get_currency_display()} — {self.date} — {self.rate}'

    def clean(self):
        if self.date and self.date > kabul_today():
            raise ValidationError({'date': 'نمی‌توان برای تاریخ آینده نرخ ثبت کرد.'})
        if self.rate is not None and self.rate <= 0:
            raise ValidationError({'rate': 'نرخ باید بیشتر از صفر باشد.'})


class RateSnapshotMixin:
    """
    Stores the day's rate in `rate_used` so that later rate edits never change
    old records. The rate is looked up on create, and again only when the
    record's currency or date is changed (otherwise the snapshot would be
    wrong), or when no rate existed yet. Editing the amount never touches it.
    """

    def snapshot_rate(self):
        if self.currency == Transaction.Currency.AFN:
            self.rate_used = None
            return
        if self.pk and self.rate_used is not None:
            old = type(self).objects.filter(pk=self.pk).values('currency', 'date').first()
            if old and old['currency'] == self.currency and old['date'] == self.date:
                return
        self.rate_used = (ExchangeRate.objects.filter(date=self.date, currency=self.currency)
                          .values_list('rate', flat=True).first())


class Hawala(RateSnapshotMixin, models.Model):
    """A money transfer (hawala) recorded by a branch."""

    branch = models.ForeignKey('accounts.Branch', verbose_name='بندر / شعبه', on_delete=models.PROTECT,
                               related_name='hawalas')
    date = jmodels.jDateField('تاریخ', default=kabul_today_lazy)
    from_party = models.CharField('فرستنده', max_length=120)
    to_party = models.CharField('گیرنده', max_length=120)
    amount = models.DecimalField('مبلغ', max_digits=14, decimal_places=2, default=0)
    currency = models.CharField('نوع ارز', max_length=3, choices=ALL_CURRENCIES, default=Transaction.Currency.USD)
    fee = models.DecimalField('مصرف حواله', max_digits=14, decimal_places=2, default=0)
    rate_used = rate_field('نرخ اسعار روز', null=True, blank=True, editable=False,
                           help_text='خودکار از نرخ همان روز ثبت می‌شود')
    note = models.TextField('ملاحظات', blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, verbose_name='ثبت‌کننده', on_delete=models.SET_NULL,
                                   null=True, blank=True, editable=False, related_name='hawalas_created')
    created_at = models.DateTimeField('تاریخ ثبت', auto_now_add=True)
    updated_at = models.DateTimeField('آخرین تغییر', auto_now=True)

    history = HistoricalRecords(verbose_name='تاریخچهٔ حواله', excluded_fields=['updated_at'])

    class Meta:
        verbose_name = 'حواله'
        verbose_name_plural = 'حواله‌جات'
        ordering = ['-date', '-id']

    def __str__(self):
        return f'{self.from_party} → {self.to_party} ({self.amount} {self.currency})'

    def clean(self):
        if self.amount is not None and self.amount < 0:
            raise ValidationError({'amount': 'مبلغ نمی‌تواند منفی باشد.'})
        if self.fee is not None and self.fee < 0:
            raise ValidationError({'fee': 'مصرف نمی‌تواند منفی باشد.'})

    def save(self, *args, **kwargs):
        self.snapshot_rate()
        super().save(*args, **kwargs)


class OfficeExpense(RateSnapshotMixin, models.Model):
    """A branch's own office expense (salary, rent, fuel, ...)."""

    class Category(models.TextChoices):
        SALARY = 'SALARY', 'معاش'
        RENT = 'RENT', 'کرایه'
        FUEL = 'FUEL', 'تیل'
        KITCHEN = 'KITCHEN', 'آشپزخانه'
        STATIONERY = 'STATIONERY', 'قرطاسیه'
        CREDIT = 'CREDIT', 'کریدت'
        OTHER = 'OTHER', 'متفرقه'

    branch = models.ForeignKey('accounts.Branch', verbose_name='بندر / شعبه', on_delete=models.PROTECT,
                               related_name='office_expenses')
    date = jmodels.jDateField('تاریخ', default=kabul_today_lazy)
    category = models.CharField('کتگوری', max_length=20, choices=Category.choices)
    amount = models.DecimalField('مبلغ', max_digits=14, decimal_places=2, default=0)
    currency = models.CharField('نوع ارز', max_length=3, choices=ALL_CURRENCIES, default=Transaction.Currency.AFN)
    rate_used = rate_field('نرخ اسعار روز', null=True, blank=True, editable=False,
                           help_text='خودکار از نرخ همان روز ثبت می‌شود')
    person = models.CharField('شخص / پرداخت‌کننده', max_length=120, blank=True,
                              help_text='نام شخصی که پول را گرفت یا پرداخت کرد')
    bill_number = models.CharField('نمبر بل', max_length=60, blank=True)
    description = models.TextField('تفصیل مصارفات', blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, verbose_name='ثبت‌کننده', on_delete=models.SET_NULL,
                                   null=True, blank=True, editable=False, related_name='office_expenses_created')
    created_at = models.DateTimeField('تاریخ ثبت', auto_now_add=True)
    updated_at = models.DateTimeField('آخرین تغییر', auto_now=True)

    history = HistoricalRecords(verbose_name='تاریخچهٔ مصرف دفتر', excluded_fields=['updated_at'])

    class Meta:
        verbose_name = 'مصرف دفتر'
        verbose_name_plural = 'مصارف دفتر'
        ordering = ['-date', '-id']
        indexes = [models.Index(fields=['branch', 'date'], name='office_expense_branch_date')]

    def __str__(self):
        return f'{self.get_category_display()} — {self.amount} {self.currency} ({self.date})'

    def clean(self):
        self.bill_number = normalize_digits(self.bill_number)
        if self.amount is not None and self.amount < 0:
            raise ValidationError({'amount': 'مبلغ نمی‌تواند منفی باشد.'})

    def save(self, *args, **kwargs):
        self.snapshot_rate()
        super().save(*args, **kwargs)

    @property
    def amount_afn(self):
        if self.currency == Transaction.Currency.AFN:
            return self.amount
        if self.rate_used:
            return (self.amount * self.rate_used).quantize(Decimal('0.01'))
        return None
