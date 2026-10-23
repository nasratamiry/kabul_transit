# Kabul Cargo — بک‌اند

سیستم مدیریت ترانزیت، بارچلانی و مالی کابل کارگو (Django 5 + DRF + MySQL).
قوانین و وضعیت مراحل در [CLAUDE.md](CLAUDE.md) است.

## راه‌اندازی محلی (ویندوز)

```powershell
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
copy .env.example .env          # بعد مقادیر را پر کنید
.venv\Scripts\python manage.py migrate
.venv\Scripts\python manage.py createsuperuser
.venv\Scripts\python manage.py runserver
```

یک بار، با کاربر root، داده‌های منطقهٔ زمانی را در MySQL بارگذاری کنید (بدون آن،
فیلترهای تاریخ در پنل خطا می‌دهند):

```powershell
mysql -u root -p < deploy\mysql_timezones_windows.sql
```

## آزمایش‌ها

هر اسکریپت روی MySQL واقعی اجرا می‌شود و همهٔ داده‌های آزمایشی را برمی‌گرداند:

```powershell
.venv\Scripts\python scripts\verify_transaction.py
.venv\Scripts\python scripts\verify_finance.py
.venv\Scripts\python scripts\verify_field_config.py
.venv\Scripts\python scripts\verify_api.py
.venv\Scripts\python scripts\verify_security.py
```

## دیپلوی در سرور (production)

۱. `DJANGO_SETTINGS_MODULE=kabulcargo_backend.settings_production`
۲. در `.env`:
   - `SECRET_KEY` حداقل ۵۰ حرف (`python manage.py rotate_secret_key` می‌سازد)
   - `ALLOWED_HOSTS`، `CORS_ALLOWED_ORIGINS`، و در صورت نیاز `CSRF_TRUSTED_ORIGINS`
   - پشت nginx: `TRUSTED_PROXY_COUNT=1`
   - بهتر است Redis: `REDIS_URL=redis://127.0.0.1:6379/1` و `pip install redis`
۳. یک بار:
   ```bash
   python manage.py migrate
   python manage.py createcachetable      # اگر Redis ندارید
   python manage.py collectstatic
   mysql_tzinfo_to_sql /usr/share/zoneinfo | mysql -u root mysql   # لینوکس
   ```
۴. در nginx حجم درخواست را محدود کنید (فایل‌ها حداکثر ۱۰ MB):
   `client_max_body_size 12m;` — و پوشهٔ `media/` را مستقیم از nginx سرو کنید.

## بک‌اپ خودکار

```powershell
.venv\Scripts\python manage.py backup_db
```

فایل در `backups/kabulcargo-YYYY-MM-DD-HHMM.sql.gz` ساخته می‌شود، فقط ۳۰ روز آخر
نگه داشته می‌شود، و نتیجه در `logs/security.log` ثبت می‌شود.

زمان‌بندی روزانه، ساعت ۲ بامداد:

```
# ویندوز: Task Scheduler → Create Basic Task → Daily 02:00
#   Program: D:\Kabul Cargo TN\.venv\Scripts\python.exe
#   Arguments: manage.py backup_db
#   Start in: D:\Kabul Cargo TN
# لینوکس (VPS):
0 2 * * * cd /path/to/project && .venv/bin/python manage.py backup_db
```

بک‌اپ‌ها را به جای دیگری هم کاپی کنید (دیسک دیگر یا ذخیره‌گاه ابری) — بک‌اپی که
فقط روی همان سرور باشد، با خراب شدن سرور از دست می‌رود.

بازگرداندن:

```bash
gunzip -c backups/kabulcargo-2026-10-23-0200.sql.gz | mysql -u root -p kabulcargo
```

## امنیت (مرحلهٔ ۷)

- لاگین: بیش از ۵ تلاش ناموفق در دقیقه از یک IP → ۴۲۹؛ ۵ تلاش ناموفق برای یک
  حساب → قفل ۱۵ دقیقه (۴۲۳). سوپر ادمین قفل را از پنل برمی‌دارد:
  «Axes → Access attempts» → ردیف را حذف کنید.
- API: ۱۰۰ درخواست در دقیقه برای هر کاربر، ۲۰ برای بی‌نام.
- لاگ امنیتی: `logs/security.log` (ورود/خروج، ۴۰۳، ۴۲۸، ۴۲۹، کاربران، نقش‌ها، نرخ‌ها، بک‌اپ).
