import gzip
import os
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from kabulcargo_backend.security import log_event

MIN_BACKUP_BYTES = 10 * 1024
FILENAME_RE = re.compile(r'^kabulcargo-(\d{4}-\d{2}-\d{2}-\d{4})\.sql\.gz$')
WINDOWS_DEFAULT = Path(r'C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqldump.exe')


def find_mysqldump():
    if settings.MYSQLDUMP_PATH:
        return settings.MYSQLDUMP_PATH
    found = shutil.which('mysqldump')
    if found:
        return found
    if WINDOWS_DEFAULT.exists():
        return str(WINDOWS_DEFAULT)
    raise CommandError('mysqldump پیدا نشد. مسیر آن را در MYSQLDUMP_PATH در فایل .env بنویسید.')


class Command(BaseCommand):
    help = ('Back up the MySQL database: mysqldump (utf8mb4) → backups/kabulcargo-YYYY-MM-DD-HHMM.sql.gz, '
            'keeping the last 30 days.')

    def add_arguments(self, parser):
        parser.add_argument('--output-dir', default=None, help='Default: settings.BACKUP_DIR')
        parser.add_argument('--keep-days', type=int, default=None, help='Default: settings.BACKUP_KEEP_DAYS')

    def handle(self, *args, **options):
        db = settings.DATABASES['default']
        if 'mysql' not in db['ENGINE']:
            raise CommandError('backup_db فقط برای MySQL است.')
        out_dir = Path(options['output_dir'] or settings.BACKUP_DIR)
        keep_days = options['keep_days'] or settings.BACKUP_KEEP_DAYS
        out_dir.mkdir(parents=True, exist_ok=True)

        stamp = timezone.localtime().strftime('%Y-%m-%d-%H%M')
        target = out_dir / f'kabulcargo-{stamp}.sql.gz'
        partial = target.with_name(target.name + '.partial')
        try:
            raw_bytes = self._dump(db, partial)
            # Judged on the SQL itself: a small database compresses to well under 10 KB.
            if raw_bytes < MIN_BACKUP_BYTES:
                raise CommandError(f'بک‌اپ خیلی کوچک است ({raw_bytes} بایت SQL) — احتمالاً خالی است.')
            os.replace(partial, target)
        except Exception as exc:
            partial.unlink(missing_ok=True)
            log_event('backup_failed', error=str(exc)[:300])
            raise

        removed = self._prune(out_dir, keep_days)
        size_kb = target.stat().st_size // 1024
        log_event('backup_created', file=target.name, size_kb=size_kb, raw_kb=raw_bytes // 1024, pruned=removed)
        self.stdout.write(self.style.SUCCESS(
            f'بک‌اپ ساخته شد: {target} ({size_kb} KB) | فایل‌های کهنهٔ پاک‌شده: {len(removed)}'))

    def _dump(self, db, partial):
        """Run mysqldump into a gzip file. Returns the uncompressed size."""
        # Credentials go in a temporary option file, never on the command line
        # (where other users of the machine could see them in the process list).
        with tempfile.NamedTemporaryFile('w', suffix='.cnf', delete=False, encoding='utf-8') as cnf:
            cnf.write('[client]\n')
            cnf.write(f'user="{db["USER"]}"\n')
            cnf.write(f'password="{db["PASSWORD"]}"\n')
            cnf.write(f'host="{db.get("HOST") or "127.0.0.1"}"\n')
            cnf.write(f'port={db.get("PORT") or 3306}\n')
        command = [
            find_mysqldump(), f'--defaults-extra-file={cnf.name}',
            '--single-transaction', '--quick', '--no-tablespaces', '--hex-blob', '--triggers',
            '--default-character-set=utf8mb4', '--set-gtid-purged=OFF', db['NAME'],
        ]
        raw_bytes, tail = 0, b''
        try:
            with tempfile.TemporaryFile() as stderr, gzip.open(partial, 'wb') as gz:
                process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=stderr)
                for chunk in iter(lambda: process.stdout.read(1024 * 1024), b''):
                    gz.write(chunk)
                    raw_bytes += len(chunk)
                    tail = (tail + chunk)[-200:]
                process.stdout.close()
                code = process.wait()
                stderr.seek(0)
                errors = stderr.read().decode('utf-8', 'replace').strip()
        finally:
            os.unlink(cnf.name)
        if code != 0:
            raise CommandError(f'mysqldump ناکام شد (کود {code}): {errors[:300]}')
        if b'-- Dump completed' not in tail:
            raise CommandError('خروجی mysqldump ناقص است (سطر «Dump completed» نیامد).')
        return raw_bytes

    def _prune(self, out_dir, keep_days):
        """Delete backups older than keep_days (by the date in the file name)."""
        cutoff = datetime.now() - timedelta(days=keep_days)
        removed = []
        for path in out_dir.iterdir():
            match = FILENAME_RE.match(path.name)
            if match and datetime.strptime(match.group(1), '%Y-%m-%d-%H%M') < cutoff:
                path.unlink()
                removed.append(path.name)
        return removed
