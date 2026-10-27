# بررسی نهایی آمادگی — کابل کارگو

تاریخ: ۲۰۲۶-۱۰-۲۷ (۱۴۰۵/۰۸/۰۵). خلاصه برای صاحب سیستم: [`docs/GO_LIVE.md`](../GO_LIVE.md).
راهنمای نصب: [`docs/DEPLOY_COOLIFY.md`](../DEPLOY_COOLIFY.md).

## ۱. فهرست کامل

جدول کامل قابلیت → وضعیت → دلیل در `docs/GO_LIVE.md` بخش ۱ است. خلاصه: همهٔ قابلیت‌های بک‌اند،
فرانت و اسناد گمرکی **کامل و آزمایش‌شده**؛ stack تولیدی Docker **نوشته شده ولی اجرا نشده** (مانع B1)؛
وارد کردن اکسل‌های قدیمی **نیست** (بعداً).

## ۲. آزمایش‌ها

`scripts/run_all_checks.py` (کامل، روی MySQL واقعی، دیتابیس بعد از هر اسکریپت به حالت قبل برمی‌گردد،
سرورها روی ۸۰۱۰/۵۱۸۳ و در پایان بسته — «ports free»):

| step | result | checks | time | note |
| --- | --- | --- | --- | --- |
| verify_field_config | PASS | 66/66 | 9s |  |
| verify_transaction | PASS | 14/14 | 5s |  |
| verify_finance | PASS | 32/32 | 4s |  |
| verify_api | PASS | 62/62 | 17s |  |
| verify_statement | PASS | 36/36 | 6s |  |
| verify_security | PASS | 31/31 | 111s |  |
| verify_documents | PASS | 38/38 | 9s |  |
| verify_kabul_day | PASS | 4/4 | 2s |  |
| typecheck | PASS | 1/1 | 10s |  |
| lint | PASS | 1/1 | 16s |  |
| build | PASS | 1/1 | 13s |  |
| e2e-stage10 | PASS | 30/30 | 66s |  |
| e2e-stage11 | PASS | 20/20 | 44s |  |
| e2e-stage12a | PASS | 34/34 | 46s |  |
| e2e-stage12b | PASS | 21/21 | 82s |  |
| e2e-stage13 | PASS | 25/25 | 41s |  |
| e2e-stage14 | PASS | 25/25 | 48s |  |
| e2e-documents | PASS | 30/30 | 125s |  |
| e2e-field-settings | PASS | 22/22 | 47s |  |
| e2e-stage9 | PASS | 21/21 | 34s |  |
| **total** | **PASS** | **514/514** | 746s | |

(اجرای نهایی ۲۰۲۶-۱۰-۲۷، بعد از پاک‌کاری و بازنویسی تاریخچه: ۲۰ مرحله، ۵۱۴ آزمایش، ۷۴۶ ثانیه.)

| بررسی | نتیجه |
| --- | --- |
| `manage.py makemigrations --check --dry-run` | No changes detected |
| `manage.py check --deploy --settings=kabulcargo_backend.settings_production` | no issues (1 silenced: `axes.W006`، عمدی — قفل بر اساس حساب، نه IP؛ محافظ IP = `LOGIN_FAILURE_RATE`) |
| `npm run build` / `npm run lint` / `tsc --noEmit` (`npm run typecheck`) | سالم (بخشی از جدول بالا) |
| `pip-audit -r requirements.txt` | No known vulnerabilities |
| `npm audit` (همه و `--omit=dev`) | 0 vulnerabilities |

**سه آزمایش ناپایدار (flaky) درست شد** — هیچ‌کدام باگ برنامه نبود، آزمایش زودتر از رسیدن داده می‌خواند:
documents #25 (نام انواع سند)، stage12a #28 (فهرست بندرها و re-render)، stage9 «refresh توکن» (سلام
از کاربر ذخیره‌شده فوراً دیده می‌شود، refresh بعد از اولین ۴۰۱ می‌آید). هر کدام بعد از اصلاح چند بار
پشت سر هم سبز شد.

## ۳. امنیت

جزئیات در `docs/GO_LIVE.md` بخش ۳. تغییرات کد این بررسی:

1. **باگ:** صفحه‌های سوپر ادمین React زیر `/admin/...` هستند ولی nginx تولیدی همهٔ `/admin/` را به
   Django می‌فرستاد → باز کردن مستقیم یا refresh این صفحه‌ها روی سرور کار نمی‌کرد (stage 15 هرگز روی
   Docker اجرا نشده بود، پس دیده نشد). پنل Django حالا در `ADMIN_URL` (env) است؛ production
   `admin/`، `api/`، `static/`، `assets/`، `media/` را رد می‌کند. `verify-prod.mjs` حالا بارگذاری مستقیم
   `/admin/field-settings` را از nginx آزمایش می‌کند.
2. پنل Django فقط برای نقش super_admin (`admin.site.has_permission`)، حتی با `is_staff` روی مدیر بندر.
3. **NAT دفتر:** axes از `['username', 'ip_address']` (یعنی جداگانه هر IP هم قفل می‌شد) به
   `['username']`؛ ورود ناموفق از یک IP ۵ → ۲۰ در دقیقه؛ anon ۲۰ → ۶۰ در دقیقه؛ همه از env. آزمایش تازه
   (۱۰ کاربر، یک IP) در `verify_security.py`.
4. fixtureهای E2E (رمزهای آزمایشی معلوم) با `settings_production` خارج می‌شوند.
5. `SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')` برای پراکسی Coolify درست است؛
   `TRUSTED_PROXY_COUNT=2`؛ HSTS/کوکی Secure/XFO/Referrer-Policy/CSP روی SPA (nginx)، API و پنل
   (Django) — آزمایش‌ها: `verify_security.py` (Django)، `verify-prod.mjs` (nginx، در stack test).

## ۴. GitHub

- `.gitignore` همهٔ دستهٔ C را می‌پوشاند (`.env*` جز example ها، `.venv/`، `node_modules/`، `dist/`،
  `media/`، `backups/`، `logs/`، `*.sqlite3`، `*_screenshots/`، `__pycache__/`، `.claude/`، `.cursor/`،
  `.vscode/`، `graphify-out/` (ابزار محلی؛ نیاز ساخت/اجرا نیست)، `_local/`، `checks-output/`).
- **جستجوی راز در کل تاریخچه** (اسکریپت معادل gitleaks: هر blob در همهٔ refها با مقدار واقعی
  `SECRET_KEY` و `DB_PASSWORD` از `.env`، پیشوند آن‌ها، و الگوهای کلید/توکن رایج، بدون چاپ مقدار):
  هیچ راز واقعی. فقط placeholder های `.env.example` / `.env.production.example`. `.env` هرگز commit
  نشده. **نیازی به عوض کردن هیچ رمزی نیست.**
- **بازنویسی تاریخچه (قبل از اولین push):** `git filter-repo` مسیرهای `.claude/`، `.cursor/`،
  `docs/stages/` (گزارش‌های قدیمی) و `kabulcargo-claude-setup/` (کاپی قدیمی تنظیمات دستیار) را از همهٔ
  commitها برداشت. پشتیبان کامل قبل از آن: `_local/pre-rewrite-20261027-2014.bundle` (git bundle verify: okay).
  همهٔ hash ها عوض شدند (جدول تازه در `docs/PROJECT_HISTORY.md`).
- **اندازهٔ مخزن:** قبل ۱٫۷۴ MiB (pack) → بعد ۱٫۶۷ MiB. فایل بزرگ، dump یا عکس اسکرین‌شات در تاریخچه
  نبود؛ بزرگ‌ترین blob ها `package-lock.json` (~۱۹۰ KB) و عکس‌های رهنمای کاربر `docs/user-guide/img/`
  (۶۰–۱۷۰ KB، عمداً نگه داشته شد).
- `git ls-files` بعد از پاک‌کاری (شمار در هر پوشه):

  | پوشه | فایل |
  | --- | --- |
  | `frontend/` | ۱۲۹ |
  | `api/` | ۲۶ |
  | `docs/` | ۲۵ |
  | `operations/` | ۱۸ |
  | `kabulcargo_backend/` | ۱۶ |
  | `scripts/` | ۱۴ |
  | `finance/` | ۱۴ |
  | `deploy/` | ۱۴ |
  | `config/` | ۱۳ |
  | `accounts/` | ۸ |
  | `partners/` | ۶ |
  | `static/`، `locale/` | ۲، ۲ |
  | `templates/`، `.github/` | ۱، ۱ |
  | فایل‌های ریشه | ۱۴ |

**Push (اولین بار):** `git remote add origin https://github.com/nasratamiry/kabul_transit.git` و
`git push -u origin main` → `* [new branch] main -> main` (احراز هویت را Git Credential Manager خودش انجام داد؛
هیچ رمز یا توکنی دیده، پرسیده یا ذخیره نشد). بعد از push: `git ls-remote origin main` = HEAD محلی
(`3b8692c`)، ۳۰۰ فایل. در درخت GitHub بررسی شد: هیچ `.env` (فقط سه فایل example)، `media/`، `backups/`،
`logs/`، اسکرین‌شات، `.claude/`، `.cursor/`، `graphify-out/`، `_local/`، `node_modules/` یا `.venv/` نیست.
همین گزارش با commit بعدی push شد.

## ۵. stack تولیدی برای Coolify

| خواسته | انجام |
| --- | --- |
| بدون پورت روی host | `docker-compose.yml` هیچ `ports:` ندارد؛ فقط `expose: 80` روی web. پورت فقط در `docker-compose.local.yml` (127.0.0.1، آزمایش محلی). |
| نام‌ها `kabulcargo_` | سرویس‌ها `kabulcargo_db/_redis/_backend/_web`، volumeها `kabulcargo_*`، شبکه `kabulcargo_net`. Coolify به نام کانتینر/volume یک پسوند/پیشوند UUID خودش اضافه می‌کند — هنوز یکتا و جدا از Donya. |
| سقف حافظه | db ۶۴۰m، redis ۹۶m، backend ۷۶۸m، web ۱۲۸m (برآورد؛ اندازه‌گیری در stack test). |
| MySQL 8.4 + utf8mb4 + منطقهٔ زمانی | image خودش (`deploy/mysql/Dockerfile`) با اسکریپت init؛ tz tables را image رسمی بار می‌کند؛ buffer pool ۲۵۶M، performance_schema خاموش. |
| Redis لازم | `kabulcargo_redis`، `entrypoint.sh` بدون `REDIS_URL` شروع نمی‌کند. |
| backend | gunicorn ۳ worker، کاربر غیر root، migrate در شروع، collectstatic در build، `settings_production`، همهٔ رازها از env. |
| web | nginx: SPA با history fallback، `/api/` و `/${ADMIN_URL}` به Django، `/protected-media/` داخلی (X-Accel)، `/media/` → ۴۰۴، `client_max_body_size 12m`، gzip، cache یک‌ساله برای `/assets/` و `no-cache` برای index.html. |
| health | `GET /api/health/` (فقط `ok` + دیتابیس/cache، بدون نسخه و خطا). healthcheck web کل زنجیره را می‌سنجد. |
| بک‌اپ | Scheduled Task `python manage.py backup_db` در `kabulcargo_backend`، `30 21 * * *` (= ۰۲:۰۰ کابل اگر Coolify به UTC است)، ۳۰ روز در volume `kabulcargo_backups`؛ کاپی بیرونی دستی یا `deploy/offsite-backup.sh`؛ `restore_db --drill`. |
| `.env.production.example` | همهٔ متغیرها با توضیح: `APP_DOMAIN`، `ADMIN_URL`، `SECRET_KEY`، `DB_*`، `MYSQL_ROOT_PASSWORD`، `TRUSTED_PROXY_COUNT`، `GUNICORN_WORKERS`، JWT، بک‌اپ، محدودیت‌ها. |
| image های لاغر | backend: `.dockerignore` (بدون frontend، scripts، docs، ابزار)، wheels در مرحلهٔ build (بدون کامپایلر در runtime)؛ web: فقط `dist/` (source map ها پاک)، بدون `frontend/.env*`؛ `requirements.txt` تولید / `requirements-dev.txt` ابزار. |

## ۶. آزمایش محلی stack — انجام نشد (مانع B1)

Docker Desktop روی این کمپیوتر روشن نمی‌شود: `docker version` → «cannot find dockerDesktopLinuxEngine»
و `HypervisorPresent = False` (مجازی‌سازی / Virtual Machine Platform / WSL 2 خاموش). پس این‌ها **اجرا
نشده‌اند**: ساخت image ها، migrate روی دیتابیس خالی، E2E روی stack، اندازهٔ image ها، حافظهٔ واقعی،
آزمایش ۲۰ کاربر، بک‌اپ + تمرین بازیابی داخل کانتینر.

آنچه به جای آن آماده شد، تا با یک کلیک اجرا شود:
- `scripts/prod_stack_test.sh` (لینوکس) و `scripts/prod_local_test.ps1` (ویندوز، به‌روز شد): stack تازه →
  facts (DEBUG off، Redis، gunicorn، غیر root، tz، utf8mb4) → اولین سوپر ادمین + seed → محتوای image ها
  و اندازه → حافظهٔ بیکار → `verify-prod.mjs` (اولین بندر از UI، هدرها، `/media/` بسته، دانلود فقط با
  ورود، health، throttle در Redis، Excel، صفحهٔ `/admin/...` React) → `verify_kabul_day.py` → ۲۰ کاربر ×
  ۲ دقیقه (`scripts/load_test.py`) با نمونه‌گیری حافظه → `backup_db` + `restore_db --drill` → پاک کردن
  همه با volumeها.
- `.github/workflows/stack-test.yml`: همان روی ماشین لینوکس GitHub (فقط دستی: Actions → Production
  stack test → Run workflow)؛ خلاصه در صفحهٔ اجرا و همهٔ خروجی‌ها به‌صورت artifact.
- بخشی که بدون Docker آزمایش شد: روز شمسی ۲۳:۵۰/۰۰:۱۰ (`verify_kabul_day.py`، سبز)، تنظیمات تولید
  (`check --deploy`، `verify_security.py`)، قفل/throttle (Redis-agnostic، در Django).

## ۷. مستندات

- `docs/DEPLOY_COOLIFY.md` (دری، تازه): همهٔ کلیک‌ها — GitHub App فقط برای `kabul_transit`، پروژه و
  منبع Docker Compose، دامنه روی `kabulcargo_web`، env، حافظه/volume/health، اولین اجرا، Scheduled
  Task بک‌اپ، دانلود و بازیابی، Redeploy، Rollback، بررسی Donya، پیشنهاد دامنهٔ HTTPS برای پنل Coolify،
  `.htaccess` (`Redirect 301 /kc_transit https://transit.kabulcargo.com/`).
- `docs/USER_GUIDE.md` (از قبل با عکس برای هر دو نقش): به‌روز برای دامنه و مسیر مخفی پنل. عکس برای
  صفحه‌های «اسناد» و «تنظیم فیلدها» هنوز نیست (باید درست شود).
- `docs/DEPLOY.md` (VPS ساده) و `README.md` به‌روز؛ `docs/PROJECT_HISTORY.md` تازه.

## ۸. مغایرت‌های این دستور با کد واقعی

1. `scripts/run_all_checks` از قبل وجود داشت (ساخته نشد؛ `verify_kabul_day` به آن اضافه شد).
2. پنل Django در `/admin/` با صفحه‌های React `/admin/...` تداخل داشت (باگ بالا) — دستور فقط «انتقال
   به مسیر env» خواسته بود.
3. صاحب سیستم هر دو را خواسته بود: «گزارش‌ها به `docs/stages/`» (§4) و «فقط PROJECT_HISTORY، گزارش‌ها
   به `_local/`» (§4b). طبق §4b انجام شد؛ این فایل تنها فایل `docs/stages/` است.
4. «دستور ساخت سوپر ادمین که رمز را بپرسد»: `createsuperuser` خود Django همین کار را می‌کند و مدیر
   مدل نقش را خودکار super_admin می‌گذارد — دستور تازه لازم نبود.
5. «seed انواع سند»: مایگریشن‌ها از قبل seed می‌کنند؛ `seed_document_types` فقط idempotent است.
6. ساخت چندمرحله‌ای image ها از قبل وجود داشت؛ تقسیم requirements عوض شد (`requirements-production.txt`
   → حالا `requirements.txt` خودش تولید است و `requirements-dev.txt` ابزارها).
7. منطقهٔ زمانی MySQL را image رسمی در init بار می‌کند؛ init ما فقط اجازهٔ دیتابیس تمرین بازیابی است.
8. زمان Scheduled Task در Coolify به وقت «Instance Timezone» است (تنظیم سراسری؛ دست نزدیم) → cron به
   UTC نوشته شد.
9. سقف حافظه از برآورد است، نه اندازه‌گیری (§6 اجرا نشد).
10. یک جلسهٔ دیگر Claude هم‌زمان روی همین مخزن کار می‌کرد (صفحهٔ تنظیم فیلدها، commit نشده). هماهنگ شد:
    خودش commit کرد (`feat: field settings page …`) و تا پایان این بررسی آزمایش یا تغییر دیگری نکرد.
11. یک commit من اول اشتباهاً فایل‌های staged قبلی را هم گرفت؛ قبل از هر push با `reset --soft` باز و
    به commitهای جدا تقسیم شد.

## ۹. commitهای این بررسی

- `2030b54` security: office-NAT-safe login limits, super-admin-only Django admin at ADMIN_URL
- `84a8aa4` test: Kabul-day check, production guard for E2E fixtures, fix two flaky waits
- `e99a9dd` deploy: Coolify-ready stack for the shared server, slim images, stack test
- `e636989` chore: only needed files in Git (local-only folder, tooling untracked)
- `6b3e3ce` docs: Coolify deployment guide (Dari), deploy and user guides, README
- `3b8692c` test: stage 9 waits for the token refresh, not just the greeting
- `docs: final readiness report …` (همین گزارش، GO_LIVE، PROJECT_HISTORY، CLAUDE.md)

پیش از این بررسی، جلسهٔ دیگر: `feat: field settings page …` (صفحهٔ تنظیم فیلدها).

## ۱۰. نتیجه

**NO-GO** — امروز نصب نکنید، فقط به یک دلیل:

- stack تولیدی (سه image و `docker-compose.yml` تازهٔ Coolify) هنوز یک بار هم ساخته و اجرا نشده، چون Docker
  روی کمپیوتر توسعه کار نمی‌کند. پس اندازهٔ image ها و حافظهٔ واقعی هم معلوم نیست، و بدون آن نمی‌دانیم کنار
  Donya جا می‌شود یا نه.

هر چیز دیگر آماده است: ۵۱۴/۵۱۴ آزمایش سبز، ۰ آسیب‌پذیری، بدون مایگریشن معلق، `check --deploy` تمیز،
هیچ راز در تاریخچه، تاریخچهٔ پاک‌شده، مستندات کامل.

**راه GO (بدون دست زدن به سرور):** GitHub → Actions → **Production stack test** → Run workflow. اگر همهٔ
سطرها PASS بود و اوج حافظه + مصرف فعلی Donya در RAM سرور جا شد (`docs/GO_LIVE.md` بخش ۵)، نتیجه **GO**
است: طبق `docs/GO_LIVE.md` بخش ۷ نصب کنید.
