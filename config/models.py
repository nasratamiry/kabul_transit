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


class DocumentRequirement(models.Model):
    """
    Which document types a branch needs for each trade type. Every branch has one row per
    trade type × document type (made automatically); the super admin ticks `required`.
    A missing required document only warns — it never blocks saving a transaction.
    """

    branch = models.ForeignKey('accounts.Branch', verbose_name='بندر / شعبه',
                               on_delete=models.CASCADE, related_name='document_requirements')
    trade_type = models.CharField('نوع معامله', max_length=20, choices=Transaction.TradeType.choices)
    doc_type = models.ForeignKey('operations.DocumentType', verbose_name='نوع سند',
                                 on_delete=models.CASCADE, related_name='requirements')
    required = models.BooleanField('لازم است', default=False,
                                   help_text='اگر تیک شود، معاملهٔ بدون این سند «سند ناقص» نشان داده می‌شود.')

    history = HistoricalRecords(verbose_name='تاریخچهٔ سند لازم')

    class Meta:
        verbose_name = 'سند لازم'
        verbose_name_plural = 'اسناد لازم'
        unique_together = ('branch', 'trade_type', 'doc_type')
        ordering = ['branch', 'trade_type', 'doc_type__sort_order']

    def __str__(self):
        return f'{self.branch} / {self.get_trade_type_display()} / {self.doc_type.name_fa}'


def missing_requirement_rows(branches=None, doc_types=None):
    """
    Unsaved DocumentRequirement rows for every branch × trade type × document type that has
    none yet; `required` follows DEFAULT_REQUIREMENTS. Existing rows are never touched.
    """
    from accounts.models import Branch
    from operations.document_defaults import DEFAULT_REQUIREMENTS
    from operations.models import DocumentType

    branches = list(Branch.objects.all() if branches is None else branches)
    doc_types = list(DocumentType.objects.all() if doc_types is None else doc_types)
    existing = set(DocumentRequirement.objects.filter(branch__in=branches, doc_type__in=doc_types)
                   .values_list('branch_id', 'trade_type', 'doc_type_id'))
    return [
        DocumentRequirement(branch=branch, trade_type=trade_type, doc_type=doc_type,
                            required=doc_type.code in DEFAULT_REQUIREMENTS.get(trade_type, ()))
        for branch in branches
        for trade_type in Transaction.TradeType.values
        for doc_type in doc_types
        if (branch.pk, trade_type, doc_type.pk) not in existing
    ]
