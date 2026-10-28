from django.db import migrations

from kabulcargo_backend.migration_history import record_history
from operations.money import BUILTIN_MONEY_TYPES


def seed_types(apps, schema_editor):
    """
    The 14 built-in revenue / expense types, one per money column, with the classification the
    system always had: customer_payment revenue, the other 13 expenses. Each expense keeps the
    income-statement section its active line already has, so no total moves.
    """
    MoneyFieldType = apps.get_model('operations', 'MoneyFieldType')
    StatementLine = apps.get_model('finance', 'StatementLine')
    live_sections = dict(StatementLine.objects.filter(is_active=True).values_list('source_field', 'section'))
    created = []
    for column, code, name_fa, name_ps, name_en, kind, section, sort_order in BUILTIN_MONEY_TYPES:
        if kind == 'EXPENSE' and live_sections.get(column) in ('COGS', 'OPEX', 'OTHER'):
            section = live_sections[column]
        money_type, was_created = MoneyFieldType.objects.get_or_create(code=code, defaults={
            'column': column, 'name_fa': name_fa, 'name_ps': name_ps, 'name_en': name_en, 'kind': kind,
            'section': section, 'sort_order': sort_order, 'is_active': True, 'is_builtin': True,
        })
        if was_created:
            created.append(money_type)
    record_history(apps, 'operations', 'MoneyFieldType', created, '+', 'نوع داخلی سیستم (مایگریشن)')


class Migration(migrations.Migration):

    dependencies = [
        ('operations', '0007_money_field_types'),
        ('finance', '0002_statement_line'),
    ]

    operations = [
        migrations.RunPython(seed_types, migrations.RunPython.noop),
    ]
