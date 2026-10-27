# نصب کابل کارگو روی Coolify — قدم به قدم

این راهنما برای صاحب سیستم است: نصب **کابل کارگو** روی سرور Contabo که Coolify دارد و برنامهٔ
**Donya** هم روی آن کار می‌کند. هر کلیک نوشته شده. هیچ دستوری روی خود سرور (SSH) لازم نیست، جز
دو کار اختیاری که جدا علامت خورده‌اند.

| | |
| --- | --- |
| نشانی برنامه | `https://transit.kabulcargo.com` |
| IP سرور | `169.58.116.213` (رکورد A به نام `transit` در Spaceship از قبل درست است) |
| مخزن GitHub | `https://github.com/nasratamiry/kabul_transit` (خصوصی)، شاخهٔ `main` |
| پنل Coolify | `http://169.58.116.213:8000` |

## قانون‌های سرور مشترک (Donya را خراب نکنید)

- در **Settings** عمومی Coolify، دیوار آتش، SSH، Docker و بسته‌های سرور **هیچ چیز را عوض نکنید**.
- کابل کارگو **هیچ پورتی** روی سرور باز نمی‌کند. پورت ۸۰۰۰ مال پنل Coolify است و ۸۰/۴۴۳ مال پراکسی
  Coolify. فایل `docker-compose.yml` عمداً هیچ `ports:` ندارد؛ آن را اضافه نکنید.
- نام همهٔ سرویس‌ها، volumeها و شبکه با `kabulcargo_` شروع می‌شود. دیتابیس، Redis و volume خودش را
  دارد و با Donya هیچ چیز مشترک ندارد.
- هر سرویس محدودیت حافظه دارد (جمعاً حداکثر حدود ۱٫۶ GB)؛ اگر کابل کارگو زیاد مصرف کند، Docker
  همان سرویس را دوباره روشن می‌کند، نه Donya را.

---

## ۰. قبل از شروع: وضع Donya را یادداشت کنید

1. در Coolify پروژهٔ Donya را باز کنید. نام سرویس‌ها و وضعیت (Running/Healthy) را یادداشت کنید.
2. سایت Donya را در مرورگر باز کنید و مطمئن شوید کار می‌کند.
3. در Coolify: **Servers → (سرور) → Resources** یا صفحهٔ سرور، مقدار RAM کل و مصرف فعلی را ببینید.
   کابل کارگو حدود **۰٫۸ تا ۱٫۲ GB** در کار عادی و حداکثر **۱٫۶ GB** (سقف) لازم دارد. اگر RAM آزاد
   کمتر از ۲ GB است، اول بخش «حافظه» در `docs/GO_LIVE.md` را بخوانید.

## ۱. وصل کردن مخزن خصوصی GitHub

1. Coolify → **Sources** → **+ Add** → **GitHub App**.
2. یک نام بدهید، مثلاً `kabulcargo-github`، و **Continue** → **Register Now**.
3. GitHub باز می‌شود: نصب App را تأیید کنید. در صفحهٔ دسترسی **Only select repositories** را بزنید و
   فقط `kabul_transit` را انتخاب کنید (نه همهٔ مخزن‌ها) → **Install**.
4. به Coolify برمی‌گردید؛ Source باید سبز باشد.

## ۲. پروژه و منبع تازه

1. **Projects** → **+ Add** → نام: `Kabul Cargo` → **Continue**. محیط `production` را باز کنید.
2. **+ New** → **Private Repository (with GitHub App)** → `kabulcargo-github` → مخزن `kabul_transit`.
3. **Branch:** `main`. **Build Pack:** `Docker Compose`.
   **Base Directory:** `/`. **Docker Compose Location:** `/docker-compose.yml`. → **Continue**.
4. Coolify فایل compose را می‌خواند و چهار سرویس نشان می‌دهد: `kabulcargo_db`، `kabulcargo_redis`،
   `kabulcargo_backend`، `kabulcargo_web`.

## ۳. دامنه (فقط روی kabulcargo_web)

1. کنار سرویس **kabulcargo_web** → **Settings** (یا خانهٔ Domains همان سرویس).
2. در **Domains** بنویسید: `https://transit.kabulcargo.com` → **Save**.
3. برای سه سرویس دیگر **هیچ دامنه‌ای** ننویسید (باید خالی بمانند).
4. گواهی SSL (Let's Encrypt) را پراکسی Coolify بعد از اولین Deploy خودش می‌گیرد و تمدید می‌کند.

## ۴. متغیرهای تنظیمات (Environment Variables)

1. تب **Environment Variables** → **Developer view** (نمای متنی).
2. محتوای فایل `.env.production.example` (در مخزن) را کاپی کنید و این‌ها را پر کنید:

   | متغیر | چه بنویسید |
   | --- | --- |
   | `APP_DOMAIN` | `transit.kabulcargo.com` (بدون https و بدون `/`) |
   | `ADMIN_URL` | یک مسیر تصادفی مثل `kc-panel-7f3a91c2e4b0/` — هرگز `admin/` |
   | `SECRET_KEY` | ۶۴ حرف تصادفی |
   | `DB_PASSWORD` | ۳۲ حرف تصادفی |
   | `MYSQL_ROOT_PASSWORD` | ۳۲ حرف تصادفی دیگر (متفاوت) |
   | بقیه | همان پیش‌فرض‌های فایل را نگه دارید |

   ساختن مقدار تصادفی: روی کمپیوتر خودتان (در پوشهٔ پروژه):
   ```
   .venv\Scripts\python -c "import secrets; print(secrets.token_urlsafe(64))"
   .venv\Scripts\python -c "import secrets; print('kc-panel-' + secrets.token_hex(6) + '/')"
   ```
   یا در Coolify کنار هر متغیر دکمهٔ ساختن مقدار تصادفی (اگر نسخهٔ شما دارد).
3. **Save**. همین مقدارها را در یک مدیر رمز (مثلاً Bitwarden) هم نگه دارید: بدون `DB_PASSWORD`
   بک‌اپ‌ها بازیابی نمی‌شوند، و نشانی پنل Django همان `ADMIN_URL` است.
4. `KC_LOCAL_HTTP_TEST` را **هرگز** اضافه نکنید.

## ۵. حافظه، volumeها، health check

همه در خود `docker-compose.yml` تعریف شده‌اند؛ فقط بررسی کنید:

- **حافظه:** db ‏۶۴۰ MB، redis ‏۹۶ MB، backend ‏۷۶۸ MB، web ‏۱۲۸ MB.
- **Storages** (volumeها، Coolify اسمشان را با یک پیشوند خودش می‌سازد):
  `kabulcargo_mysql_data` (دیتابیس)، `kabulcargo_media` (فایل اسناد)، `kabulcargo_backups`
  (بک‌اپ‌ها)، `kabulcargo_logs`، `kabulcargo_static`. **هرگز** این‌ها را حذف نکنید؛ دیتابیس و
  اسناد در همین‌هاست.
- **Health check:** هر سرویس health check خودش را دارد. `kabulcargo_web` هر ۳۰ ثانیه کل مسیر
  nginx → Django → دیتابیس + Redis را با `/api/health/` آزمایش می‌کند. در Coolify تنظیم جداگانه‌ای
  لازم نیست.

## ۶. اولین Deploy و اولین اجرا

1. **Deploy** را بزنید. اولین ساخت ۵ تا ۱۵ دقیقه طول می‌کشد (ساخت برنامه، دانلود MySQL).
   **Logs** را باز نگه دارید. در پایان هر چهار سرویس باید **Running (healthy)** باشند.
2. `https://transit.kabulcargo.com` را باز کنید: صفحهٔ ورود کابل کارگو با قفل https.
3. **سوپر ادمین اول:** تب **Terminal** → سرویس `kabulcargo_backend` → **Connect** → بنویسید:
   ```
   python manage.py createsuperuser
   ```
   نام کاربری، ایمیل (اختیاری) و رمز **قوی** را خودتان وارد کنید (رمز روی صفحه دیده نمی‌شود).
4. در همان Terminal (اگر از قبل باشند، دست نمی‌خورند):
   ```
   python manage.py seed_statement_lines
   python manage.py seed_document_types
   ```
5. در مرورگر با سوپر ادمین وارد شوید و:
   1. **مدیریت → بندرها → بندر تازه:** اولین بندر (نام، کود کوتاه انگلیسی، شهر). پیام باید بگوید
      ۱۷۲ تنظیم فیلد ساخته شد (و جدول اسناد لازم هم خودکار ساخته می‌شود).
   2. **مدیریت → کاربران → کاربر تازه:** برای هر بندر یک «مدیر بندر». رمز را حضوری بدهید.
   3. **مدیریت → نرخ اسعار:** نرخ امروز دالر.
   4. **آزمایش:** یک معاملهٔ آزمایشی ثبت کنید، یک سند کوچک آپلود و دانلود کنید، گزارش عاید و خروجی
      Excel را باز کنید. بعد همان معامله را **حذف** کنید.
6. پنل Django: `https://transit.kabulcargo.com/<ADMIN_URL>` (فقط سوپر ادمین).

## ۷. بک‌اپ روزانه (Scheduled Task)

1. در منبع کابل کارگو → تب **Scheduled Tasks** → **+ Add**:
   - **Name:** `kabulcargo-daily-backup`
   - **Command:** `python manage.py backup_db`
   - **Container name:** `kabulcargo_backend`
   - **Frequency:** `30 21 * * *`
2. **Save**. ساعت این cron به وقت **Instance Timezone** خود Coolify است (Settings → General، فقط نگاه
   کنید و عوض نکنید). اگر UTC است، `30 21 * * *` یعنی **۰۲:۰۰ وقت کابل**. اگر منطقهٔ دیگری است،
   ساعت را طوری بگذارید که ۰۲:۰۰ کابل (UTC+4:30) شود.
3. آزمایش: کنار وظیفه **Execute Now** → در **Logs** آن باید «بک‌اپ ساخته شد» دیده شود.
4. بک‌اپ‌ها در volume `kabulcargo_backups` با نام `kabulcargo-YYYY-MM-DD-HHMM.sql.gz` می‌مانند و
   بعد از ۳۰ روز خودکار پاک می‌شوند (`BACKUP_KEEP_DAYS`).
5. **فهرست بک‌اپ‌ها:** Terminal → `kabulcargo_backend` → `ls -lh /app/backups`
6. **آزمایش بازیابی (ماهی یک بار):** Terminal → `kabulcargo_backend` →
   `python manage.py restore_db --drill` — بک‌اپ تازه را در یک دیتابیس جدا بار می‌کند و تعداد ردیف
   همهٔ جدول‌ها را مقایسه می‌کند؛ دیتابیس اصلی دست نمی‌خورد. آخرش باید «تمرین بازیابی موفق» باشد.

### دانلود یک بک‌اپ (کاپی بیرون از سرور)

بک‌اپی که فقط روی همان سرور است، با خراب شدن سرور از بین می‌رود. حداقل هفته‌ای یک بار یک کاپی
بیرون بگیرید. Coolify دکمهٔ دانلود فایل ندارد؛ از SSH (فقط خواندن، چیزی را در سرور عوض نمی‌کند):

```bash
# روی سرور:
C=$(docker ps -q --filter label=com.docker.compose.service=kabulcargo_backend | head -n1)
docker exec "$C" ls /app/backups
docker cp "$C":/app/backups/kabulcargo-2026-11-01-0200.sql.gz /root/
# روی کمپیوتر خودتان (PowerShell):
scp root@169.58.116.213:/root/kabulcargo-2026-11-01-0200.sql.gz .
```

فایل‌های اسناد (`/app/media`) را هم به همین شکل کاپی کنید. **اختیاری، کار خودکار:** فایل
`deploy/offsite-backup.sh` هر شب بک‌اپ و اسناد را با `rclone` به یک فضای بیرونی (Backblaze B2،
Google Drive …) می‌فرستد؛ این به یک cron روی خود سرور نیاز دارد (تغییر در سرور مشترک) — فقط اگر خودتان
تصمیم گرفتید (`docs/DEPLOY.md` بخش ۷).

### بازیابی (روز بد)

**هشدار:** دیتابیس فعلی با بک‌اپ عوض می‌شود؛ هر چیزی بعد از زمان بک‌اپ پاک می‌شود. سیستم قبلش
خودش یک بک‌اپ احتیاطی می‌گیرد. Terminal → `kabulcargo_backend`:

```
ls -lh /app/backups
python manage.py restore_db /app/backups/kabulcargo-2026-11-01-0200.sql.gz --confirm kabulcargo
python manage.py migrate
```

(اگر بک‌اپ از بیرون آمده، اول با `scp` به سرور و `docker cp` به `/app/backups/` بفرستید.)

## ۸. به‌روزرسانی (نسخهٔ تازه)

1. قبل از هر به‌روزرسانی: Scheduled Task بک‌اپ → **Execute Now** (یا Terminal: `python manage.py backup_db`).
2. کد تازه را به `main` در GitHub push کنید.
3. Coolify → منبع کابل کارگو → **Redeploy** (یا در **Advanced** گزینهٔ **Auto Deploy** را روشن کنید
   تا هر push خودکار نصب شود). مایگریشن‌های دیتابیس هنگام روشن شدن backend خودکار اجرا می‌شوند.
4. بعد از Deploy: هر چهار سرویس healthy، و `https://transit.kabulcargo.com/api/health/` باید
   `"status": "ok"` بدهد.

قطعی معمولاً کمتر از یک دقیقه است؛ بیرون از ساعت کاری انجام دهید.

## ۹. برگشت به نسخهٔ قبل (Rollback)

1. Coolify → منبع → تب **Deployments**: اگر کنار Deploy قبلی دکمهٔ **Rollback** هست، آن را بزنید.
2. اگر نیست: در **General** (یا **Source**) خانهٔ **Git Commit SHA** را به commit قبلی (از GitHub یا
   `git log`) بگذارید → **Save** → **Redeploy**. بعد از حل مشکل، آن خانه را دوباره خالی کنید
   (= آخرین commit شاخهٔ `main`).
3. اگر نسخهٔ خراب دیتابیس را تغییر داده بود (مایگریشن) و نسخهٔ قبلی درست کار نمی‌کند، دیتابیس را از
   بک‌اپ قدم ۸.۱ بازیابی کنید (بخش ۷).

## ۱۰. بررسی سلامت Donya (بعد از هر Deploy کابل کارگو)

1. سایت Donya را باز کنید: باید مثل قبل کار کند.
2. در پروژهٔ Donya همهٔ سرویس‌ها همان وضع قدم ۰ را داشته باشند (Running/Healthy، بدون restart تازه).
3. صفحهٔ سرور در Coolify: RAM آزاد باید هنوز حداقل چند صد MB باشد.
4. اگر Donya مشکل پیدا کرد: منبع کابل کارگو → **Stop**. این فقط کانتینرهای کابل کارگو را خاموش
   می‌کند (volumeها و داده‌ها می‌مانند).

## ۱۱. پیشنهاد برای بعد

- پنل Coolify را با یک دامنهٔ HTTPS خودش باز کنید (مثلاً `coolify.kabulcargo.com`، در
  **Settings → General → URL**)، بعد پورت عمومی ۸۰۰۰ را ببندید. الان پنل روی http بی‌رمزگذاری باز
  است. (این تغییر سراسری است؛ با دقت و در وقت آرام انجام شود، چون Donya هم از همین Coolify است.)
- یک مانیتور رایگان (مثلاً UptimeRobot) برای `https://transit.kabulcargo.com/api/health/`.

## ۱۲. ریدایرکت از سایت اصلی

سایت `kabulcargo.com` روی Spaceship (cPanel) است. برای اینکه `kabulcargo.com/kc_transit` به برنامه برود:

- **cPanel → Redirects:** Type = `Permanent (301)`، دامنه = `kabulcargo.com`، مسیر = `/kc_transit`،
  Redirects to = `https://transit.kabulcargo.com/` → **Add**.
- یا **cPanel → File Manager → public_html/.htaccess** (فایل‌های مخفی را نشان دهید) و این سطر را
  اضافه کنید:

  ```apache
  Redirect 301 /kc_transit https://transit.kabulcargo.com/
  ```

برنامه هرگز داخل سایت اصلی باز نمی‌شود؛ زیردامنهٔ خودش را دارد (برای امنیت ورود کاربران لازم است).
