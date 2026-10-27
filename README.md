# Kabul Cargo — سیستم مدیریت ترانزیت

سیستم مدیریت ترانزیت، بارچلانی و مالی کابل کارگو: Django 5 + DRF + MySQL (بک‌اند) و
React + TypeScript (فرانت، پوشهٔ `frontend/`). قوانین و وضعیت مراحل در [CLAUDE.md](CLAUDE.md)،
تاریخچه در [docs/PROJECT_HISTORY.md](docs/PROJECT_HISTORY.md).

| راهنما | برای چه |
| --- | --- |
| [docs/DEPLOY_COOLIFY.md](docs/DEPLOY_COOLIFY.md) | نصب روی Coolify (سرور مشترک)، بک‌اپ، به‌روزرسانی، rollback |
| [docs/DEPLOY.md](docs/DEPLOY.md) | نصب روی VPS ساده و کار روزانهٔ فنی |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | رهنمای کاربر (مدیر بندر و سوپر ادمین) |
| [docs/GO_LIVE.md](docs/GO_LIVE.md) | فهرست آمادگی، حافظه، روز انتشار، برگشت |
| [frontend/VERIFY.md](frontend/VERIFY.md) | آزمایش‌های فرانت (E2E) |

## راه‌اندازی محلی (ویندوز)

```powershell
python -m venv .venv
.venv\Scripts\pip install -r requirements-dev.txt
copy .env.example .env          # بعد مقادیر را پر کنید
.venv\Scripts\python manage.py migrate
.venv\Scripts\python manage.py createsuperuser
.venv\Scripts\python manage.py runserver
cd frontend; npm ci; npm run dev   # http://localhost:5173
```

یک بار، با کاربر root، داده‌های منطقهٔ زمانی را در MySQL بارگذاری کنید (بدون آن، فیلترهای تاریخ در
پنل خطا می‌دهند): `mysql -u root -p < deploy\mysql_timezones_windows.sql`

`requirements.txt` همان چیزی است که سرور نصب می‌کند؛ `requirements-dev.txt` ابزارهای نگهداری
(pip-audit، git-filter-repo) را اضافه می‌کند.

## آزمایش‌ها

همه با یک دستور (بک‌اند، typecheck/lint/build، همهٔ E2E با setup و cleanup؛ دیتابیس به حالت قبل
برمی‌گردد):

```powershell
scripts\run_all_checks.ps1
```

آزمایش stack کامل Docker: `scripts\prod_local_test.ps1` (ویندوز با Docker Desktop) یا
`scripts/prod_stack_test.sh` (لینوکس)، یا در GitHub: **Actions → Production stack test → Run workflow**.

## امنیت (خلاصه)

- ورود: ۵ رمز اشتباه برای یک حساب → آن حساب ۱۵ دقیقه قفل (۴۲۳)؛ بیش از ۲۰ ورود ناموفق در دقیقه از یک IP
  (یک دفتر) → ۴۲۹. قفل بر اساس IP نیست تا کارمندان یک دفتر که یک IP مشترک دارند همدیگر را قفل نکنند.
- API: ۱۰۰ درخواست در دقیقه برای هر کاربر، ۶۰ بی‌ورود برای هر IP.
- پنل Django در مسیر مخفی `ADMIN_URL` و فقط برای نقش سوپر ادمین.
- فایل اسناد فقط از `GET /api/documents/<id>/download/` (با ورود و بررسی بندر)؛ `/media/` عمومی نیست.
- لاگ امنیتی: `logs/security.log`.
