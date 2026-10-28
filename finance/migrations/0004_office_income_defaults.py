from django.db import migrations

from finance.office_income_defaults import DEFAULT_OFFICE_INCOME_CATEGORIES
from kabulcargo_backend.migration_history import record_history

RENAMES = (('استراس', 'بندر والی'), ('Estras', 'Bandar Wali'))


def seed(apps, schema_editor):
    """
    Default office-income categories, each with its own «سایر عواید» statement line; and the
    statement lines' «استراس» shown as «بندر والی» (labels only, history-logged).
    """
    Category = apps.get_model('finance', 'OfficeIncomeCategory')
    StatementLine = apps.get_model('finance', 'StatementLine')
    created, lines = [], []
    for code, name_fa, name_ps, name_en, sort_order in DEFAULT_OFFICE_INCOME_CATEGORIES:
        category, was_created = Category.objects.get_or_create(code=code, defaults={
            'name_fa': name_fa, 'name_ps': name_ps, 'name_en': name_en, 'sort_order': sort_order})
        if was_created:
            created.append(category)
        source = f'@office_income:{code}'
        if not StatementLine.objects.filter(source_field=source).exists():
            lines.append(StatementLine.objects.create(
                code=f'OI_{code}'[:32], section='OTHER_INCOME', source_field=source, label_fa=name_fa,
                label_en=name_en, sort_order=400 + sort_order // 10))
    record_history(apps, 'finance', 'OfficeIncomeCategory', created, '+', 'کتگوری پیش‌فرض (مایگریشن)')
    record_history(apps, 'finance', 'StatementLine', lines, '+', 'سطر سایر عواید (مایگریشن)')

    renamed = []
    for line in StatementLine.objects.all():
        label_fa, label_en = line.label_fa, line.label_en
        for old, new in RENAMES:
            label_fa, label_en = label_fa.replace(old, new), label_en.replace(old, new)
        if (label_fa, label_en) != (line.label_fa, line.label_en):
            line.label_fa, line.label_en = label_fa, label_en
            line.save(update_fields=['label_fa', 'label_en'])
            renamed.append(line)
    record_history(apps, 'finance', 'StatementLine', renamed, '~', 'نام «استراس» به «بندر والی» تغییر کرد')


class Migration(migrations.Migration):

    dependencies = [
        ('finance', '0003_office_income'),
    ]

    operations = [
        migrations.RunPython(seed, migrations.RunPython.noop),
    ]
