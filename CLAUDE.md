# PROJECT CONTEXT — Kabul Cargo Management System

این فایل در ریشهٔ پروژه قرار دارد. Claude Code آن را در هر جلسه خودکار می‌خواند.
همیشه قبل از اجرای یک مرحله، این را به یاد بسپار و از آن پیروی کن.

## زبان ارتباط
همیشه گزارش نهایی و توضیح به زبان دری ساده. کد و commit message به انگلیسی.

## چیستی پروژه
سیستم مدیریت ترانزیت، بارچلانی و مالی برای شرکت **کابل کارگو** (kabulcargo.com)
با دفتر مرکزی در کابل و شعبات در بنادر مختلف.
شعبات باید توسط سوپر ادمین از پنل اضافه شوند — هیچ نام بندری در کد ثابت نشود.

## واقعیت کسب‌وکار (مهم — تخطی نکن)
- دفتر مرکزی: کابل.
- هر شعبه یک نفر دارد که همهٔ کارها را انجام می‌دهد: هم ثبت موتر و اسناد،
  هم کارهای مالی. **نقش جداگانهٔ کارمند اسناد وجود ندارد.**
- یک سوپر ادمین در کابل بر همهٔ شعبات نظارت می‌کند: مفاد و ضرر، مدیریت کاربران،
  تنظیم فیلدها، و بک‌اپ.
- **تنها منبع درآمد = پرداخت مشتری.** هیچ چیز دیگر درآمد حساب نمی‌شود. تمام
  موارد دیگر (خاک‌پولی، استراس، ترانسپورت، T2، سیم، تکت‌ها، جوالی، توقف،
  تعرفه، حق‌العبور و ...) **مصرف** هستند.

## استک فنی (بدون پرسیدن تغییر نده)
- Python 3.12 + Django 5 (آخرین نسخهٔ پایدار)
- Django REST Framework + simplejwt برای احراز هویت
- MySQL (charset utf8mb4) از طریق mysqlclient
- django-jazzmin برای پنل ادمین تمیز و دری
- django-jalali برای تاریخ شمسی (jDateField)
- django-simple-history برای تاریخچهٔ تغییرات
- django-cors-headers
- Pillow برای آپلود تصاویر
- python-decouple برای رازهای .env

## برندینگ کابل کارگو (استخراج‌شده از خود سایت)
- PRIMARY = `#0C514C` (سبز اصلی)
- SECONDARY = `#0A443F` (سبز تیرهٔ لوگو)
- ACCENT = `#F97316` (نارنجی)
- INK = `#111827` (رنگ متن)
- BG = `#FFFFFF` (پس‌زمینه)
- فونت دری/پشتو: Vazirmatn
- فونت انگلیسی: Inter

منبع رنگ‌ها در `kabulcargo_backend/branding.py` ذخیره شده.

## نقش‌ها
فقط **دو نقش** وجود دارد:
1. `super_admin` (سوپر ادمین) — دفتر مرکزی کابل. دسترسی کامل به همه شعبات،
   مفاد و ضرر قفل، مدیریت کاربران، تنظیم فیلدها، بک‌اپ.
2. `branch_manager` (مدیر بندر) — هر شعبه. می‌تواند موتر ثبت کند، مالی ثبت کند،
   نرخ روز را مدیریت کند، حواله، مصارف دفتر، و حساب تجار بندر **خودش** را
   ببیند. مفاد و ضرر نهایی قفل است.

**هرگز** نقش `doc_clerk` یا `port_officer` نساز.

## قانون درآمد (محدودیت سخت)
تنها فیلد درآمدی روی Transaction = `customer_payment` (پولی که مشتری برای آن
موتر می‌دهد). می‌تواند به هر ارزی باشد. سیستم با نرخ روز USD↔AFN تبدیل می‌کند.
بقیهٔ همه‌چیز مصرف است.

فرمول نهایی بلانس:
```
balance_afn = customer_payment_afn − مجموع تمام مصارف به افغانی
```

## چهار نوع تجارت
Export / Import / Transit / TIR Carnet. هر کدام صفحهٔ جدا در UI دارد اما همه
در یک مدل Transaction با فیلد `trade_type` ذخیره می‌شوند. اینکه کدام فیلد
در کدام فورم ظاهر می‌شود، توسط FieldConfig هر شعبه + هر نوع تجارت تعیین
می‌شود. ترتیب فیلدها با `sort_order` است، نه الفبایی.

## قفل نرم نرخ روز
قبل از ساخت هر Transaction، OfficeExpense یا Hawala جدید، نرخ امروز USD→AFN
باید در ExchangeRate برای تاریخ سرور (Asia/Kabul) وجود داشته باشد. اگر نبود،
API باید HTTP 428 با کود `TODAY_RATE_MISSING` برگرداند. فرانت یک مودال کوچک
باز می‌کند که کاربر نرخ امروز را وارد کند، بعد خودکار درخواست را دوباره اجرا
کند. نرخ‌های تاریخ گذشته قابل اضافه‌کردن است؛ تاریخ آینده رد می‌شود.

## قوانین سادگی
- سیستم باید **قوی اما ساده** باشد. بدون تفکیک کارمند اسناد از مالی. بدون
  چند فیلد درآمد که کاربر را گیج کند. یک فیلد `customer_payment` و فیلدهای
  مصرف روشن.
- **اعداد:** هم دری/عربی (۰-۹ / ٠-٩) و هم انگلیسی (0-9) را قبول کن.
  قبل از پارس Decimal، به انگلیسی نرمال کن.
- **تاریخ:** همه‌جا شمسی و میلادی هر دو را نشان بده. در picker کاربر هر کدام
  را بتواند انتخاب کند.
- **مبلغ:** همه‌جا AFN و USD را کنار هم نشان بده با نرخ روز.

## ساختار اپ‌های Django (ساختار را عوض نکن)
- `accounts` → User, Branch
- `partners` → Trader, TransportCompany
- `operations` → Transaction, Document (فاز ۲ بعد از بررسی اکسل)
- `finance` → ExchangeRate, Hawala, OfficeExpense (فاز ۲)
- `config` → FieldConfig (فاز ۲)
- `accounting` → StatementLine برای صورت درآمد IAS 1 سبک (فاز ۲)

## قوانین طلایی (در هر مرحله رعایت کن)
- مدل User و Branch سفارشی حتماً قبل از اولین migration ساخته شوند.
- همه فیلدهای پولی `DecimalField(max_digits=14, decimal_places=2)`. هرگز
  FloatField نگذار.
- همه فیلدهای **نرخ اسعار** `DecimalField(max_digits=14, decimal_places=8)`
  (تا نرخ‌های خیلی کوچک مثل تومان ≈ 0.0016 افغانی دقیق بمانند). این قانون
  برای `Transaction.exchange_rate` اعمال شده و در مرحلهٔ ۴ برای نرخ‌های
  `ExchangeRate`، `Hawala` و `OfficeExpense` هم باید اعمال شود.
- همه رازها در `.env` با python-decouple. هرگز هارد‌کد نکن.
- هر مدل، هر فیلد، هر choice باید `verbose_name` دری داشته باشد — ادمین
  کاملاً دری باشد.
- `LANGUAGE_CODE = 'fa'`، `TIME_ZONE = 'Asia/Kabul'`، `USE_I18N = True`،
  `USE_TZ = True`.
- `LocaleMiddleware` را **قرار نده** (تا ادمین صرف‌نظر از مرورگر، دری بماند).
- ادمین باید برای یک سوپر ادمین غیر فنی قابل فهم باشد: `list_display`،
  `list_filter`، `search_fields`، فیلدست‌های گروه‌بندی‌شده، help_text دری.
- **فقط مرحلهٔ فعلی را انجام بده.** مراحل بعدی را از قبل نساز.
- بعد از هر مرحله: migrate، گزارش کوتاه به دری، و **توقف کن**.

## درس‌های پروژه‌های قبل (از روز اول رعایت کن)
- اعداد: دری/عربی + انگلیسی هر دو را قبول کن.
- تاریخ: شمسی/میلادی دوگانه از روز اول.
- مبلغ: AFN/USD دوگانه از روز اول.
- خلاصهٔ ردیف (جمله مصرف افغانی / فی دالر / جمله مصرف دالر / مفاد یا ضرر)
  یک مفهوم کلیدی است — Transaction آن را به‌عنوان property فقط‌خواندنی
  اکسپوز می‌کند.
- محدودیت شعبه در لایهٔ queryset API اعمال می‌شود، نه فقط در UI.
- سوپر ادمین هر زمان exchange_rate را روی هر رکوردی ویرایش می‌کند؛ مدیر
  بندر هم. قفل بعد از ذخیره نگذار (آن تصمیم اشتباهی بود در پروژهٔ قبلی).
- FieldConfig از روز اول `sort_order` دارد؛ فورم‌ها هرگز الفبایی نیستند.

## نحوهٔ کار Claude Code در این پروژه
- قبل از هر کار، آخرین وضعیت `git status` را ببین.
- اگر کاربر مرحله‌ای را نام ببرد (مثلاً `/stage-2` یا «مرحله ۲ را اجرا کن»)،
  فایل `.claude/commands/stage-N.md` را دنبال کن.
- هر مرحله یک `TodoWrite` بساز، آیتم‌ها را یکی‌یکی `in_progress` کن.
- بعد از اتمام مرحله، تغییرات را git commit کن با پیام مرحله.
- گزارش نهایی را به دری ساده بنویس.
- اگر MySQL در دسترس نبود، صریح به کاربر بگو و با SQLite موقت پیش نرو
  مگر کاربر صریح بگوید.

## وضعیت فعلی (در هر مرحله به‌روز می‌شود)
- [x] مرحلهٔ ۰: راه‌اندازی + Branch + User + ادمین دری + برندینگ
- [x] مرحلهٔ ۱: Trader + TransportCompany
- [x] نصب MySQL و اجرای مایگریشن روی دیتابیس واقعی
- [x] مرحلهٔ ۲: تاریخچهٔ کامل (Audit Log)
- [x] مرحلهٔ ۳: Transaction + Document (منطق یگانه عاید)؛ `exchange_rate` با ۸ رقم اعشار
- [x] مرحلهٔ ۴: ExchangeRate + Hawala + OfficeExpense + قفل نرم نرخ روز
  - قفل نرم فعلاً فقط در پنل ادمین (ریدایرکت به فورم نرخ)؛ API (HTTP 428) در مرحلهٔ ۶
  - [x] `Transaction.fee_per_dollar_afn` برای ارزهای غیر دالر = نرخ دالرِ تاریخِ معامله (مرحلهٔ ۱۲ب)
- [x] مرحلهٔ ۵: FieldConfig با sort_order و seed command
  - بندر جدید خودکار ۱۷۲ ردیف FieldConfig می‌گیرد (signal در `config/signals.py`).
    دستور `seed_field_config` فقط برای بندرهای قدیمی یا بعد از اضافه شدن فیلد
    تازه به FIELD_SPEC لازم است.
- [x] مرحلهٔ ۶: API کامل + JWT + دسترسی + قفل نرم روی API
  - همهٔ endpoint ها زیر `/api/` (ورود: `/api/auth/login/`). وقتی DEBUG روشن
    است، باز کردن `/api/` در مرورگر صفحهٔ browsable API از DRF را نشان می‌دهد.
  - آزمایش کامل: `.venv\Scripts\python scripts\verify_api.py` (۳۱ تست، rollback)
- [x] مرحلهٔ ۷: سخت‌سازی امنیتی (rate limit، قفل حساب، هدرها، CSP، فایل، لاگ، بک‌اپ)
  - آزمایش: `.venv\Scripts\python scripts\verify_security.py` (۲۷ تست)
  - IP کاربر فقط از `kabulcargo_backend.security.client_ip` (هم axes، هم ratelimit،
    هم throttle). X-Forwarded-For فقط با `TRUSTED_PROXY_COUNT>0` اعتبار دارد.
  - همهٔ serializerها از `KabulModelSerializer` ارث ببرند: متن آزاد با bleach پاک
    می‌شود (TextField حداکثر ۲۰۰۰ حرف).
  - MySQL ویندوز: یک بار `deploy\mysql_timezones_windows.sql` با root؛ بدون آن
    `CONVERT_TZ` تهی برمی‌گرداند و فیلترهای تاریخ پنل خراب می‌شوند.
  - production: `settings_production.py` + `createcachetable` (یا Redis).
  - CSP پنل ادمین عمداً `'unsafe-inline'` برای script دارد (Jazzmin)؛ API سخت است.
- [x] مرحلهٔ ۸: صورت حساب عاید IAS 1 (StatementLine، `finance/reports.py`، API)
  - ساختن: `GET /api/income-statement/?branch=3&date_from=1405-07-01&date_to=1405-07-30`
    (بدون تاریخ = ماه جاری شمسی؛ سوپر ادمین بدون branch = همهٔ بندرها)
  - سطرها: `python manage.py seed_statement_lines` (سطرهای موجود دست نمی‌خورند؛
    `--reset` پیش‌فرض‌ها را برمی‌گرداند). هر فیلد مصرف معامله باید دقیقاً در یک سطر
    فعال باشد، ورنه گزارش هشدار می‌دهد.
  - دالر: معاملهٔ دالری = مبلغ خودش؛ ارزهای دیگر = افغانی ÷ نرخ دالرِ تاریخِ معامله
    (یا آخرین نرخ قبل از آن). هرگز نرخ امروز.
  - آزمایش: `.venv\Scripts\python scripts\verify_statement.py` (۳۶ تست)
- [x] مرحلهٔ ۹: پایهٔ فرانت (`frontend/`: Vite + React 18 + TS + Tailwind 3 + i18n fa/ps/en + JWT)
  - dev: `npm run dev` روی :5173، `/api` به :8000 proxy می‌شود (CORS لازم نیست).
  - آزمایش: `frontend/VERIFY.md` → `npm run verify:e2e` (۲۱ تست، Edge + playwright-core).
  - ESLint 9 flat config؛ `className` فقط با `cn()`. فیلد عددی = `<Input inputMode="decimal">`.
- [x] مرحلهٔ ۱۰: صفحه‌های سوپر ادمین (بندرها، کاربران، نرخ اسعار، سطرهای گزارش) + `/api/users/<id>/unlock/`
  - primitiveهای مشترک در `frontend/src/components/ui/` (DataTable، Drawer، Modal، ConfirmDialog،
    DateInput شمسی، FormField…) و hooks در `src/lib/hooks.ts` — صفحه‌های بعدی از همین‌ها بسازند.
  - drawer هر فورم یک URL دارد (child route بدون element؛ صفحه با `useMatch` می‌خواند).
  - حذفِ رکورد محافظت‌شده (`on_delete=PROTECT`) → HTTP 409 با پیام دری، نه 500.
  - choices از DRF `OPTIONS` خوانده می‌شود؛ برای همین `server.cors: false` در Vite لازم است.
  - آزمایش: `frontend/VERIFY.md` → `scripts/verify-stage10.mjs` (۳۰ تست) + `cleanup-stage10.py`.
- [x] مرحلهٔ ۱۱: صفحه‌های شرکا (تاجران، شرکت‌های ترانسپورت) برای هر دو نقش
  - `components/partners/PartnerPage.tsx` با config (endpoint، ns، fields) — نوع تازهٔ شریک = یک صفحهٔ ~۲۰ خطی.
  - DataTable حالا ستون قابل مرتب‌سازی دارد (`sortable` + `sort`/`onSort`؛ مرتب‌سازی در صفحه).
  - API تاریخچه برای Trader/TransportCompany ندارد (مدل دارد). POST `/transactions/` حتی از مدیر بندر `branch` می‌خواهد.
  - آزمایش: `cleanup-stage11.py --setup` → `verify-stage11.mjs` (۲۰ تست) → `cleanup-stage11.py`.
- [x] مرحلهٔ ۱۲الف: فهرست معاملات + فورم پویا (`frontend/src/pages/transactions/`)
  - `lib/transactionSections.ts` منبع واحد نوع و بخش ۴۳ فیلد؛ form-config فقط نمایش/لازم/ترتیب را تعیین می‌کند.
  - `POST /api/transactions/preview-summary/` خلاصهٔ ردیف فورم ذخیره‌نشده (از propertyهای خود مدل).
  - فهرست معاملات (فقط همین) pagination دارد: `{count, next, previous, results}`، ۲۵ تایی.
  - «عواید استراس/ترانسپورت» در UI هم مصرف حساب می‌شوند (قانون یگانه عاید).
  - آزمایش: `cleanup-stage12a.py --setup` → `verify-stage12a.mjs` (۳۴ تست) → `cleanup-stage12a.py`.
    همهٔ cleanup ها حالا تاریخچهٔ دادهٔ آزمایشی را هم پاک می‌کنند (`scripts/e2e_history.py`).
- [x] مرحلهٔ ۱۲ب: جزئیات معامله، اسناد، معادل دالری، ثبت نرخ امروز توسط مدیر بندر
  - نرخ دالر یک تاریخ فقط از `finance.utils.usd_rate_on` / `UsdRateTable` (گزارش عاید و مدل هر دو).
    فهرست‌ها با `attach_usd_rates` نرخ‌ها را یکجا بار می‌کنند (بدون N+1).
  - فایل سند فقط از `GET /api/documents/<id>/download/`؛ API نشانی `/media/` نمی‌دهد. production:
    `DOCUMENT_X_ACCEL_PREFIX` + `deploy/nginx-documents.conf` (`/media/` عمومی نیست). حذف سند فایل را هم پاک می‌کند.
  - `api/history.py` → `HistoryMixin` (فقط فیلدهای تغییرکرده) روی معامله، تاجر، شرکت، حواله، مصرف دفتر.
  - مدیر بندر فقط نرخ امروز را می‌سازد؛ ویرایش/حذف نرخ فقط سوپر ادمین. حذف معامله: هر دو نقش (بندر خود).
  - آزمایش: `cleanup-stage12b.py --setup` → `verify-stage12b.mjs` (۲۱) → `cleanup-stage12b.py`.
- [x] مرحلهٔ ۱۳: صفحه‌های مالی (حواله‌ها، مصارف دفتر) برای هر دو نقش
  - لیست‌های حواله / مصارف دفتر صفحه‌بندی (`api/pagination.py`) و بلوک `totals` دارند؛ جمع‌ها با
    `finance.reports.amount_totals` (همان تبدیل گزارش عاید) — هر دو همیشه برابرند.
  - API تاریخچه (`api/history.py`) مقایسه را خودش می‌کند؛ `diff_against` روی فیلد غیرقابل‌ویرایش
    مثل `rate_used` خطا می‌دهد.
  - hook/ثابت‌های مالی در `src/lib/finance.ts`؛ کمپوننت‌ها در `components/finance/shared.tsx`
    (فیلتر، RateNote، RateLockPanel برای ۴۲۸، HistoryModal). `useDayRate` در `lib/rates.ts`.
  - API برای هر کاربر ۱۰۰ درخواست در دقیقه (مرحلهٔ ۷)؛ اسکریپت‌های E2E باید زیر آن بمانند.
  - آزمایش: `cleanup-stage13.py --setup` → `verify-stage13.mjs` (۲۵ تست) → `cleanup-stage13.py`.
- [x] مرحلهٔ ۱۴: داشبورد، صفحهٔ گزارش عاید، خروجی Excel
  - `GET /api/dashboard/summary/` (`finance/dashboard.py`) — همهٔ ارقام از `income_statement`؛ داشبورد و گزارش هرگز فرق ندارند.
  - Excel: `api/excel.py` (openpyxl) → `/api/income-statement/export/` و `/api/transactions/export/` (همهٔ ردیف‌های فیلترشده)؛ هر خروجی در لاگ امنیتی.
  - آزمایش: `cleanup-stage14.py --setup` → `verify-stage14.mjs` (۲۵ تست) → `cleanup-stage14.py`.
- [ ] فاز دوم: Transaction، FieldConfig، نرخ، فرانت (بعد از رسیدن اکسل جدید)

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
