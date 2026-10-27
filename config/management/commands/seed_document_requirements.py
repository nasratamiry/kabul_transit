from django.core.management.base import BaseCommand
from django.db import transaction
from simple_history.utils import bulk_create_with_history

from accounts.models import Branch
from config.models import DocumentRequirement, missing_requirement_rows


class Command(BaseCommand):
    help = ('Create the missing document-requirement rows (branch × trade type × document type) with the '
            'default required types. Rows that exist keep the super admin\'s choices.')

    def add_arguments(self, parser):
        parser.add_argument('--branch', help='Only this branch code.')

    @transaction.atomic
    def handle(self, *args, **options):
        branches = Branch.objects.all()
        if options.get('branch'):
            branches = branches.filter(code=options['branch'].upper())
        rows = missing_requirement_rows(branches=branches)
        bulk_create_with_history(rows, DocumentRequirement)
        self.stdout.write(self.style.SUCCESS(f'ردیف‌های تازهٔ اسناد لازم: {len(rows)}'))
