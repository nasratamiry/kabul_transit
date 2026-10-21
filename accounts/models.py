from django.contrib.auth.models import AbstractUser, UserManager
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from simple_history.models import HistoricalRecords

from kabulcargo_backend.utils import normalize_digits


class Branch(models.Model):
    """A port branch (or the Kabul office). Added by the super admin — never hardcoded."""

    name = models.CharField('نام بندر/شعبه', max_length=120, unique=True)
    code = models.CharField('کود بندر', max_length=20, unique=True,
                            help_text='کود کوتاه مثل KBL، TKH، HIR — دستی وارد شود')
    city = models.CharField('شهر', max_length=120, blank=True)
    address = models.CharField('آدرس', max_length=255, blank=True)
    phone = models.CharField('تماس', max_length=40, blank=True,
                             help_text='ارقام دری یا انگلیسی هر دو قبول است')
    is_active = models.BooleanField('فعال', default=True)
    created_at = models.DateTimeField('تاریخ ثبت', auto_now_add=True)

    history = HistoricalRecords(verbose_name='تاریخچه بندر')

    class Meta:
        verbose_name = 'بندر / شعبه'
        verbose_name_plural = 'بندرها / شعبات'
        ordering = ['name']

    def __str__(self):
        return f'{self.name} ({self.code})'

    def clean(self):
        self.code = normalize_digits(self.code).upper()
        self.phone = normalize_digits(self.phone)


class KabulCargoUserManager(UserManager):
    def create_superuser(self, username, email=None, password=None, **extra_fields):
        extra_fields.setdefault('role', User.Role.SUPER_ADMIN)
        return super().create_superuser(username, email, password, **extra_fields)


class User(AbstractUser):
    """System user. Only two roles exist: super admin (Kabul) and branch manager."""

    class Role(models.TextChoices):
        SUPER_ADMIN = 'super_admin', 'سوپر ادمین'
        BRANCH_MANAGER = 'branch_manager', 'مدیر بندر'

    role = models.CharField('نقش', max_length=20, choices=Role.choices, default=Role.BRANCH_MANAGER)
    branch = models.ForeignKey(Branch, verbose_name='بندر', on_delete=models.PROTECT,
                               related_name='users', null=True, blank=True,
                               help_text='سوپر ادمین بندر ندارد.')
    phone = models.CharField('نمبر تماس', max_length=40, blank=True,
                             help_text='ارقام دری یا انگلیسی هر دو قبول است')

    objects = KabulCargoUserManager()
    history = HistoricalRecords(verbose_name='تاریخچه کاربر', excluded_fields=['password', 'last_login'])

    class Meta:
        verbose_name = 'کاربر'
        verbose_name_plural = 'کاربران'
        constraints = [
            # Same rule as clean(), enforced by the database too.
            models.CheckConstraint(
                condition=(Q(role='super_admin', branch__isnull=True)
                           | Q(role='branch_manager', branch__isnull=False)),
                name='user_role_branch_consistent',
            ),
        ]

    def __str__(self):
        full_name = self.get_full_name()
        return f'{full_name} ({self.username})' if full_name else self.username

    @property
    def is_super_admin(self):
        return self.role == self.Role.SUPER_ADMIN

    @property
    def is_branch_manager(self):
        return self.role == self.Role.BRANCH_MANAGER

    def clean(self):
        super().clean()
        self.phone = normalize_digits(self.phone)
        if self.role == self.Role.BRANCH_MANAGER and not self.branch:
            raise ValidationError({'branch': 'مدیر بندر باید به یک بندر وصل شود.'})
        if self.role == self.Role.SUPER_ADMIN and self.branch:
            raise ValidationError({'branch': 'سوپر ادمین نباید به بندر خاصی وصل شود.'})


# Dari labels for the fields inherited from Django's AbstractUser.
_INHERITED_LABELS = {
    'username': ('نام کاربری', 'فقط حروف انگلیسی، ارقام و علامه‌های @/./+/-/_'),
    'password': ('رمز عبور', None),
    'first_name': ('نام', None),
    'last_name': ('تخلص', None),
    'email': ('ایمیل', None),
    'is_active': ('فعال', 'اگر کاربر نباید وارد سیستم شود، این را خاموش کنید (به جای حذف).'),
    'is_staff': ('دسترسی به پنل مدیریت', 'آیا کاربر می‌تواند وارد این پنل مدیریت شود؟'),
    'is_superuser': ('دسترسی کامل فنی', 'همه صلاحیت‌ها بدون تعیین جداگانه داده می‌شود.'),
    'last_login': ('آخرین ورود', None),
    'date_joined': ('تاریخ ثبت', None),
    'groups': ('گروه‌ها', None),
    'user_permissions': ('صلاحیت‌های کاربر', None),
}
for _name, (_label, _help) in _INHERITED_LABELS.items():
    _field = User._meta.get_field(_name)
    _field.verbose_name = _label
    if _help:
        _field.help_text = _help
