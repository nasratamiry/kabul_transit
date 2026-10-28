from django.core.exceptions import ValidationError
from django.db import models
from simple_history.models import HistoricalRecords

from operations.models import MoneyFieldType, Transaction

# Set by the page itself (one page per branch + trade type), never by FieldConfig.
_NOT_CONFIGURABLE = {'branch', 'trade_type'}

# Always REQUIRED, in every branch and trade type: without them a transaction cannot be saved
# (serial_number has no default) or its revenue cannot be converted to AFN.
LOCKED_FIELDS = ('serial_number', 'date', 'customer_payment', 'currency', 'exchange_rate')


def configurable_transaction_fields():
    """(name, Dari label) for every Transaction field a form can show, in model order."""
    return [
        (field.name, str(field.verbose_name))
        for field in Transaction._meta.concrete_fields
        if field.editable and not field.primary_key and field.name not in _NOT_CONFIGURABLE
    ]


class FieldConfig(models.Model):
    """
    Per-branch, per-trade-type visibility rule for every Transaction field, and for every
    revenue / expense type (money_type set; added types use field_name '@money:<code>').
    Super admin controls which fields appear, which are required, and in what order (money
    types: in MoneyFieldType.sort_order). The frontend's dynamic form reads this.
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
    money_type = models.ForeignKey(MoneyFieldType, verbose_name='نوع عاید / مصرف', on_delete=models.CASCADE,
                                   null=True, blank=True, editable=False, related_name='field_configs',
                                   help_text='برای فیلدهای پولی؛ این ردیف‌ها در صفحهٔ «عواید و مصارف» اداره می‌شوند')

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
        # field_name must be a Transaction field that a form can actually show, or an added money type
        known = (MoneyFieldType.objects.filter(code=self.field_name[len('@money:'):]).exists()
                 if self.field_name.startswith('@money:') else self.field_name in dict(configurable_transaction_fields()))
        if not known:
            raise ValidationError({'field_name': f'فیلد «{self.field_name}» در مدل معامله موجود نیست.'})
        if self.field_name in LOCKED_FIELDS and self.visibility != self.Visibility.REQUIRED:
            raise ValidationError({'visibility': f'فیلد «{self.field_label_fa}» قفل است و همیشه «اجباری» '
                                                 'می‌ماند؛ بدون آن معامله ثبت یا حساب شده نمی‌تواند.'})


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


def money_field_rows(branches=None, money_types=None):
    """
    Unsaved FieldConfig rows (OPTIONAL) for every branch × trade type × added money type that
    has none yet. The built-in money columns get theirs from FIELD_SPEC like any other field.
    """
    from accounts.models import Branch

    branches = list(Branch.objects.all() if branches is None else branches)
    money_types = [t for t in (MoneyFieldType.objects.filter(column='') if money_types is None else money_types)
                   if not t.column]
    existing = set(FieldConfig.objects.filter(branch__in=branches, money_type__in=money_types)
                   .values_list('branch_id', 'trade_type', 'money_type_id'))
    return [
        FieldConfig(branch=branch, trade_type=trade_type, field_name=money_type.source,
                    field_label_fa=money_type.name_fa, visibility=FieldConfig.Visibility.OPTIONAL,
                    sort_order=money_type.sort_order, money_type=money_type)
        for branch in branches
        for trade_type in Transaction.TradeType.values
        for money_type in money_types
        if (branch.pk, trade_type, money_type.pk) not in existing
    ]


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
