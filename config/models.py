from django.core.exceptions import ValidationError
from django.db import models
from simple_history.models import HistoricalRecords

from operations.models import Transaction

# Set by the page itself (one page per branch + trade type), never by FieldConfig.
_NOT_CONFIGURABLE = {'branch', 'trade_type'}


def configurable_transaction_fields():
    """(name, Dari label) for every Transaction field a form can show, in model order."""
    return [
        (field.name, str(field.verbose_name))
        for field in Transaction._meta.concrete_fields
        if field.editable and not field.primary_key and field.name not in _NOT_CONFIGURABLE
    ]


class FieldConfig(models.Model):
    """
    Per-branch, per-trade-type visibility rule for every Transaction field.
    Super admin controls which fields appear, which are required, and in what
    order. The frontend's dynamic form reads this.
    """

    class Visibility(models.TextChoices):
        REQUIRED = 'REQUIRED', 'اجباری'
        OPTIONAL = 'OPTIONAL', 'اختیاری'
        HIDDEN = 'HIDDEN', 'پنهان'

    branch = models.ForeignKey('accounts.Branch', verbose_name='بندر / شعبه',
                               on_delete=models.CASCADE, related_name='field_configs')
    trade_type = models.CharField('نوع معامله', max_length=20,
                                  choices=Transaction.TradeType.choices)
    field_name = models.CharField('نام فنی فیلد', max_length=60,
                                  help_text='نام فیلد در مدل Transaction')
    field_label_fa = models.CharField('نام فیلد (دری)', max_length=120)
    visibility = models.CharField('وضعیت', max_length=10,
                                  choices=Visibility.choices, default=Visibility.OPTIONAL)
    sort_order = models.PositiveIntegerField('ترتیب نمایش', default=100,
                                             help_text='عدد کمتر = بالاتر در فورم')

    history = HistoricalRecords(verbose_name='تاریخچهٔ تنظیم فیلد')

    class Meta:
        verbose_name = 'تنظیم فیلد'
        verbose_name_plural = 'تنظیمات فیلدها'
        unique_together = ('branch', 'trade_type', 'field_name')
        ordering = ['branch', 'trade_type', 'sort_order', 'field_name']
        indexes = [models.Index(fields=['branch', 'trade_type', 'sort_order'],
                                name='fc_branch_type_sort')]

    def __str__(self):
        return f'{self.branch} / {self.get_trade_type_display()} / {self.field_label_fa}'

    def clean(self):
        # field_name must be a Transaction field that a form can actually show
        if self.field_name not in dict(configurable_transaction_fields()):
            raise ValidationError({'field_name': f'فیلد «{self.field_name}» در مدل معامله موجود نیست.'})
