from django.db import migrations

from kabulcargo_backend.migration_history import record_history

OLD, NEW = 'استراس', 'بندر والی'


def link_and_rename(apps, schema_editor):
    """
    Link every built-in money field's rows to its MoneyFieldType (the «عواید و مصارف» page manages
    them from now on), and show «استراس» as «بندر والی» in the stored labels — labels only,
    history-logged; no amount is touched.
    """
    FieldConfig = apps.get_model('config', 'FieldConfig')
    MoneyFieldType = apps.get_model('operations', 'MoneyFieldType')
    for money_type in MoneyFieldType.objects.exclude(column=''):
        FieldConfig.objects.filter(field_name=money_type.column, money_type__isnull=True).update(money_type=money_type)
    renamed = []
    for row in FieldConfig.objects.filter(field_label_fa__contains=OLD):
        row.field_label_fa = row.field_label_fa.replace(OLD, NEW)
        row.save(update_fields=['field_label_fa'])
        renamed.append(row)
    record_history(apps, 'config', 'FieldConfig', renamed, '~', 'نام «استراس» به «بندر والی» تغییر کرد')


class Migration(migrations.Migration):

    dependencies = [
        ('config', '0004_fieldconfig_money_type'),
        ('operations', '0008_seed_money_field_types'),
    ]

    operations = [
        migrations.RunPython(link_and_rename, migrations.RunPython.noop),
    ]
