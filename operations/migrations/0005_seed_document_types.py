from django.db import migrations

from operations.document_defaults import DEFAULT_DOCUMENT_TYPES, FALLBACK_TYPE


def seed_types(apps, schema_editor):
    """Create the default document types and file every existing upload under «سایر اسناد»."""
    DocumentType = apps.get_model('operations', 'DocumentType')
    Document = apps.get_model('operations', 'Document')
    for code, name_fa, name_ps, name_en, number_field, sort_order in DEFAULT_DOCUMENT_TYPES:
        DocumentType.objects.get_or_create(code=code, defaults={
            'name_fa': name_fa, 'name_ps': name_ps, 'name_en': name_en,
            'number_field': number_field, 'sort_order': sort_order,
        })
    fallback = DocumentType.objects.get(code=FALLBACK_TYPE)
    Document.objects.filter(doc_type__isnull=True).update(doc_type=fallback)


class Migration(migrations.Migration):

    dependencies = [
        ('operations', '0004_document_types'),
    ]

    operations = [
        migrations.RunPython(seed_types, migrations.RunPython.noop),
    ]
