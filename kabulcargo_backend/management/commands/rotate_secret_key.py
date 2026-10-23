import os
import re
import secrets
import shutil
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from kabulcargo_backend.security import log_event


class Command(BaseCommand):
    help = 'Generate a new SECRET_KEY and write it to .env (the old file is kept as .env.bak-YYYYmmdd-HHMMSS).'

    def add_arguments(self, parser):
        parser.add_argument('--env-file', default=None, help='Default: BASE_DIR/.env')
        parser.add_argument('--noinput', action='store_true', help='Do not ask for confirmation.')

    def handle(self, *args, **options):
        env_path = Path(options['env_file'] or settings.BASE_DIR / '.env')
        if not env_path.exists():
            raise CommandError(f'فایل {env_path} پیدا نشد.')
        if not options['noinput']:
            answer = input('با کلید جدید، همهٔ کاربران باید دوباره وارد شوند. ادامه می‌دهید؟ (yes/no): ')
            if answer.strip().lower() not in ('yes', 'y', 'بلی'):
                self.stdout.write('لغو شد.')
                return

        backup = env_path.with_name(f'{env_path.name}.bak-{timezone.localtime():%Y%m%d-%H%M%S}')
        shutil.copy2(env_path, backup)

        # URL-safe characters only, so the value needs no quoting in .env. 86 chars.
        new_key = secrets.token_urlsafe(64)
        text = env_path.read_text(encoding='utf-8')
        line = f'SECRET_KEY={new_key}'
        if re.search(r'^SECRET_KEY=.*$', text, flags=re.M):
            text = re.sub(r'^SECRET_KEY=.*$', lambda _: line, text, count=1, flags=re.M)
        else:
            text = text.rstrip('\n') + f'\n{line}\n'

        temp = env_path.with_name(env_path.name + '.tmp')
        temp.write_text(text, encoding='utf-8')
        os.replace(temp, env_path)

        log_event('secret_key_rotated', env_file=str(env_path.resolve()), backup=backup.name)
        self.stdout.write(self.style.SUCCESS(f'کلید جدید نوشته شد. نسخهٔ قبلی: {backup.name}'))
        self.stdout.write(self.style.WARNING(
            'سرور را دوباره روشن کنید. همهٔ توکن‌های JWT و sessionهای قبلی دیگر کار نمی‌کنند.'))
