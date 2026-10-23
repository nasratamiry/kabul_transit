from urllib.parse import urlencode

from django import forms
from django.contrib import admin, messages
from django.shortcuts import redirect
from django.urls import reverse
from django.utils.http import url_has_allowed_host_and_scheme
from django_jalali.admin.filters import JDateFieldListFilter
from django_jalali.admin.widgets import AdminjDateWidget
from django_jalali.db import models as jmodels
from simple_history.admin import SimpleHistoryAdmin

from kabulcargo_backend.forms import DigitNormalizingModelForm
from kabulcargo_backend.utils import dual_date

from .models import ExchangeRate, Hawala, OfficeExpense, StatementLine, statement_source_choices
from .utils import TodayRateMissing, get_todays_usd_rate


class TodayRateRequiredAdminMixin:
    """
    Daily-rate soft lock for the admin: a new record cannot be added until
    today's USD→AFN rate exists. The user is sent to the rate form and then
    straight back to the form they wanted.
    """

    def add_view(self, request, form_url='', extra_context=None):
        if get_todays_usd_rate() is None:
            messages.warning(request, TodayRateMissing.detail_fa)
            query = urlencode({'currency': 'USD', 'next': request.get_full_path()})
            return redirect(f"{reverse('admin:finance_exchangerate_add')}?{query}")
        return super().add_view(request, form_url, extra_context)


class CreatedByAdminMixin:
    formfield_overrides = {jmodels.jDateField: {'widget': AdminjDateWidget}}

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)

    @admin.display(description='تاریخ (شمسی | میلادی)', ordering='date')
    def date_display(self, obj):
        return dual_date(obj.date)

    @admin.display(description='تاریخ ثبت (شمسی | میلادی)', ordering='created_at')
    def created_display(self, obj):
        return dual_date(obj.created_at)

    @admin.display(description='آخرین تغییر (شمسی | میلادی)')
    def updated_display(self, obj):
        return dual_date(obj.updated_at)


# ---------------------------------------------------------------------------
# ExchangeRate
# ---------------------------------------------------------------------------
class ExchangeRateForm(DigitNormalizingModelForm):
    digit_fields = ('date',)

    class Meta:
        model = ExchangeRate
        fields = '__all__'


@admin.register(ExchangeRate)
class ExchangeRateAdmin(CreatedByAdminMixin, SimpleHistoryAdmin):
    form = ExchangeRateForm
    list_display = ('date_display', 'currency', 'rate', 'created_by', 'created_display')
    list_filter = ('currency', ('date', JDateFieldListFilter))
    search_fields = ('currency',)
    ordering = ('-date', 'currency')
    fields = ('date', 'currency', 'rate', 'created_by', 'created_display')
    readonly_fields = ('created_by', 'created_display')

    def response_add(self, request, obj, post_url_continue=None):
        # Coming from the soft lock: go back to the form the user wanted.
        next_url = request.GET.get('next')
        if next_url and '_continue' not in request.POST and '_addanother' not in request.POST \
                and url_has_allowed_host_and_scheme(next_url, allowed_hosts={request.get_host()}):
            messages.success(request, f'نرخ ثبت شد: {obj}')
            return redirect(next_url)
        return super().response_add(request, obj, post_url_continue)


# ---------------------------------------------------------------------------
# Hawala
# ---------------------------------------------------------------------------
class HawalaForm(DigitNormalizingModelForm):
    digit_fields = ('date',)

    class Meta:
        model = Hawala
        fields = '__all__'


@admin.register(Hawala)
class HawalaAdmin(TodayRateRequiredAdminMixin, CreatedByAdminMixin, SimpleHistoryAdmin):
    form = HawalaForm
    list_display = ('date_display', 'branch', 'from_party', 'to_party', 'amount', 'currency', 'fee', 'rate_used')
    list_filter = ('branch', 'currency', ('date', JDateFieldListFilter))
    search_fields = ('from_party', 'to_party', 'note')
    list_select_related = ('branch',)
    autocomplete_fields = ('branch',)
    readonly_fields = ('rate_used', 'created_by', 'created_display', 'updated_display')
    fieldsets = (
        ('معلومات حواله', {'fields': ('branch', 'date', 'from_party', 'to_party')}),
        ('مالی', {'fields': ('amount', 'currency', 'fee', 'rate_used')}),
        ('ملاحظات و زمان', {'fields': ('note', 'created_by', 'created_display', 'updated_display')}),
    )


# ---------------------------------------------------------------------------
# OfficeExpense
# ---------------------------------------------------------------------------
class OfficeExpenseForm(DigitNormalizingModelForm):
    digit_fields = ('date', 'bill_number')

    class Meta:
        model = OfficeExpense
        fields = '__all__'


@admin.register(OfficeExpense)
class OfficeExpenseAdmin(TodayRateRequiredAdminMixin, CreatedByAdminMixin, SimpleHistoryAdmin):
    form = OfficeExpenseForm
    list_display = ('date_display', 'branch', 'category', 'amount', 'currency', 'person', 'bill_number',
                    'amount_afn_display')
    list_filter = ('branch', 'category', 'currency', ('date', JDateFieldListFilter))
    search_fields = ('person', 'bill_number', 'description')
    list_select_related = ('branch',)
    autocomplete_fields = ('branch',)
    readonly_fields = ('rate_used', 'amount_afn_display', 'created_by', 'created_display', 'updated_display')
    fieldsets = (
        ('مصرف', {'fields': ('branch', 'date', 'category', 'amount', 'currency')}),
        ('جزئیات', {'fields': ('person', 'bill_number', 'description')}),
        ('محاسبهٔ خودکار', {'fields': ('rate_used', 'amount_afn_display')}),
        ('زمان', {'fields': ('created_by', 'created_display', 'updated_display')}),
    )

    @admin.display(description='معادل افغانی')
    def amount_afn_display(self, obj):
        val = obj.amount_afn
        return f'{val:,.2f} AFN' if val is not None else '— (نرخ آن روز موجود نیست)'


# ---------------------------------------------------------------------------
# StatementLine (income statement) — super admin only
# ---------------------------------------------------------------------------
class StatementLineForm(forms.ModelForm):
    source_field = forms.ChoiceField(label='منبع مبلغ', choices=statement_source_choices,
                                     help_text=StatementLine._meta.get_field('source_field').help_text)

    class Meta:
        model = StatementLine
        fields = '__all__'


@admin.register(StatementLine)
class StatementLineAdmin(SimpleHistoryAdmin):
    form = StatementLineForm
    list_display = ('label_fa', 'code', 'section', 'source_field', 'sort_order', 'is_active')
    list_editable = ('sort_order', 'is_active')
    list_filter = ('section', 'is_active')
    search_fields = ('code', 'label_fa', 'label_en')
    ordering = ('sort_order', 'code')
    fieldsets = (
        ('سطر', {'fields': ('section', 'code', 'label_fa', 'label_en')}),
        ('مبلغ', {'fields': ('source_field',),
                  'description': 'عاید فقط «پرداخت مشتری» است؛ همه منابع دیگر مصرف هستند.'}),
        ('نمایش', {'fields': ('sort_order', 'is_active')}),
    )

    def _is_super_admin(self, request):
        return getattr(request.user, 'is_super_admin', False)

    def has_add_permission(self, request):
        return self._is_super_admin(request)

    def has_change_permission(self, request, obj=None):
        return self._is_super_admin(request)

    def has_delete_permission(self, request, obj=None):
        return self._is_super_admin(request)
