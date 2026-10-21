from django.contrib import admin
from django_jalali.admin.filters import JDateFieldListFilter
from django_jalali.admin.widgets import AdminjDateWidget
from django_jalali.db import models as jmodels
from simple_history.admin import SimpleHistoryAdmin

from kabulcargo_backend.forms import DigitNormalizingModelForm
from kabulcargo_backend.utils import dual_date

from .models import Document, Transaction


def _money(value):
    return '—' if value is None else f'{value:,.2f}'


class TransactionForm(DigitNormalizingModelForm):
    digit_fields = (
        'serial_number', 'date', 't1_number', 't2_number', 'cmr_number', 'mafi_number', 'exit_slip_number',
        'plate_afghan', 'plate_foreign', 'driver_phone', 'bank_tariff_slip_number',
        'scale_ticket_number', 'seal_number',
    )

    class Meta:
        model = Transaction
        fields = '__all__'


class DocumentInline(admin.TabularInline):
    model = Document
    extra = 1
    fields = ('title', 'file', 'uploaded_by', 'uploaded_display')
    readonly_fields = ('uploaded_by', 'uploaded_display')
    verbose_name = 'سند'
    verbose_name_plural = 'آپلود اسناد'

    @admin.display(description='تاریخ آپلود (شمسی | میلادی)')
    def uploaded_display(self, obj):
        return dual_date(obj.uploaded_at) if obj.pk else '—'


@admin.register(Transaction)
class TransactionAdmin(SimpleHistoryAdmin):
    form = TransactionForm
    inlines = [DocumentInline]
    formfield_overrides = {jmodels.jDateField: {'widget': AdminjDateWidget}}

    list_display = ('serial_number', 'trade_type', 'branch', 'date_display', 'trader', 'plate_afghan',
                    'status', 'customer_payment', 'balance')
    list_filter = ('trade_type', 'branch', 'status', ('date', JDateFieldListFilter))
    search_fields = ('serial_number', 'plate_afghan', 'driver_name', 'trader__name')
    list_select_related = ('branch', 'trader')
    autocomplete_fields = ('trader', 'transport_company')
    readonly_fields = ('balance', 'total_expense_afn_display', 'fee_per_dollar_afn_display',
                       'total_expense_usd_display', 'profit_or_loss_afn_display', 'profit_or_loss_usd_display',
                       'created_by', 'created_display', 'updated_display')

    fieldsets = (
        ('معلومات عمومی', {'fields': (
            'branch', 'trade_type', 'serial_number', 'date', 'status', 'motabari', 'remarks',
        )}),
        ('اسناد و راجستر', {'fields': (
            ('t1_number', 't2_number', 'cmr_number'),
            ('mafi_number', 'exit_slip_number'),
            ('plate_afghan', 'plate_foreign', 'truck_type'),
            ('driver_name', 'driver_phone'),
            ('trader', 'transport_company'),
            ('goods_type', 'weight', 'quantity'),
            ('customs_origin', 'customs_destination'),
            ('bank_tariff_slip_number', 'scale_weight', 'scale_ticket_number'),
            'seal_number',
        )}),
        ('بخش مالی', {
            'description': 'یگانه عاید «پرداخت مشتری» است. همه مبالغ دیگر مصرف هستند و از بیلانس کم می‌شوند.',
            'fields': (
                ('customer_payment', 'currency', 'exchange_rate'),
                ('khak_puli_cash', 'khak_puli_bank'),
                ('revenue_estras', 'revenue_transport', 't2_delivery_expense'),
                ('transit_right', 'tariff_expense', 'expense_labor'),
                ('demurrage_internal', 'demurrage_truck'),
                ('seal_expense', 'scale_ticket_expense', 'gate_ticket_expense'),
                'customer_balance',
            ),
        }),
        ('خلاصه و تاریخ‌ها', {'fields': (
            'balance',
            ('total_expense_afn_display', 'fee_per_dollar_afn_display', 'total_expense_usd_display'),
            ('profit_or_loss_afn_display', 'profit_or_loss_usd_display'),
            'created_by', 'created_display', 'updated_display',
        )}),
    )

    # --- list columns -------------------------------------------------------
    @admin.display(description='تاریخ (شمسی | میلادی)', ordering='date')
    def date_display(self, obj):
        return dual_date(obj.date)

    # --- row summary --------------------------------------------------------
    @admin.display(description='جمله مصرف افغانی')
    def total_expense_afn_display(self, obj):
        return _money(obj.total_expense_afn)

    @admin.display(description='فی دالر')
    def fee_per_dollar_afn_display(self, obj):
        return _money(obj.fee_per_dollar_afn)

    @admin.display(description='جمله مصرف دالر')
    def total_expense_usd_display(self, obj):
        return _money(obj.total_expense_usd)

    @admin.display(description='مفاد یا ضرر (افغانی)')
    def profit_or_loss_afn_display(self, obj):
        return _money(obj.profit_or_loss_afn)

    @admin.display(description='مفاد یا ضرر (دالر)')
    def profit_or_loss_usd_display(self, obj):
        return _money(obj.profit_or_loss_usd)

    @admin.display(description='تاریخ ثبت (شمسی | میلادی)')
    def created_display(self, obj):
        return dual_date(obj.created_at)

    @admin.display(description='آخرین تغییر (شمسی | میلادی)')
    def updated_display(self, obj):
        return dual_date(obj.updated_at)

    # --- who did it ---------------------------------------------------------
    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)

    def save_formset(self, request, form, formset, change):
        for document in formset.save(commit=False):
            if not document.pk:
                document.uploaded_by = request.user
            document.save()
        for document in formset.deleted_objects:
            document.delete()
        formset.save_m2m()


@admin.register(Document)
class DocumentAdmin(SimpleHistoryAdmin):
    list_display = ('__str__', 'transaction', 'uploaded_by', 'uploaded_display')
    list_filter = ('transaction__branch', 'transaction__trade_type')
    search_fields = ('title', 'transaction__serial_number', 'transaction__plate_afghan')
    list_select_related = ('transaction', 'uploaded_by')
    autocomplete_fields = ('transaction',)
    readonly_fields = ('uploaded_by', 'uploaded_display')
    fields = ('transaction', 'title', 'file', 'uploaded_by', 'uploaded_display')

    @admin.display(description='تاریخ آپلود (شمسی | میلادی)', ordering='uploaded_at')
    def uploaded_display(self, obj):
        return dual_date(obj.uploaded_at) if obj.pk else '—'

    def save_model(self, request, obj, form, change):
        if not change:
            obj.uploaded_by = request.user
        super().save_model(request, obj, form, change)
