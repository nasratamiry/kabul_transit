"""
Security log entries for exchange-rate changes (every AFN figure depends on them), and the
income-statement line of every revenue / expense type and office-income category, kept in step.
"""
from django.db.models import Max
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from kabulcargo_backend.security import current_request, log_event
from operations.models import MoneyFieldType

from .models import ExchangeRate, OfficeIncomeCategory, StatementLine

# Where a new line goes: after the existing lines of its section.
SECTION_BASE = {'REVENUE': 10, 'COGS': 100, 'OPEX': 200, 'OTHER': 300, 'OTHER_INCOME': 400}


def _free_code(prefix, code):
    base = f'{prefix}{code}'[:32]
    candidate, n = base, 2
    while StatementLine.objects.filter(code=candidate).exists():
        suffix = f'_{n}'
        candidate, n = base[:32 - len(suffix)] + suffix, n + 1
    return candidate


def sync_statement_line(source, prefix, code, section, label_fa, label_en, before, section_changed):
    """
    A new type / category gets its own active line; a renamed one updates its lines' labels; a
    type whose kind or section changed moves its lines. Each change is one history row.
    """
    lines = list(StatementLine.objects.filter(source_field=source))
    if not lines:
        if before is None:
            last = StatementLine.objects.filter(section=section).aggregate(m=Max('sort_order'))['m']
            StatementLine(code=_free_code(prefix, code), section=section, source_field=source,
                          label_fa=label_fa, label_en=label_en,
                          sort_order=(last + 1) if last is not None else SECTION_BASE[section]).save()
        return
    for line in lines:
        changes = {}
        if section_changed:
            changes['section'] = section
        if before is not None and before['name_fa'] != label_fa:
            changes['label_fa'] = label_fa
        if before is not None and before['name_en'] != label_en:
            changes['label_en'] = label_en
        changes = {name: value for name, value in changes.items() if getattr(line, name) != value}
        if changes:
            for name, value in changes.items():
                setattr(line, name, value)
            line.save()


@receiver(post_save, sender=MoneyFieldType)
def money_type_statement_line(sender, instance, created, raw=False, **kwargs):
    if raw:
        return
    before = getattr(instance, '_before', None)
    section = 'REVENUE' if instance.kind == MoneyFieldType.Kind.REVENUE else instance.section
    moved = before is not None and (before['kind'], before['section']) != (instance.kind, instance.section)
    sync_statement_line(instance.source, 'MNY_', instance.code, section, instance.name_fa, instance.name_en,
                        None if created else before, moved)


@receiver(post_save, sender=OfficeIncomeCategory)
def office_income_statement_line(sender, instance, created, raw=False, **kwargs):
    if raw:
        return
    sync_statement_line(instance.source, 'OI_', instance.code, 'OTHER_INCOME', instance.name_fa,
                        instance.name_en, None if created else getattr(instance, '_before', None), False)


@receiver(post_delete, sender=MoneyFieldType)
@receiver(post_delete, sender=OfficeIncomeCategory)
def drop_statement_line(sender, instance, **kwargs):
    """A deleted type / category (only possible without amounts) leaves no orphan line behind."""
    for line in StatementLine.objects.filter(source_field=instance.source):
        line.delete()


@receiver(post_save, sender=ExchangeRate)
def log_rate_saved(sender, instance, created, raw=False, **kwargs):
    if not raw:
        log_event('rate_created' if created else 'rate_changed', current_request(),
                  date=str(instance.date), currency=instance.currency, rate=str(instance.rate))


@receiver(post_delete, sender=ExchangeRate)
def log_rate_deleted(sender, instance, **kwargs):
    log_event('rate_deleted', current_request(), date=str(instance.date), currency=instance.currency,
              rate=str(instance.rate))
