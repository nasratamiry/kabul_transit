"""Security log entries for logins and user management (admin and API alike)."""
import logging

from django.contrib.auth.signals import user_logged_in, user_logged_out, user_login_failed
from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

from kabulcargo_backend.security import current_request, log_event

from .models import User


@receiver(user_logged_in)
def log_login(sender, request, user, **kwargs):
    log_event('login_success', request, username=user.get_username(), role=user.role)


@receiver(user_login_failed)
def log_login_failed(sender, credentials, request=None, **kwargs):
    # Django already masks the password in `credentials`; only the username is logged.
    log_event('login_failed', request, level=logging.WARNING, username=credentials.get('username'))


@receiver(user_logged_out)
def log_logout(sender, request, user, **kwargs):
    log_event('logout', request, username=user.get_username() if user else None)


@receiver(pre_save, sender=User)
def remember_previous_role(sender, instance, raw=False, **kwargs):
    if raw or instance.pk is None:
        instance._security_previous = None
        return
    instance._security_previous = User.objects.filter(pk=instance.pk).values('role', 'branch_id').first()


@receiver(post_save, sender=User)
def log_user_saved(sender, instance, created, raw=False, **kwargs):
    if raw:
        return
    request = current_request()
    if created:
        log_event('user_created', request, username=instance.username, role=instance.role, branch=instance.branch_id)
        return
    previous = getattr(instance, '_security_previous', None) or {}
    if previous.get('role') != instance.role:
        log_event('role_changed', request, username=instance.username, old=previous.get('role'), new=instance.role)
    if previous.get('branch_id') != instance.branch_id:
        log_event('branch_changed', request, username=instance.username,
                  old=previous.get('branch_id'), new=instance.branch_id)


@receiver(post_delete, sender=User)
def log_user_deleted(sender, instance, **kwargs):
    log_event('user_deleted', current_request(), username=instance.username, role=instance.role)
