from django.apps import apps
from django.contrib import admin
from django.contrib.auth.admin import GroupAdmin as BaseGroupAdmin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.models import Group
from simple_history.admin import SimpleHistoryAdmin

from kabulcargo_backend.utils import dual_date

from .models import Branch, User

admin.site.site_header = 'سیستم مدیریت کابل کارگو'
admin.site.site_title = 'سیستم مدیریت کابل کارگو'
admin.site.index_title = 'پنل مدیریت'


# ---------------------------------------------------------------------------
# Dari labels for permissions ("Can add user" -> "افزودن کاربر")
# ---------------------------------------------------------------------------
_PERMISSION_ACTIONS = {'add': 'افزودن', 'change': 'ویرایش', 'delete': 'حذف', 'view': 'مشاهده'}


def dari_permission_label(permission):
    action, _, _ = permission.codename.partition('_')
    content_type = permission.content_type
    model = content_type.model_class()
    if action not in _PERMISSION_ACTIONS or model is None:
        return permission.name
    app_name = apps.get_app_config(content_type.app_label).verbose_name
    return f'{app_name} | {_PERMISSION_ACTIONS[action]} {model._meta.verbose_name}'


def with_dari_permission_labels(formfield):
    if formfield is not None:
        formfield.queryset = formfield.queryset.select_related('content_type')
        formfield.label_from_instance = dari_permission_label
    return formfield


# ---------------------------------------------------------------------------
# Branch
# ---------------------------------------------------------------------------
@admin.register(Branch)
class BranchAdmin(SimpleHistoryAdmin):
    list_display = ('name', 'code', 'city', 'is_active')
    list_filter = ('is_active',)
    search_fields = ('name', 'code', 'city')
    ordering = ('name',)
    readonly_fields = ('created_display',)
    fieldsets = (
        ('معلومات بندر', {'fields': ('name', 'code', 'is_active')}),
        ('آدرس و تماس', {'fields': ('city', 'address', 'phone')}),
        ('تاریخ‌ها', {'fields': ('created_display',)}),
    )

    def get_readonly_fields(self, request, obj=None):
        # Same rule as the API: the code is fixed once the branch exists.
        return self.readonly_fields + (('code',) if obj else ())

    @admin.display(description='تاریخ ثبت (شمسی | میلادی)')
    def created_display(self, obj):
        return dual_date(obj.created_at)


# ---------------------------------------------------------------------------
# User
# ---------------------------------------------------------------------------
@admin.register(User)
class UserAdmin(BaseUserAdmin, SimpleHistoryAdmin):
    list_display = ('username', 'full_name', 'role', 'branch', 'is_active', 'last_login_display')
    list_filter = ('role', 'branch', 'is_active')
    search_fields = ('username', 'first_name', 'last_name', 'phone')
    list_select_related = ('branch',)
    ordering = ('username',)
    readonly_fields = ('last_login_display', 'date_joined_display')
    fieldsets = (
        ('هویت کاربر', {'fields': ('username', 'password', 'first_name', 'last_name', 'phone', 'email')}),
        ('نقش و دسترسی', {'fields': ('role', 'branch', 'is_active'),
                          'description': 'مدیر بندر فقط اطلاعات بندر خود را می‌بیند. سوپر ادمین بندر ندارد.'}),
        ('صلاحیت‌های سیستم', {'fields': ('is_staff', 'is_superuser', 'groups', 'user_permissions'),
                               'classes': ('collapse',)}),
        ('تاریخ‌ها', {'fields': ('last_login_display', 'date_joined_display')}),
    )
    add_fieldsets = (
        ('هویت کاربر', {'classes': ('wide',),
                        'fields': ('username', 'password1', 'password2', 'first_name', 'last_name', 'phone')}),
        ('نقش و دسترسی', {'fields': ('role', 'branch')}),
    )

    @admin.display(description='نام کامل', ordering='first_name')
    def full_name(self, obj):
        return obj.get_full_name() or '—'

    @admin.display(description='آخرین ورود (شمسی | میلادی)', ordering='last_login')
    def last_login_display(self, obj):
        return dual_date(obj.last_login)

    @admin.display(description='تاریخ ثبت (شمسی | میلادی)')
    def date_joined_display(self, obj):
        return dual_date(obj.date_joined)

    def formfield_for_manytomany(self, db_field, request, **kwargs):
        formfield = super().formfield_for_manytomany(db_field, request, **kwargs)
        if db_field.name == 'user_permissions':
            return with_dari_permission_labels(formfield)
        return formfield


# ---------------------------------------------------------------------------
# Groups — same page, Dari permission labels
# ---------------------------------------------------------------------------
admin.site.unregister(Group)


@admin.register(Group)
class GroupAdmin(BaseGroupAdmin):
    def formfield_for_manytomany(self, db_field, request, **kwargs):
        formfield = super().formfield_for_manytomany(db_field, request, **kwargs)
        if db_field.name == 'permissions':
            return with_dari_permission_labels(formfield)
        return formfield
