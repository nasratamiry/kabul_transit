# Stage 9 — verification checklist

Run against the **live** stack. Everything below was run for Stage 9 (results in `STAGE_9_COMPLETE.md`).

## 1. Start the stack (two terminals)

```powershell
cd "D:\Kabul Cargo TN"
.venv\Scripts\python manage.py runserver 127.0.0.1:8000
```

```powershell
cd "D:\Kabul Cargo TN\frontend"
npm run dev        # http://localhost:5173 — /api and /media are proxied to :8000
```

## 2. Test users

You need one `super_admin` and one `branch_manager` that has a branch. Create them in the
admin panel, or temporarily from the shell (delete them afterwards):

```powershell
.venv\Scripts\python manage.py shell -c "from accounts.models import User, Branch; b=Branch.objects.create(name='بندر آزمایشی', code='E2E'); User.objects.create_user(username='e2e_admin', password='<pass>', role='super_admin'); User.objects.create_user(username='e2e_manager', password='<pass>', role='branch_manager', branch=b)"
```

## 3. Browser checklist (automated)

`scripts/verify-e2e.mjs` drives the system Edge (or Chrome via `KC_BROWSER`) with
`playwright-core` — no browser download — and saves screenshots.

```powershell
cd "D:\Kabul Cargo TN\frontend"
$env:KC_ADMIN_USER='e2e_admin';   $env:KC_ADMIN_PASS='<pass>'
$env:KC_MANAGER_USER='e2e_manager'; $env:KC_MANAGER_PASS='<pass>'
$today = ..\.venv\Scripts\python ..\manage.py shell -c "from finance.utils import kabul_today; print(kabul_today())"
npm run verify:e2e -- ..\stage9_screenshots $today
```

| #   | Check                                                                       |
| --- | --------------------------------------------------------------------------- |
| 1   | `http://localhost:5173/` redirects to `/login`                              |
| 2   | Login page renders in Dari with RTL layout                                  |
| 3   | super_admin login → `/dashboard` (and back to the URL they first opened)    |
| 4   | Dashboard shows user name, role badge, branch, today's dual date            |
| 5   | `/api/auth/me/` returns 200 (badge is green)                                |
| 6   | English → LTR, Inter font, English translations                             |
| 7   | Pashto → RTL, Vazirmatn                                                     |
| 8   | Reload → still logged in (localStorage)                                     |
| 9   | Logout → back to `/login`, tokens removed                                   |
| 10  | Wrong password ×5 → lock / "تلاش‌های زیاد" message                          |
| 11  | branch_manager → sidebar hides "مدیریت", shows own branch, orange badge     |
| 12  | Dark mode toggle switches theme and persists after reload                   |
| 13  | Shamsi date on the dashboard equals backend `kabul_today()`                 |
| +   | Expired access token → one `/auth/refresh/` → request retried               |
| +   | 4 parallel 401s → exactly one refresh call (single-flight)                  |
| +   | digits / date / money helpers; numeric `<Input>` turns ۱۲۵ into 125 on blur |
| +   | Unknown URL → 404 page; mobile sidebar is off-canvas; no console errors     |

Check 10 runs last on purpose: after it, axes has locked the test username **and this IP**
for 15 minutes. Unlock with `.venv\Scripts\python manage.py axes_reset`.

## 4. Static checks

```powershell
npm run build        # must finish with no warnings
npm run lint         # 0 errors, 0 warnings (--max-warnings 0)
npx tsc --noEmit     # 0 errors
```

## 5. Clean up

Delete the test users and test branch (admin panel, or the shell), then `axes_reset`.
