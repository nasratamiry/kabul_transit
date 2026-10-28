from django.db.models.signals import post_save
from django.dispatch import receiver
from simple_history.utils import bulk_create_with_history

from accounts.models import Branch
from operations.models import MoneyFieldType


@receiver(post_save, sender=Branch)
def auto_seed_field_config_for_new_branch(sender, instance, created, raw=False, **kwargs):
    """When a new Branch is created, immediately populate its FieldConfig rows
    for all 4 trade types × 43 fields (172 rows), with the same defaults and
    trade-type overrides as the seed_field_config command. Running the manual
    command afterwards is still safe — it is idempotent."""
    if not created or raw:  # raw = loading fixtures; those carry their own rows
        return
    # Avoid circular import at module load.
    from config.management.commands.seed_field_config import default_field_configs
    from config.models import FieldConfig

    from config.models import money_field_rows

    builtin_types = {t.column: t for t in MoneyFieldType.objects.exclude(column='')}
    rows = [
        FieldConfig(branch=instance, trade_type=trade_type, field_name=field_name,
                    money_type=builtin_types.get(field_name), **defaults)
        for trade_type, field_name, defaults in default_field_configs()
    ] + money_field_rows(branches=[instance])
    # A brand-new branch has no rows yet, so there is nothing to conflict with.
    # bulk_create_with_history also writes the audit rows that a plain
    # bulk_create would skip, credited to whoever created the branch.
    creation = instance.history.order_by('-history_date').first()
    bulk_create_with_history(rows, FieldConfig, default_user=creation.history_user if creation else None)


@receiver(post_save, sender=Branch)
def auto_seed_document_requirements_for_new_branch(sender, instance, created, raw=False, **kwargs):
    """A new branch gets its document-requirement grid (defaults per trade type) right away."""
    if not created or raw:
        return
    from config.models import DocumentRequirement, missing_requirement_rows

    creation = instance.history.order_by('-history_date').first()
    bulk_create_with_history(missing_requirement_rows(branches=[instance]), DocumentRequirement,
                             default_user=creation.history_user if creation else None)


@receiver(post_save, sender=MoneyFieldType)
def add_money_type_to_every_form(sender, instance, created, raw=False, **kwargs):
    """
    A new revenue / expense type gets a FieldConfig row (اختیاری) in every branch × trade type;
    a renamed one keeps its rows' label in step.
    """
    if raw:
        return
    from config.models import FieldConfig, money_field_rows

    if created:
        creation = instance.history.order_by('-history_date').first()
        bulk_create_with_history(money_field_rows(money_types=[instance]), FieldConfig,
                                 default_user=creation.history_user if creation else None)
    elif instance._before and instance._before['name_fa'] != instance.name_fa:
        FieldConfig.objects.filter(money_type=instance).update(field_label_fa=instance.name_fa)


@receiver(post_save, sender='operations.DocumentType')
def add_new_document_type_to_every_branch(sender, instance, created, raw=False, **kwargs):
    """A new document type appears in every branch's grid, not required until the admin ticks it."""
    if not created or raw:
        return
    from config.models import DocumentRequirement, missing_requirement_rows

    creation = instance.history.order_by('-history_date').first()
    bulk_create_with_history(missing_requirement_rows(doc_types=[instance]), DocumentRequirement,
                             default_user=creation.history_user if creation else None)
