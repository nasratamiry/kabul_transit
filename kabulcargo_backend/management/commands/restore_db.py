import gzip
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import MySQLdb
from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError

from kabulcargo_backend.security import log_event

from .backup_db import FILENAME_RE, find_mysqldump

DRILL_SUFFIX = '_restore_drill'


def find_mysql():
    """The mysql client: MYSQL_CLIENT_PATH, PATH, or next to mysqldump."""
    configured = os.environ.get('MYSQL_CLIENT_PATH') or getattr(settings, 'MYSQL_CLIENT_PATH', '')
    if configured:
        return configured
    found = shutil.which('mysql') or shutil.which('mariadb')
    if found:
        return found
    sibling = Path(find_mysqldump()).with_name('mysql.exe' if os.name == 'nt' else 'mysql')
    if sibling.exists():
        return str(sibling)
    raise CommandError('کلاینت mysql پیدا نشد. مسیر آن را در MYSQL_CLIENT_PATH بنویسید.')


def latest_backup():
    files = sorted(p for p in Path(settings.BACKUP_DIR).glob('kabulcargo-*.sql.gz') if FILENAME_RE.match(p.name))
    if not files:
        raise CommandError(f'هیچ بک‌اپی در {settings.BACKUP_DIR} نیست.')
    return files[-1]


class Command(BaseCommand):
    help = ('Restore a backup made by backup_db.\n'
            '  --drill: fresh backup → load it into <DB_NAME>_restore_drill → compare every table with the '
            'live database → drop the copy. The live database is only read.\n'
            '  FILE --confirm <DB_NAME>: load FILE into the live database (a safety backup is made first).')

    def add_arguments(self, parser):
        parser.add_argument('file', nargs='?', help='A kabulcargo-*.sql.gz file (default with --drill: a fresh backup)')
        parser.add_argument('--drill', action='store_true', help='Test restore into a scratch database')
        parser.add_argument('--confirm', help='The live database name, required to overwrite it')

    def handle(self, *args, **options):
        db = settings.DATABASES['default']
        if 'mysql' not in db['ENGINE']:
            raise CommandError('restore_db فقط برای MySQL است.')
        if options['drill']:
            self.drill(db, options['file'])
        else:
            self.restore_live(db, options['file'], options['confirm'])

    # ------------------------------------------------------------------ live restore
    def restore_live(self, db, file, confirm):
        if not file:
            raise CommandError('فایل بک‌اپ را بدهید، مثلاً: restore_db backups/kabulcargo-2026-10-27-0200.sql.gz '
                               f'--confirm {db["NAME"]}')
        if confirm != db['NAME']:
            raise CommandError(f'این کار دیتابیس زنده را بازنویسی می‌کند. برای تأیید: --confirm {db["NAME"]}')
        path = Path(file)
        if not path.exists():
            raise CommandError(f'فایل پیدا نشد: {path}')
        self.stdout.write('۱) بک‌اپ احتیاطی از وضع فعلی …')
        call_command('backup_db', stdout=self.stdout)
        self.stdout.write(f'۲) بارگذاری {path.name} در {db["NAME"]} …')
        self._load(db, path, db['NAME'], user=db['USER'], password=db['PASSWORD'])
        log_event('backup_restored', file=path.name, database=db['NAME'])
        self.stdout.write(self.style.SUCCESS(f'بازیابی شد: {path.name} → {db["NAME"]}. '
                                             'حالا python manage.py migrate را اجرا کنید (اگر نسخهٔ کد تازه‌تر است).'))

    # ------------------------------------------------------------------ drill
    def drill(self, db, file):
        scratch = db['NAME'] + DRILL_SUFFIX
        # The app user may lack CREATE DATABASE; a separate account can be given for the drill.
        user = os.environ.get('DRILL_DB_USER') or db['USER']
        password = os.environ.get('DRILL_DB_PASSWORD') or db['PASSWORD']
        if file:
            path = Path(file)
        else:
            self.stdout.write('۱) بک‌اپ تازه …')
            call_command('backup_db', stdout=self.stdout)
            path = latest_backup()
        self.stdout.write(f'۲) بارگذاری {path.name} در دیتابیس آزمایشی {scratch} …')
        admin = self._connect(db, user, password)
        try:
            cursor = admin.cursor()
            cursor.execute(f'DROP DATABASE IF EXISTS `{scratch}`')
            cursor.execute(f'CREATE DATABASE `{scratch}` CHARACTER SET utf8mb4')
        except MySQLdb.OperationalError as exc:
            raise CommandError(
                f'دیتابیس آزمایشی ساخته نشد ({exc.args[-1]}). یک بار با root اجرا کنید:\n'
                f"  GRANT ALL PRIVILEGES ON `{scratch}`.* TO '{db['USER']}'@'{db.get('HOST') or '127.0.0.1'}';\n"
                'یا DRILL_DB_USER / DRILL_DB_PASSWORD را برای یک حساب با اجازهٔ CREATE بدهید.') from exc
        try:
            self._load(db, path, scratch, user=user, password=password)
            self.stdout.write('۳) مقایسهٔ جدول‌ها با دیتابیس زنده …')
            problems, tables, rows = self._compare(db, scratch, cursor)
        finally:
            cursor.execute(f'DROP DATABASE IF EXISTS `{scratch}`')
            admin.close()
        self.stdout.write(f'۴) دیتابیس آزمایشی {scratch} پاک شد.')
        if problems:
            log_event('restore_drill_failed', file=path.name, problems=problems[:10])
            for line in problems:
                self.stdout.write(self.style.ERROR(f'  ✗ {line}'))
            raise CommandError(f'تمرین بازیابی ناکام شد: {len(problems)} مشکل.')
        log_event('restore_drill_ok', file=path.name, tables=tables, rows=rows)
        self.stdout.write(self.style.SUCCESS(
            f'تمرین بازیابی موفق: {path.name} — {tables} جدول، {rows} ردیف، همه برابر با دیتابیس زنده.'))

    def _compare(self, db, scratch, cursor):
        """Every live table exists in the copy with the same row count; Dari text survives (utf8mb4)."""
        cursor.execute('SELECT table_name FROM information_schema.tables WHERE table_schema=%s '
                       "AND table_type='BASE TABLE' ORDER BY table_name", [db['NAME']])
        live_tables = [row[0] for row in cursor.fetchall()]
        cursor.execute('SELECT table_name FROM information_schema.tables WHERE table_schema=%s', [scratch])
        restored = {row[0] for row in cursor.fetchall()}
        problems, total = [], 0
        for table in live_tables:
            if table not in restored:
                problems.append(f'جدول {table} در بک‌اپ نیست')
                continue
            cursor.execute(f'SELECT COUNT(*) FROM `{db["NAME"]}`.`{table}`')
            live = cursor.fetchone()[0]
            cursor.execute(f'SELECT COUNT(*) FROM `{scratch}`.`{table}`')
            copy = cursor.fetchone()[0]
            total += copy
            if live != copy:
                problems.append(f'{table}: زنده {live} ردیف، بک‌اپ {copy} ردیف')
        # Dari text: byte-for-byte equal in both (a latin1 restore would garble it).
        cursor.execute(f'SELECT COUNT(*) FROM `{db["NAME"]}`.accounts_branch a JOIN `{scratch}`.accounts_branch b '
                       'ON a.id = b.id WHERE BINARY a.name <> BINARY b.name')
        if cursor.fetchone()[0]:
            problems.append('نام بندرها در بک‌اپ خراب است (charset)')
        cursor.execute(f'SELECT COUNT(*) FROM `{scratch}`.django_migrations')
        if not cursor.fetchone()[0]:
            problems.append('جدول django_migrations خالی است')
        return problems, len(live_tables), total

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def _connect(db, user, password):
        return MySQLdb.connect(host=db.get('HOST') or '127.0.0.1', port=int(db.get('PORT') or 3306),
                               user=user, password=password, charset='utf8mb4', autocommit=True)

    def _load(self, db, path, database, user, password):
        """Stream the gzip file into the mysql client (credentials in a temporary option file)."""
        with tempfile.NamedTemporaryFile('w', suffix='.cnf', delete=False, encoding='utf-8') as cnf:
            cnf.write(f'[client]\nuser="{user}"\npassword="{password}"\n'
                      f'host="{db.get("HOST") or "127.0.0.1"}"\nport={db.get("PORT") or 3306}\n')
        try:
            command = [find_mysql(), f'--defaults-extra-file={cnf.name}', '--default-character-set=utf8mb4', database]
            with tempfile.TemporaryFile() as stderr:
                process = subprocess.Popen(command, stdin=subprocess.PIPE, stderr=stderr)
                with gzip.open(path, 'rb') as gz:
                    for chunk in iter(lambda: gz.read(1024 * 1024), b''):
                        process.stdin.write(chunk)
                process.stdin.close()
                code = process.wait()
                stderr.seek(0)
                errors = stderr.read().decode('utf-8', 'replace').strip()
        finally:
            os.unlink(cnf.name)
        if code != 0:
            raise CommandError(f'mysql ناکام شد (کود {code}): {errors[:300]}')
