from django.core.management.base import BaseCommand
from django.db import transaction

from operations.document_defaults import DEFAULT_DOCUMENT_TYPES
from operations.models import DocumentType


class Command(BaseCommand):
    help = 'Create the default document types (T1, T2, CMR, ...). Existing types are left as they are.'

    @transaction.atomic
    def handle(self, *args, **options):
        created = 0
        for code, name_fa, name_ps, name_en, number_field, sort_order in DEFAULT_DOCUMENT_TYPES:
            _, was_created = DocumentType.objects.get_or_create(code=code, defaults={
                'name_fa': name_fa, 'name_ps': name_ps, 'name_en': name_en,
                'number_field': number_field, 'sort_order': sort_order,
            })
            created += was_created
        self.stdout.write(self.style.SUCCESS(
            f'انواع اسناد ساخته‌شده: {created} | بدون تغییر: {len(DEFAULT_DOCUMENT_TYPES) - created}'))
