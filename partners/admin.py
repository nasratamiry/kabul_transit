from django.contrib import admin
from simple_history.admin import SimpleHistoryAdmin

from kabulcargo_backend.utils import dual_date

from .models import Trader, TransportCompany


@admin.register(Trader)
class TraderAdmin(SimpleHistoryAdmin):
    list_display = ('name', 'company_name', 'phone', 'is_active')
    list_filter = ('is_active',)
    search_fields = ('name', 'company_name', 'phone', 'national_id')
    ordering = ('name',)
    readonly_fields = ('created_display',)
    fieldsets = (
        ('معلومات تاجر', {'fields': ('name', 'company_name', 'national_id', 'is_active')}),
        ('آدرس و تماس', {'fields': ('phone', 'address')}),
        ('ملاحظات', {'fields': ('note',)}),
        ('تاریخ‌ها', {'fields': ('created_display',)}),
    )

    @admin.display(description='تاریخ ثبت (شمسی | میلادی)')
    def created_display(self, obj):
        return dual_date(obj.created_at)


@admin.register(TransportCompany)
class TransportCompanyAdmin(SimpleHistoryAdmin):
    list_display = ('name', 'country', 'phone', 'is_active')
    list_filter = ('is_active', 'country')
    search_fields = ('name',)
    ordering = ('name',)
    readonly_fields = ('created_display',)
    fieldsets = (
        ('معلومات شرکت', {'fields': ('name', 'country', 'is_active')}),
        ('تماس', {'fields': ('phone',)}),
        ('ملاحظات', {'fields': ('note',)}),
        ('تاریخ‌ها', {'fields': ('created_display',)}),
    )

    @admin.display(description='تاریخ ثبت (شمسی | میلادی)')
    def created_display(self, obj):
        return dual_date(obj.created_at)
