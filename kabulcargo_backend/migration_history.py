"""Audit rows written from data migrations (historical models have no simple-history signals)."""
from django.utils import timezone


def record_history(apps, app_label, model_name, objects, history_type, reason):
    """
    One simple-history row per object, as if it had been saved by the app: '+' created,
    '~' changed. history_user is empty (the system did it); `reason` says why.
    """
    historical = apps.get_model(app_label, f'Historical{model_name}')
    names = {field.attname for field in historical._meta.concrete_fields}
    now = timezone.now()
    rows = []
    for obj in objects:
        values = {field.attname: getattr(obj, field.attname) for field in obj._meta.concrete_fields
                  if field.attname in names}
        rows.append(historical(**values, history_date=now, history_type=history_type,
                               history_change_reason=reason[:100]))
    historical.objects.bulk_create(rows)
