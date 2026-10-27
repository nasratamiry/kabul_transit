from django.db import migrations

from operations.document_defaults import DEFAULT_REQUIREMENTS

TRADE_TYPES = ('EXPORT', 'IMPORT', 'TRANSIT', 'TIR_CARNET')


def seed_requirements(apps, schema_editor):
    """Existing branches get the same requirement grid a new branch gets from the signal."""
    Branch = apps.get_model('accounts', 'Branch')
    DocumentType = apps.get_model('operations', 'DocumentType')
    DocumentRequirement = apps.get_model('config', 'DocumentRequirement')
    doc_types = list(DocumentType.objects.all())
    existing = set(DocumentRequirement.objects.values_list('branch_id', 'trade_type', 'doc_type_id'))
    DocumentRequirement.objects.bulk_create([
        DocumentRequirement(branch=branch, trade_type=trade_type, doc_type=doc_type,
                            required=doc_type.code in DEFAULT_REQUIREMENTS[trade_type])
        for branch in Branch.objects.all()
        for trade_type in TRADE_TYPES
        for doc_type in doc_types
        if (branch.pk, trade_type, doc_type.pk) not in existing
    ])


class Migration(migrations.Migration):

    dependencies = [
        ('config', '0002_document_requirements'),
        ('operations', '0005_seed_document_types'),
    ]

    operations = [
        migrations.RunPython(seed_requirements, migrations.RunPython.noop),
    ]
