from django.db import models
from simple_history.models import HistoricalRecords

from kabulcargo_backend.utils import normalize_digits


class Trader(models.Model):
    """A trader / customer — the person or company that pays for a truck."""

    name = models.CharField('نام تاجر / مشتری', max_length=120)
    phone = models.CharField('نمبر تماس', max_length=40, blank=True,
                             help_text='ارقام دری یا انگلیسی هر دو قبول است')
    company_name = models.CharField('نام شرکت', max_length=160, blank=True)
    national_id = models.CharField('شماره تذکره / هویت', max_length=60, blank=True)
    address = models.CharField('آدرس', max_length=255, blank=True)
    note = models.TextField('ملاحظات', blank=True)
    is_active = models.BooleanField('فعال', default=True,
                                    help_text='تاجر غیرفعال در فورم‌های جدید نشان داده نمی‌شود')
    created_at = models.DateTimeField('تاریخ ثبت', auto_now_add=True)

    history = HistoricalRecords(verbose_name='تاریخچه تاجر')

    class Meta:
        verbose_name = 'تاجر / مشتری'
        verbose_name_plural = 'تاجران / مشتریان'
        ordering = ['name']

    def __str__(self):
        return f'{self.name} — {self.company_name}' if self.company_name else self.name

    def clean(self):
        self.phone = normalize_digits(self.phone)
        self.national_id = normalize_digits(self.national_id)


class TransportCompany(models.Model):
    """A transport company whose trucks carry the cargo."""

    name = models.CharField('نام شرکت', max_length=160, unique=True)
    phone = models.CharField('نمبر تماس', max_length=40, blank=True,
                             help_text='ارقام دری یا انگلیسی هر دو قبول است')
    country = models.CharField('کشور', max_length=80, blank=True)
    note = models.TextField('ملاحظات', blank=True)
    is_active = models.BooleanField('فعال', default=True,
                                    help_text='شرکت غیرفعال در فورم‌های جدید نشان داده نمی‌شود')
    created_at = models.DateTimeField('تاریخ ثبت', auto_now_add=True)

    history = HistoricalRecords(verbose_name='تاریخچه شرکت ترانسپورت')

    class Meta:
        verbose_name = 'شرکت ترانسپورت'
        verbose_name_plural = 'شرکت‌های ترانسپورت'
        ordering = ['name']

    def __str__(self):
        return self.name

    def clean(self):
        self.phone = normalize_digits(self.phone)
