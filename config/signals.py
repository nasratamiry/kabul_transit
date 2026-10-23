from django.db.models.signals import post_save
from django.dispatch import receiver
from simple_history.utils import bulk_create_with_history

from accounts.models import Branch


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

    rows = [
        FieldConfig(branch=instance, trade_type=trade_type, field_name=field_name, **defaults)
        for trade_type, field_name, defaults in default_field_configs()
    ]
    # A brand-new branch has no rows yet, so there is nothing to conflict with.
    # bulk_create_with_history also writes the audit rows that a plain
    # bulk_create would skip, credited to whoever created the branch.
    creation = instance.history.order_by('-history_date').first()
    bulk_create_with_history(rows, FieldConfig, default_user=creation.history_user if creation else None)
