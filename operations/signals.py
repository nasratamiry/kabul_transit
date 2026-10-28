from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .models import Document, TransactionMoneyLine, refresh_balance


@receiver(post_save, sender=TransactionMoneyLine)
@receiver(post_delete, sender=TransactionMoneyLine)
def keep_balance_current(sender, instance, raw=False, **kwargs):
    """A changed money line changes its transaction's revenue or expenses, so its stored balance too."""
    if not raw:
        refresh_balance(instance.transaction_id)


@receiver(post_delete, sender=Document)
def delete_document_file(sender, instance, **kwargs):
    """
    Remove the stored file when its Document row is deleted (also when a whole Transaction
    is deleted and its documents go with it). Django never deletes files by itself, so
    without this every deleted document would stay on disk for good. Done after the commit,
    so a rolled-back delete keeps its file.
    """
    if not instance.file:
        return
    storage, name = instance.file.storage, instance.file.name
    transaction.on_commit(lambda: storage.delete(name))
