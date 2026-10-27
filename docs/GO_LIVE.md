# آمادگی انتشار (Go-Live) — سیستم مدیریت کابل کارگو

تاریخ بررسی: ۲۰۲۶-۱۰-۲۷ (۱۴۰۵/۰۸/۰۵). گزارش کامل فنی: [`docs/stages/FINAL_READINESS.md`](stages/FINAL_READINESS.md).

## نتیجه در یک نگاه

**NO-GO برای همین امروز — فقط یک مانع باقی است:** stack تولیدی (Docker) هنوز یک بار هم در جایی
ساخته و اجرا نشده، چون Docker روی کمپیوتر توسعه کار نمی‌کند (مجازی‌سازی / WSL 2 خاموش است). همهٔ
کد، آزمایش‌ها، امنیت و مستندات آماده‌اند. راه حل بدون دست زدن به سرور: در GitHub یک بار
**Actions → Production stack test → Run workflow** را بزنید. اگر همه سبز شد (و RAM سرور کافی بود،
بخش ۵)، نتیجه **GO** است و می‌توانید طبق بخش ۸ نصب کنید.

---

## ۱. فهرست کامل (چه ساخته شده)

| بخش | قابلیت | وضعیت | دلیل (commit / فایل / آزمایش) |
| --- | --- | --- | --- |
| بک‌اند | بندرها (کود تغییرناپذیر، seed خودکار) | ✅ کامل | `accounts/`، `config/signals.py`؛ `verify_api.py`، E2E stage10 |
| بک‌اند | کاربران، دقیقاً ۲ نقش (super_admin، branch_manager) | ✅ کامل | `accounts/models.py` (CheckConstraint)؛ `verify_api.py` |
| بک‌اند | تاجران، شرکت‌های ترانسپورت | ✅ کامل | `partners/`؛ E2E stage11 |
| بک‌اند | معاملات: ۴۳ فیلد، ۴ نوع تجارت، یگانه عاید | ✅ کامل | `operations/models.py`؛ `verify_transaction.py`، E2E stage12a/b |
| بک‌اند | نرخ اسعار: ۸ رقم اعشار، قفل نرم ۴۲۸، مدیر بندر فقط نرخ امروز | ✅ کامل | `finance/`؛ `verify_finance.py`، `verify_api.py` |
| بک‌اند | حواله، مصارف دفتر | ✅ کامل | `finance/`؛ E2E stage13 |
| بک‌اند | FieldConfig + seed خودکار + صفحهٔ تنظیم فیلدها | ✅ کامل | `config/`؛ `verify_field_config.py` (۶۶)، E2E field-settings |
| بک‌اند | StatementLine + صورت حساب عاید IAS 1 | ✅ کامل | `finance/reports.py`؛ `verify_statement.py` (۳۶) |
| بک‌اند | تاریخچهٔ تغییرات (audit) | ✅ کامل | simple-history روی همهٔ مدل‌ها، `api/history.py` |
| بک‌اند | API + JWT + محدودیت بندر در queryset | ✅ کامل | `api/`؛ `verify_api.py` (۶۲) |
| بک‌اند | امنیت: rate limit، قفل حساب، هدرها، CSP، اعتبار فایل، لاگ امنیتی، بک‌اپ | ✅ کامل | `verify_security.py` (۳۱) |
| بک‌اند | روز شمسی درست در ۲۳:۵۰ و ۰۰:۱۰ کابل | ✅ کامل | `verify_kabul_day.py` (تازه) |
| فرانت | پایه: دری/پشتو/انگلیسی، RTL، شمسی، ارقام دری | ✅ کامل | E2E stage9 |
| فرانت | صفحه‌های سوپر ادمین، شرکا، معاملات + فورم پویا، جزئیات + اسناد | ✅ کامل | E2E stage10، 11، 12a، 12b |
| فرانت | صفحه‌های مالی، داشبورد، گزارش عاید، Excel، صفحهٔ چاپ | ✅ کامل | E2E stage13، 14 |
| اسناد گمرکی | DocumentType، جدول اسناد لازم، چک‌لیست، فیلتر ناقص، `/documents`، هماهنگی نمبر، دانلود با ورود | ✅ کامل | `verify_documents.py` (۳۸)، E2E documents (۳۰) |
| تولید | Docker (backend، web، db)، health، بک‌اپ + تمرین بازیابی | ⚠️ نوشته شده، **اجرا نشده** | `docker-compose.yml`، `scripts/prod_stack_test.sh` — مانع B1 |
| تولید | run_all_checks، DEPLOY_COOLIFY، USER_GUIDE، GO_LIVE | ✅ کامل | `scripts/run_all_checks.py`، `docs/` |
| داده | وارد کردن اکسل‌های قدیمی بندرها | ❌ نیست | «بعداً» (بخش ۷) |

## ۲. نتیجهٔ آزمایش‌ها

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

همچنین: `makemigrations --check` → هیچ مایگریشن معلق؛ `check --deploy` با تنظیمات تولید → بدون
هشدار (یک هشدار عمداً خاموش شده: axes.W006، بخش ۳)؛ `pip-audit` و `npm audit` → ۰ آسیب‌پذیری.

## ۳. یافته‌های امنیتی

| موضوع | نتیجه |
| --- | --- |
| رمز یا کلید در تاریخچهٔ Git | هیچ. همهٔ ۷۶۶ فایل تاریخچه با `SECRET_KEY` و `DB_PASSWORD` واقعی و الگوهای رایج جستجو شد؛ `.env` هرگز commit نشده. نیازی به عوض کردن رمزی نیست. |
| رمز پیش‌فرض یا آزمایشی | در کد اجرایی، fixture، seed و compose هیچ. رمزهای آزمایشی فقط در اسکریپت‌های E2E (کاربران موقت `e2e_*` که پاک می‌شوند)؛ این اسکریپت‌ها در image نیستند و حالا با تنظیمات تولید اصلاً اجرا نمی‌شوند. |
| وابستگی‌ها | `pip-audit` (تولید) و `npm audit` → ۰. |
| CSP برنامه | `script-src 'self'` — هیچ script درون‌خطی یا بیرونی اجرا نمی‌شود (JWT در localStorage است، پس این مهم است). فقط فونت Google (CSS/فونت، نه script) اجازه دارد. برنامه زیردامنهٔ خودش را دارد. |
| فایل اسناد | `/media/` در nginx بسته (۴۰۴)؛ فایل فقط از `/api/documents/<id>/download/` بعد از بررسی ورود و بندر، با `X-Accel-Redirect` به location داخلی. |
| پنل Django | از `/admin/` به مسیر مخفی `ADMIN_URL` رفت؛ فقط نقش سوپر ادمین (حتی اگر «staff» روی مدیر بندر زده شود). **باگ رفع شده:** nginx همهٔ `/admin/...` را به Django می‌فرستاد، پس باز کردن مستقیم یا refresh صفحه‌های سوپر ادمین React (مثلاً `/admin/field-settings`) در سرور کار نمی‌کرد. |
| دفتر با یک IP مشترک (NAT) | **تغییر داده شد.** قبلاً ۵ رمز اشتباه از *هر کسی* در یک دفتر، کل IP دفتر را ۱۵ دقیقه قفل می‌کرد، و ورود بی‌نام ۲۰ در دقیقه بود. حالا: قفل فقط برای همان حساب (۵ اشتباه)، ورود ناموفق از یک IP ۲۰ در دقیقه، درخواست بی‌ورود ۶۰ در دقیقه، هر کاربر ۱۰۰ در دقیقه. آزمایش تازه: ۱۰ نفر پشت یک IP، همه یک بار اشتباه، یک نفر ۵ بار → فقط همان یک نفر قفل، ۹ نفر وارد. هشدار axes.W006 به همین دلیل عمداً خاموش است. |
| هدرها پشت پراکسی TLS | `SECURE_PROXY_SSL_HEADER = X-Forwarded-Proto` (پراکسی Coolify می‌گذارد، nginx پاس می‌دهد)؛ HSTS یک‌ساله، کوکی‌های Secure/HttpOnly، `X-Frame-Options: DENY`، `Referrer-Policy: same-origin`، CSP روی برنامه (nginx)، API و پنل (Django). `TRUSTED_PROXY_COUNT=2` (Coolify + nginx) تا IP واقعی کاربر برای محدودیت‌ها خوانده شود و جعل نشود. |

## ۴. فایل‌ها: چه به GitHub و چه به سرور می‌رود

| مسیر | دسته | دلیل |
| --- | --- | --- |
| `accounts/`، `partners/`، `operations/`، `finance/`، `config/`، `api/`، `kabulcargo_backend/`، `templates/`، `static/`، `locale/`، `manage.py` | A اجرا | کد بک‌اند، مایگریشن‌ها، دستورهای seed/backup |
| `frontend/src/`، `frontend/public/`، `frontend/index.html`، `package*.json`، تنظیمات Vite/TS/Tailwind | A اجرا | کد فرانت (فقط `dist/` ساخته‌شده به image می‌رود) |
| `requirements.txt`، `Dockerfile`، `.dockerignore`، `docker-compose*.yml`، `deploy/`، `.env*.example` | A اجرا | ساخت و اجرای stack |
| `scripts/` (verify، run_all_checks، stack test، load test)، `frontend/scripts/` (E2E، cleanup) | B فقط مخزن | آزمایش‌ها |
| `docs/`، `README.md`، `CLAUDE.md`، `frontend/VERIFY.md`، `requirements-dev.txt`، `.github/`، تنظیمات lint/prettier | B فقط مخزن | نگهداری |
| `.env`، `.venv/`، `node_modules/`، `dist/`، `media/`، `logs/`، `backups/`، `checks-output/`، `graphify-out/`، `.claude/`، `.cursor/`، `.vscode/`، `_local/`، `__pycache__/` | C فقط محلی | راز، دادهٔ واقعی، خروجی ساخت/آزمایش، ابزار ویرایشگر و دستیار |

**منتقل‌شده به `_local/` (چیزی پاک نشد):** ۱۰ گزارش `docs/stages/STAGE_*_COMPLETE.md` و
`STAGE_DOCUMENTS_COMPLETE.md` و `FIELD_SETTINGS_COMPLETE.md` → `_local/stages/`؛ ۸ پوشهٔ
`stage*_screenshots/` → `_local/screenshots/`؛ پشتیبان کامل تاریخچهٔ Git قبل از بازنویسی →
`_local/pre-rewrite-*.bundle`. **از Git بیرون شد ولی روی دیسک ماند:** `.claude/commands/` (۵ فایل)،
`.cursor/rules/` (۱ فایل). **کد کهنه/بی‌استفاده:** پیدا نشد — همهٔ ماژول‌های بک‌اند import می‌شوند؛ تنها
فایل فرانت که اسکن نشان داد (`NetProfitChart.tsx`) با `lazy()` در داشبورد بار می‌شود.

**image ها:** backend فقط کد Python و بسته‌های تولید (بدون کامپایلر، frontend، scripts، docs، `.git`،
`.env`)؛ web فقط `dist/` ساخته‌شده + تنظیم nginx (بدون source، source map، node_modules، Playwright)؛
db همان MySQL 8.4 + اسکریپت شروع. اندازهٔ نهایی image ها در اجرای stack test اندازه گرفته می‌شود
(`image-sizes.txt`).

## ۵. حافظه (RAM)

**هنوز اندازه‌گیری واقعی نشده** (همان مانع B1). سقف‌ها در `docker-compose.yml` و برآورد:

| سرویس | سقف (mem_limit) | برآورد بیکار | برآورد زیر بار سبک |
| --- | --- | --- | --- |
| kabulcargo_db (MySQL 8.4، buffer pool ۲۵۶ MB، performance schema خاموش) | ۶۴۰ MB | ~۳۵۰ MB | ~۴۲۰ MB |
| kabulcargo_backend (gunicorn، ۳ worker) | ۷۶۸ MB | ~۳۰۰ MB | ~۴۵۰ MB (Excel بزرگ بیشتر) |
| kabulcargo_redis | ۹۶ MB | ~۱۰ MB | ~۱۵ MB |
| kabulcargo_web (nginx) | ۱۲۸ MB | ~۱۰ MB | ~۲۰ MB |
| **جمع کابل کارگو** | **۱٫۶ GB** | **~۰٫۷ GB** | **~۰٫۹ GB** |

**سرور برای Donya + کابل کارگو:** (مصرف فعلی سرور با Coolify و Donya) + ۱٫۶ GB + حدود ۰٫۵ GB ذخیره.
در Coolify صفحهٔ سرور را ببینید: اگر **RAM آزاد ≥ ۲ GB** است، کافی است. اگر کمتر است: اول
`GUNICORN_WORKERS=2` (حدود ۱۰۰ MB کمتر) یا RAM سرور را زیاد کنید. اعداد واقعی را stack test
(`memory-idle.txt`، `memory-peak.txt` با ۲۰ کاربر × ۲ دقیقه) می‌دهد؛ اگر اوج هر سرویس از ۸۰٪ سقفش
بالاتر رفت، سقف را بلند کنید.

## ۶. موانع / باید درست شود / بعداً

### مانع (قبل از انتشار)
- **B1 — stack تولیدی اجرا نشده.** Docker روی کمپیوتر توسعه کار نمی‌کند. راه حل: GitHub → Actions →
  **Production stack test** → Run workflow؛ همهٔ سطرها باید PASS باشند. (یا فعال کردن Virtual Machine
  Platform/WSL 2 و BIOS virtualization روی همین کمپیوتر و `scripts\prod_local_test.ps1`.)

### باید درست شود (به زودی بعد از انتشار)
- پنل Coolify روی `http://…:8000` بدون رمزگذاری است: دامنهٔ HTTPS برایش بگذارید و پورت ۸۰۰۰ را ببندید
  (تغییر سراسری؛ با احتیاط، چون Donya هم هست).
- کاپی بیرون از سرور بک‌اپ‌ها: فعلاً دستی (هفته‌ای یک بار، `DEPLOY_COOLIFY.md` بخش ۷)؛ برای خودکار شدن
  `deploy/offsite-backup.sh` یک cron روی سرور لازم دارد (تصمیم صاحب سیستم).
- رهنمای کاربر برای صفحه‌های تازهٔ «اسناد» و «تنظیم فیلدها» متن دارد ولی هنوز عکس ندارد.
- مانیتور بیرونی (UptimeRobot) برای `/api/health/`.

### بعداً
- وارد کردن دادهٔ تاریخی از اکسل‌های قدیمی بندرها (فاز دوم، بعد از رسیدن اکسل‌ها).
- فونت‌های Vazirmatn/Inter را از خود سرور بدهید (نه Google) تا CSP بیرونی کاملاً بسته شود.
- دکمهٔ دانلود بک‌اپ برای سوپر ادمین داخل برنامه.

## ۷. روز انتشار — به ترتیب

1. GitHub → Actions → **Production stack test** → Run workflow → همه PASS (مانع B1). اعداد حافظه را
   با RAM آزاد سرور مقایسه کنید (بخش ۵).
2. وضع Donya را یادداشت کنید (`DEPLOY_COOLIFY.md` بخش ۰).
3. Coolify: GitHub App فقط با `kabul_transit` → پروژهٔ `Kabul Cargo` → Docker Compose از `main` (بخش ۱–۲).
4. دامنهٔ `https://transit.kabulcargo.com` فقط روی `kabulcargo_web` (بخش ۳).
5. متغیرها با مقدارهای تصادفی تازه + نگهداری در مدیر رمز (بخش ۴).
6. Deploy → هر چهار سرویس healthy → قفل https درست.
7. Terminal: `createsuperuser`، `seed_statement_lines`، `seed_document_types` (بخش ۶).
8. اولین بندر، کاربران، نرخ امروز؛ یک معاملهٔ آزمایشی + سند + Excel، بعد حذف آن.
9. Scheduled Task بک‌اپ (`30 21 * * *` اگر Coolify به UTC است) → Execute Now → فایل ساخته شد →
   `restore_db --drill` موفق.
10. بررسی Donya (بخش ۱۰ راهنما).
11. `.htaccess` در Spaceship: `Redirect 301 /kc_transit https://transit.kabulcargo.com/`.
12. نام کاربری‌ها و رمزها را حضوری به مدیران بندر بدهید؛ روز اول کنارشان باشید.

## ۸. برنامهٔ برگشت (Rollback)

- **مشکل در نصب اول:** منبع کابل کارگو → **Stop** (فقط کانتینرهای کابل کارگو؛ Donya دست نمی‌خورد).
  چون هنوز دادهٔ واقعی نیست، می‌توانید منبع را پاک کنید و از نو بسازید.
- **مشکل بعد از یک به‌روزرسانی:** Deployments → **Rollback**، یا Git Commit SHA قبلی → Redeploy
  (`DEPLOY_COOLIFY.md` بخش ۹). اگر مایگریشن دیتابیس را عوض کرده بود، بازیابی از بک‌اپ قبل از به‌روزرسانی.
- **Donya تحت تأثیر:** فوراً کابل کارگو را Stop کنید؛ سقف حافظهٔ کابل کارگو را پایین بیاورید یا RAM
  سرور را زیاد کنید، بعد دوباره Start.
- **از دست رفتن داده:** `restore_db <فایل> --confirm kabulcargo` از آخرین بک‌اپ (داخل سرور یا کاپی بیرونی).
