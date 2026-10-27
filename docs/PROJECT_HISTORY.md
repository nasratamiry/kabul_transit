# تاریخچهٔ پروژه — سیستم مدیریت کابل کارگو

خلاصهٔ هر مرحله: چه ساخته شد، کدام commit، و چند آزمایش. گزارش‌های کامل هر مرحله
(`STAGE_*_COMPLETE.md`) فقط روی کمپیوتر توسعه در `_local/stages/` مانده‌اند. جزئیات فنی و قانون‌های
هر مرحله در `CLAUDE.md` (بخش «وضعیت فعلی») است.

| مرحله | چه ساخته شد | commit | آزمایش |
| --- | --- | --- | --- |
| ۰–۳ | راه‌اندازی Django 5 + MySQL، مدل سفارشی User و Branch (دو نقش)، ادمین دری (Jazzmin)، برندینگ؛ تاجران و شرکت‌های ترانسپورت؛ تاریخچهٔ کامل تغییرات (simple-history)؛ Transaction (۴ نوع تجارت، ۴۳ فیلد، یگانه عاید = پرداخت مشتری) + Document؛ نرخ ۸ رقم اعشار. (مخزن Git در مرحلهٔ ۳ ساخته شد، پس مراحل ۰ تا ۳ یک commit اول دارند.) | `4052f90` `1900458` `6fc6072` `c0b7d4d` | `verify_transaction.py` ۱۴ |
| ۴ | نرخ اسعار، حواله، مصارف دفتر، قفل نرم نرخ روز | `87b4c7b` | `verify_finance.py` ۳۲ |
| ۵ | FieldConfig با sort_order، seed، ساخت خودکار ۱۷۲ ردیف برای بندر تازه | `54ba75b` `b196ba8` | `verify_field_config.py` |
| ۶ | API کامل، JWT، دسترسی بر اساس نقش و بندر، قفل نرم ۴۲۸ روی API | `af954c8` | `verify_api.py` ۶۲، `verify_transaction.py` ۱۴ |
| ۷ | سخت‌سازی امنیتی: rate limit، قفل حساب، هدرها، CSP، اعتبار فایل، لاگ امنیتی، بک‌اپ | `17b0e26` | `verify_security.py` |
| ۸ | صورت حساب عاید IAS 1 (StatementLine) | `311eb9f` | `verify_statement.py` ۳۶ |
| ۹ | پایهٔ فرانت: Vite + React + TS + Tailwind، دری/پشتو/انگلیسی، RTL، شمسی، JWT | `c020e0f` | E2E ۲۱ |
| ۱۰ | صفحه‌های سوپر ادمین: بندرها، کاربران، نرخ اسعار، سطرهای گزارش | `c529a0c` | E2E ۳۰ |
| ۱۱ | صفحه‌های شرکا (تاجران، شرکت‌های ترانسپورت) | `be59ce2` | E2E ۲۰ |
| ۱۲الف | فهرست معاملات + فورم پویا (از FieldConfig) | `825b142` | E2E ۳۴ |
| ۱۲ب | جزئیات معامله، اسناد، معادل دالری، ثبت نرخ امروز توسط مدیر بندر | `95ac37b` | E2E ۲۱ |
| ۱۳ | صفحه‌های مالی: حواله‌ها، مصارف دفتر | `31881f4` | E2E ۲۵ |
| ۱۴ | داشبورد، صفحهٔ گزارش عاید، خروجی Excel، صفحه‌های چاپ | `2213c7a` | E2E ۲۵ |
| ۱۵ | آمادگی production: Docker، health، تمرین بازیابی، run_all_checks، راهنماها | `479209b` `fa1b45f` | همهٔ بالا |
| اسناد گمرکی | DocumentType، جدول اسناد لازم، چک‌لیست، فیلتر اسناد ناقص، فهرست `/documents`، هماهنگی نمبر | `d3cb1b6` | `verify_documents.py` ۳۸ + E2E ۳۰ |
| تنظیم فیلدها | صفحهٔ تنظیم فیلدها برای سوپر ادمین: فیلدهای قفل، ذخیرهٔ یکجا، کپی، بازگشت به پیش‌فرض | `c2b7fd5` | `verify_field_config.py` ۶۶ + E2E ۲۲ |
| آمادگی نهایی | بررسی کامل، Coolify، مسیر مخفی پنل Django، محدودیت‌های مناسب دفتر با یک IP، پاک‌کاری مخزن | (commitهای پایین) | `docs/stages/FINAL_READINESS.md` |

## commitهای بررسی نهایی (آمادگی انتشار)

- `2030b54` security: office-NAT-safe login limits, super-admin-only Django admin at ADMIN_URL
- `84a8aa4` test: Kabul-day check, production guard for E2E fixtures, fix two flaky waits
- `e99a9dd` deploy: Coolify-ready stack for the shared server, slim images, stack test
- `e636989` chore: only needed files in Git (local-only folder, tooling untracked)
- `6b3e3ce` docs: Coolify deployment guide (Dari), deploy and user guides, README
- `3b8692c` test: stage 9 waits for the token refresh, not just the greeting
- `docs: final readiness report …` (همین گزارش، GO_LIVE، PROJECT_HISTORY، CLAUDE.md)

پیش از این بررسی، جلسهٔ دیگر: `feat: field settings page …` (صفحهٔ تنظیم فیلدها).
