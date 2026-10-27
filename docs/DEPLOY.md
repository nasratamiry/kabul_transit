# راهنمای نصب و نگهداری — سیستم مدیریت کابل کارگو

این راهنما برای کسی است که سیستم را روی سرور نصب و نگهداری می‌کند (شما یا متخصص IT شما).
همه چیز با **Docker** اجرا می‌شود: یک بار نصب، بعد با چند دستور ساده به‌روز می‌شود.

---

## ۱. سیستم از چه بخش‌هایی ساخته شده

| بخش | کار آن |
| --- | --- |
| **nginx** | صفحهٔ برنامه را به مرورگر می‌دهد و درخواست‌ها را به Django می‌فرستد. فایل اسناد را فقط بعد از اجازهٔ Django می‌دهد. |
| **backend** (Django + gunicorn) | همهٔ منطق: ورود، معاملات، گزارش‌ها، پنل `/admin/`. |
| **mysql** (MySQL 8.4) | دیتابیس. همهٔ اطلاعات اینجاست. |
| **redis** | شمارندهٔ محدودیت درخواست‌ها (ضد حمله). اطلاعات مهم ندارد. |
| **backup** | هر شب ساعت ۲ (وقت کابل) از دیتابیس بک‌اپ می‌گیرد و ۳۰ روز نگه می‌دارد. |
| **caddy** (فقط VPS ساده) | گواهی SSL (قفل سبز https) را خودکار از Let's Encrypt می‌گیرد و تمدید می‌کند. |

---

## ۲. چه چیزهایی لازم است

### سرور

| | حداقل | پیشنهادی |
| --- | --- | --- |
| پردازنده | ۲ هسته | ۲ تا ۴ هسته |
| حافظه (RAM) | ۲ GB (با ۲ GB swap) | ۴ GB |
| دیسک | ۲۰ GB SSD | ۴۰ GB SSD |
| سیستم عامل | Ubuntu 22.04 یا 24.04 (۶۴ بیتی) | Ubuntu 24.04 LTS |

یک IP ثابت (public) لازم است. سرور می‌تواند در هر کشوری باشد؛ نزدیک‌تر به افغانستان (مثلاً
آلمان، ترکیه، امارات) سرعت بهتر دارد.

### دامنه و DNS

1. یک زیردامنه انتخاب کنید، مثلاً `app.kabulcargo.com`.
2. در پنل DNS دامنهٔ `kabulcargo.com` یک رکورد بسازید:

   | نوع | نام | مقدار |
   | --- | --- | --- |
   | `A` | `app` | IP سرور، مثلاً `203.0.113.10` |

3. ۵ تا ۳۰ دقیقه صبر کنید. آزمایش: `ping app.kabulcargo.com` باید IP سرور را نشان دهد.

اگر از Cloudflare استفاده می‌کنید، برای اولین نصب ابر نارنجی را **خاموش** (DNS only) بگذارید تا
گواهی SSL گرفته شود. بعداً اگر روشنش کردید، `TRUSTED_PROXY_COUNT` را یکی زیاد کنید (بخش ۵).

---

## ۳. راه اول: Coolify (پیشنهادی اگر Coolify دارید)

Coolify یک پنل ساده برای اجرای برنامه‌های Docker است؛ SSL و به‌روزرسانی را خودش انجام می‌دهد.

1. در Coolify: **+ New → Resource** → مخزن Git پروژه را انتخاب کنید (Public یا Private با GitHub App).
2. **Build Pack** را `Docker Compose` بگذارید و فایل را `docker-compose.yml` (پیش‌فرض) نگه دارید.
3. در بخش **Environment Variables** همهٔ متغیرهای فایل `.env.production.example` را با مقدار
   واقعی بنویسید (بخش ۵). `DOMAIN` و `LETSENCRYPT_EMAIL` در Coolify لازم نیست.
4. در لیست سرویس‌ها روی **nginx** کلیک کنید و در **Domains** بنویسید:
   `https://app.kabulcargo.com` — Coolify گواهی SSL را خودش می‌گیرد. (سرویس‌های دیگر دامنه ندارند.)
5. **Deploy** را بزنید. اولین ساخت ۵ تا ۱۰ دقیقه طول می‌کشد.
6. وقتی همهٔ سرویس‌ها سبز (healthy) شدند، به بخش ۶ (اولین اجرا) بروید.
   دستورهای این راهنما را در Coolify از **Terminal** همان سرویس (`backend`) اجرا کنید؛ بخش
   `docker compose exec backend` را ننویسید.

---

## ۴. راه دوم: VPS ساده (بدون Coolify)

همهٔ دستورها با کاربر root یا با `sudo`.

```bash
# ۱) Docker
curl -fsSL https://get.docker.com | sh

# ۲) دیوار آتش: فقط SSH، http و https
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable

# ۳) کد برنامه
git clone <نشانی مخزن Git> /opt/kabulcargo
cd /opt/kabulcargo

# ۴) تنظیمات
cp .env.production.example .env
nano .env            # مقدارها را بنویسید (بخش ۵) — Ctrl+O ذخیره، Ctrl+X خروج
chmod 600 .env

# ۵) اجرا (Caddy گواهی SSL را خودکار می‌گیرد)
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --build

# ۶) وضعیت — همه باید healthy یا running باشند
docker compose -f docker-compose.yml -f docker-compose.vps.yml ps
```

برای کوتاه شدن دستورها، یک بار این را در `~/.bashrc` بنویسید و ترمینال را دوباره باز کنید:

```bash
alias kc='docker compose -f /opt/kabulcargo/docker-compose.yml -f /opt/kabulcargo/docker-compose.vps.yml --project-directory /opt/kabulcargo'
```

از این به بعد در این راهنما `kc` یعنی همین دستور (در Coolify: Terminal سرویس).

### SSL (Let's Encrypt)

- **VPS ساده:** Caddy به محض اجرا برای `DOMAIN` گواهی می‌گیرد و هر ۶۰ روز خودکار تمدید می‌کند.
  شرط: رکورد DNS درست باشد و پورت‌های ۸۰ و ۴۴۳ باز باشند. اگر گواهی گرفته نشد: `kc logs caddy`.
- **Coolify:** خودش انجام می‌دهد (بخش ۳، قدم ۴).
- همهٔ صفحه‌ها فقط با `https://` باز می‌شوند؛ `http://` خودکار به `https://` می‌رود.

---

## ۵. متغیرهای تنظیمات (`.env`)

| متغیر | چیست | مثال |
| --- | --- | --- |
| `DOMAIN` | دامنه، بدون `https://` (فقط VPS ساده) | `app.kabulcargo.com` |
| `ALLOWED_HOSTS` | همان دامنه — Django فقط به آن جواب می‌دهد | `app.kabulcargo.com` |
| `CORS_ALLOWED_ORIGINS` | همان دامنه با `https://` | `https://app.kabulcargo.com` |
| `CSRF_TRUSTED_ORIGINS` | همان دامنه با `https://` (برای ورود به `/admin/`) | `https://app.kabulcargo.com` |
| `LETSENCRYPT_EMAIL` | ایمیل برای هشدارهای گواهی SSL | `it@kabulcargo.com` |
| `SECRET_KEY` | کلید رمز Django، **۵۰+ حرف تصادفی** | (دستور پایین) |
| `DB_PASSWORD` | رمز کاربر دیتابیس | (دستور پایین) |
| `MYSQL_ROOT_PASSWORD` | رمز مدیر MySQL — متفاوت از بالا | (دستور پایین) |
| `DB_NAME`, `DB_USER` | نام دیتابیس و کاربر آن | `kabulcargo` (پیش‌فرض) |
| `TRUSTED_PROXY_COUNT` | تعداد پراکسی جلوی Django. Caddy/Coolify + nginx = **۲**؛ با Cloudflare = **۳** | `2` |
| `GUNICORN_WORKERS` | تعداد پروسه‌های همزمان: حدود ۲ × هسته + ۱ | `3` |
| `JWT_ACCESS_MINUTES` | ورود بعد از چند دقیقه بی‌کاری تازه می‌شود | `60` |
| `JWT_REFRESH_DAYS` | بعد از چند روز دوباره رمز خواسته شود | `7` |
| `BACKUP_HOUR` | ساعت بک‌اپ شبانه (وقت کابل، ۰ تا ۲۳) | `2` |
| `BACKUP_KEEP_DAYS` | بک‌اپ‌ها چند روز در سرور بمانند | `30` |

ساختن رمزهای تصادفی (روی سرور):

```bash
docker run --rm python:3.12-slim python -c "import secrets; print(secrets.token_urlsafe(64))"   # SECRET_KEY
docker run --rm python:3.12-slim python -c "import secrets; print(secrets.token_urlsafe(32))"   # هر رمز دیتابیس
```

**مهم:**
- فایل `.env` را هرگز در Git، واتساپ یا ایمیل نفرستید. یک نسخه را در یک جای امن (مثلاً
  مدیر رمز) نگه دارید — بدون `DB_PASSWORD` بک‌اپ‌ها بازیابی نمی‌شوند.
- `KC_LOCAL_HTTP_TEST` را **هرگز** در سرور ننویسید؛ فقط برای آزمایش روی کمپیوتر توسعه است و
  اگر با دامنهٔ واقعی روشن شود، Django اصلاً روشن نمی‌شود.
- اگر `SECRET_KEY` را عوض کنید، همهٔ کاربران یک بار خارج می‌شوند (مشکلی نیست).

---

## ۶. اولین اجرا

بعد از اینکه همهٔ سرویس‌ها healthy شدند:

```bash
# ۱) سوپر ادمین اول — نام کاربری و رمز قوی را خودتان انتخاب می‌کنید
kc exec backend python manage.py createsuperuser

# ۲) سطرهای پیش‌فرض گزارش عاید (IAS 1)
kc exec backend python manage.py seed_statement_lines
```

بعد در مرورگر `https://app.kabulcargo.com` را باز کنید، با سوپر ادمین وارد شوید و:

1. **مدیریت → بندرها → بندر تازه:** هر شعبه را اضافه کنید (نام، کود کوتاه انگلیسی مثل `HRT`،
   شهر). کود بعد از ثبت عوض نمی‌شود. هر بندر خودکار ۱۷۲ تنظیم فیلد می‌گیرد.
2. **مدیریت → کاربران → کاربر تازه:** برای هر بندر یک «مدیر بندر» بسازید و بندرش را انتخاب کنید.
   نام کاربری و رمز را حضوری یا تلفنی (نه در گروه) به او بدهید.
3. **مدیریت → نرخ اسعار:** نرخ امروز دالر را ثبت کنید. بدون نرخ امروز، ثبت معامله، حواله و
   مصرف دفتر ممکن نیست (سیستم خودش پنجرهٔ ثبت نرخ را باز می‌کند).
4. اختیاری: **مدیریت → سطرهای گزارش** برای تغییر نام سطرهای گزارش عاید.

---

## ۷. کار روزانه

### نرخ روز
هر صبح نرخ دالر امروز ثبت شود — توسط سوپر ادمین (مدیریت → نرخ اسعار) یا مدیر هر بندر (اولین
باری که معامله ثبت می‌کند، سیستم می‌پرسد). مدیر بندر فقط نرخ **امروز** را ثبت می‌کند؛ اصلاح یا
حذف نرخ فقط کار سوپر ادمین است.

### بک‌اپ
- **خودکار:** هر شب ساعت ۲، فایل `kabulcargo-YYYY-MM-DD-HHMM.sql.gz`، ۳۰ روز نگه داشته می‌شود.
- **دستی (مثلاً قبل از به‌روزرسانی):** `kc exec backend python manage.py backup_db`
- **فهرست بک‌اپ‌ها:** `kc exec backend ls -lh /app/backups`
- **بیرون از سرور (ضروری):** بک‌اپی که فقط در همان سرور است، با خراب شدن سرور از بین می‌رود.
  فایل `deploy/offsite-backup.sh` هر شب بک‌اپ دیتابیس **و** فایل‌های اسناد را به
  `/var/backups/kabulcargo` و (با تنظیم `rclone`) به یک فضای بیرونی (Backblaze B2، Google Drive،
  سرور دیگر) کاپی می‌کند:

  ```bash
  apt install -y rclone
  rclone config                      # یک بار: مثلاً remote به نام b2 بسازید
  crontab -e                         # این سطر را اضافه کنید:
  30 3 * * * OFFSITE_RCLONE_REMOTE=b2:kabulcargo-backups /opt/kabulcargo/deploy/offsite-backup.sh >> /var/log/kabulcargo-offsite.log 2>&1
  ```

  ماهی یک بار `/var/log/kabulcargo-offsite.log` را نگاه کنید: باید هر روز «off-server copy ok» باشد.
- **آزمایش بازیابی (ماهی یک بار):** `kc exec backend python manage.py restore_db --drill`
  — یک بک‌اپ تازه می‌گیرد، آن را در یک دیتابیس جداگانه بار می‌کند، همهٔ جدول‌ها را با دیتابیس
  اصلی مقایسه می‌کند و بعد پاک می‌کند. دیتابیس اصلی دست نمی‌خورد. پیام آخر باید «تمرین بازیابی
  موفق» باشد.

### لاگ‌ها (گزارش رویدادها)

| چه | دستور |
| --- | --- |
| همهٔ سرویس‌ها (زنده) | `kc logs -f --tail 100` |
| فقط Django (خطاها، ورودها، رویدادهای امنیتی) | `kc logs backend --tail 200` |
| فقط رویدادهای امنیتی | `kc exec backend tail -n 100 /app/logs/security.log` |
| بک‌اپ شبانه | `kc logs backup --tail 20` |
| SSL | `kc logs caddy --tail 50` |

لاگ‌ها خودکار چرخانده می‌شوند (هر سرویس حداکثر ۵ فایل × ۱۰ MB)؛ دیسک پر نمی‌شود.
در `security.log` ورود ناموفق، قفل حساب، ساختن کاربر، تغییر نقش، خروجی Excel و بک‌اپ ثبت است.

### باز کردن حساب قفل‌شده
بعد از ۵ رمز اشتباه، حساب ۱۵ دقیقه قفل می‌شود. سوپر ادمین فوراً باز می‌کند:
**مدیریت → کاربران** → کنار نام کاربر نشان «قفل» → دکمهٔ **باز کردن قفل**.
(اگر خود سوپر ادمین قفل شد: ۱۵ دقیقه صبر، یا `kc exec backend python manage.py axes_reset`.)

### فراموشی رمز
سوپر ادمین در **مدیریت → کاربران → تغییر رمز** رمز تازه می‌گذارد. اگر رمز خود سوپر ادمین
فراموش شد: `kc exec backend python manage.py changepassword <نام کاربری>`

### وضعیت سلامت
`https://app.kabulcargo.com/api/health/` باید `{"status": "ok", ...}` نشان دهد. این نشانی را
می‌توانید به یک سرویس رایگان مثل UptimeRobot بدهید تا اگر سیستم خاموش شد به شما ایمیل بزند.

---

## ۸. به‌روزرسانی (نسخهٔ تازه)

```bash
cd /opt/kabulcargo
kc exec backend python manage.py backup_db       # ۱) بک‌اپ قبل از هر چیز
git tag before-$(date +%Y%m%d) && git pull       # ۲) نشانه‌گذاری نسخهٔ فعلی + گرفتن کد تازه
kc up -d --build                                  # ۳) ساخت و اجرا (مایگریشن‌ها خودکار)
kc ps                                             # ۴) همه healthy؟
```

در Coolify: **Redeploy** (یا Auto Deploy با هر push). قبلش از Terminal سرویس backend
`python manage.py backup_db` را بزنید.

قطعی در هنگام به‌روزرسانی معمولاً کمتر از یک دقیقه است. بهتر است بیرون از ساعت کاری انجام شود.

### برگشت به نسخهٔ قبل (Rollback)

```bash
cd /opt/kabulcargo
git log --oneline -5                    # یا: git tag   (before-YYYYMMDD)
git checkout before-20261027            # نسخهٔ قبلی
kc up -d --build
```

اگر نسخهٔ تازه دیتابیس را تغییر داده بود (مایگریشن) و نسخهٔ قبلی درست کار نمی‌کند، دیتابیس را هم
از بک‌اپی که در قدم ۱ گرفتید بازیابی کنید (بخش ۹). بعد از حل مشکل، با `git checkout main` به
شاخهٔ اصلی برگردید.

---

## ۹. بازیابی از بک‌اپ (روز بد)

**هشدار:** این کار دیتابیس فعلی را با بک‌اپ عوض می‌کند. هر چیزی که بعد از زمان بک‌اپ ثبت شده
پاک می‌شود. سیستم قبل از بازیابی خودش یک بک‌اپ احتیاطی از وضع فعلی می‌گیرد.

```bash
# ۱) فهرست بک‌اپ‌ها
kc exec backend ls -lh /app/backups

# ۲) اگر بک‌اپ از بیرون سرور آمده، اول آن را به داخل بفرستید:
kc cp /var/backups/kabulcargo/db/kabulcargo-2026-10-27-0200.sql.gz backend:/app/backups/

# ۳) بازیابی (نام دیتابیس را برای تأیید بنویسید)
kc exec backend python manage.py restore_db /app/backups/kabulcargo-2026-10-27-0200.sql.gz --confirm kabulcargo

# ۴) اگر کد تازه‌تر از بک‌اپ است
kc exec backend python manage.py migrate
```

فایل‌های اسناد (عکس بارنامه و …) جدا از دیتابیس‌اند. اگر سرور کاملاً از بین رفت، آن‌ها را از کاپی
بیرونی برگردانید:

```bash
kc cp /var/backups/kabulcargo/media/. backend:/app/media/
```

### انتقال به سرور تازه
۱) روی سرور تازه بخش ۴ را تا قدم ۵ انجام دهید (همان `.env` قبلی، به‌خصوص `DB_PASSWORD` و
`SECRET_KEY`). ۲) بخش ۹ را برای دیتابیس و اسناد انجام دهید. ۳) رکورد DNS را به IP تازه بگذارید.

---

## ۱۰. آزمایش‌ها (برای برنامه‌نویس)

- همهٔ آزمایش‌ها روی کمپیوتر توسعه: `scripts\run_all_checks.ps1` (یا `scripts/run_all_checks.sh`).
- آزمایش کامل همین Docker روی کمپیوتر توسعه (هرگز روی سرور): `scripts\prod_local_test.ps1` — به
  Docker Desktop با WSL 2 نیاز دارد.
