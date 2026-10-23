"""Security log entries for exchange-rate changes (every AFN figure depends on them)."""
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from kabulcargo_backend.security import current_request, log_event

from .models import ExchangeRate


@receiver(post_save, sender=ExchangeRate)
def log_rate_saved(sender, instance, created, raw=False, **kwargs):
    if not raw:
        log_event('rate_created' if created else 'rate_changed', current_request(),
                  date=str(instance.date), currency=instance.currency, rate=str(instance.rate))


@receiver(post_delete, sender=ExchangeRate)
def log_rate_deleted(sender, instance, **kwargs):
    log_event('rate_deleted', current_request(), date=str(instance.date), currency=instance.currency,
              rate=str(instance.rate))
