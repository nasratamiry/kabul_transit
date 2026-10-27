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

---

# Stage 10 — super admin pages

Same stack as above. Needs a super_admin and a database with **no exchange rate for today**
(the red-banner checks).

```powershell
cd "D:\Kabul Cargo TN\frontend"
..\.venv\Scripts\python scripts\cleanup-stage10.py e2e_admin   # leftovers of an earlier run
$env:KC_ADMIN_USER='e2e_admin'; $env:KC_ADMIN_PASS='<pass>'
node scripts/verify-stage10.mjs ..\stage10_screenshots
..\.venv\Scripts\python scripts\cleanup-stage10.py e2e_admin   # remove what the run created
```

The run creates branches TESTKC / DELKC, users e2e_sa2 / e2e_mgr2 and a few rates, and
edits two statement lines; the cleanup script removes / restores all of it (including the
admin's own StatementLine history rows).

| #   | Check                                                                             |
| --- | --------------------------------------------------------------------------------- |
| 1   | Create branch «تست کرگو» TESTKC → in list, toast «… ۱۷۲ فیلد خودکار آماده شد»     |
| 2   | Edit branch name → persists                                                       |
| 3   | Code field disabled on edit (also via the `/admin/branches/:id/edit` deep link)   |
| 4   | Toggle is_active → list shows غیرفعال                                             |
| 5   | Delete branch with a user → 409 Dari toast; empty branch → deleted                |
| 6   | New branch has 172 FieldConfig rows (`/api/field-configs/?branch=`)               |
| 7   | Create super_admin user → branch field hidden, saved with branch null             |
| 8   | branch_manager without branch → «برای مدیر بندر، بندر لازم است»                   |
| 9   | branch_manager with branch → created; their sidebar has no «مدیریت», /admin → 403 |
| 10  | Edit without password keeps it; edit with password changes it                     |
| 11  | Reset-password dialog → new password logs in                                      |
| 12  | 5 wrong logins → «قفل» badge + unlock button → unlock → login works               |
| 13  | Deactivate user → login 401                                                       |
| 14  | No USD rate today → red banner + CTA; `R` opens the create drawer                 |
| 15  | CTA → drawer pre-filled today + USD → save → banner green («۷۰٫۵۰»)               |
| 16  | Future date → backend 400 → Dari error under the date                             |
| 17  | AFN not in the currency list; API POST with AFN → Dari 400                        |
| 18  | 8-decimal rate 0.00028571 stored and shown as ۰٫۰۰۰۲۸۵۷۱                          |
| 19  | Rate typed as «۰٫۰۰۰۲۸» → 0.00028 on blur → stored 0.00028000                     |
| 20  | Shamsi date-range filter (typed in Dari digits)                                   |
| 21  | Delete rate → confirm → removed                                                   |
| 22  | Statement lines grouped in 4 sections, 17 default lines                           |
| 23  | Inline edit of label_fa saves on blur                                             |
| 24  | Section REVENUE with another source → Dari error (form) and 400 (API)             |
| 25  | is_active off → row greyed, income statement warns about the source               |
| 26  | History modal shows the inline edit with user and Shamsi + Gregorian date         |
| 32  | Dashboard: super_admin sees rate card + 4 tiles; branch_manager sees none         |

Accessibility: Lighthouse (accessibility category, desktop) on each admin page and the
dashboard should score ≥ 90.

---

# Stage 11 — partners (traders, transport companies)

```powershell
cd "D:\Kabul Cargo TN\frontend"
..\.venv\Scripts\python scripts\cleanup-stage11.py --setup   # e2e_admin, e2e_mgr, e2e_mgr_b + 2 branches
node scripts/verify-stage11.mjs ..\stage11_screenshots
..\.venv\Scripts\python scripts\cleanup-stage11.py           # removes everything the run made
```

| #   | Check                                                                   |
| --- | ----------------------------------------------------------------------- |
| 1   | `/partners/traders` renders with Dari headers                           |
| 2   | Create «تاجر آزمایشی ۱» → in list + toast                               |
| 3   | Edit name → persists                                                    |
| 4   | Search by part of the name                                              |
| 5   | «فقط فعال» / «فقط غیرفعال» filter (kept in the URL)                     |
| 6   | Deactivate → row greyed, badge غیرفعال                                  |
| 7   | Same trader name twice → allowed (no unique constraint on Trader.name)  |
| 8   | Phone «۰۷۰۱۲۳۴۵۶۷» → stored 0701234567                                  |
| 9   | Delete a trader without transactions                                    |
| 10  | Delete a trader with a transaction → 409 Dari toast, row stays          |
| S   | Sort by «تاریخ ثبت» header (asc / desc, aria-sort)                      |
| 12  | Transport companies: create, edit, duplicate name → Dari 400, delete    |
| 13  | branch_manager: «شرکا» in sidebar, both pages open, no «مدیریت»         |
| 14  | branch_manager creates a trader → super_admin and another branch see it |
| 15  | branch_manager edits a trader the super_admin created                   |
| 16  | branch_manager on `/admin/users` → 403 page                             |
| 17  | Dashboard tiles: active traders / transport companies match the API     |
| 18  | No uncaught page errors (both roles)                                    |
| 19  | `/partners/traders?is_active=true` deep link applies the filter         |
| 20  | Mobile: table scrolls sideways, first column sticky                     |

Check 11 (history modal) is not part of this stage: the API has no history endpoint for
partners. Lighthouse accessibility on both partner pages should be ≥ 95.

---

# Stage 12a — transactions list + dynamic form

```powershell
cd "D:\Kabul Cargo TN\frontend"
..\.venv\Scripts\python scripts\cleanup-stage12a.py --setup   # users, branches E2E12A/E2E12B, traders, USD rate
node scripts/verify-stage12a.mjs ..\stage12a_screenshots
..\.venv\Scripts\python scripts\cleanup-stage12a.py           # also removes the history rows of the test data
```

Before starting the dev servers, make sure nothing is still listening on 8000 / 5173: on
Windows a stopped `npm run dev` can leave vite running, and two servers can share a port
(the old one then answers with old code). Start vite as `node node_modules/vite/bin/vite.js`.

| #   | Check                                                                            |
| --- | -------------------------------------------------------------------------------- |
| 1   | `/transactions` empty state                                                      |
| 2   | API-created rows of this month listed (default window = current Shamsi month)    |
| 2b  | Profit green, loss red                                                           |
| 3   | Shamsi date range typed in Dari digits                                           |
| 4–8 | Trade type, trader (SearchSelect), serial search, branch filters; clear filters  |
| 9   | Pagination (25 per page), `page=2` in the URL                                    |
| 10  | Row click → `/transactions/:id/edit`                                             |
| 11  | branch_manager: own branch only, no branch filter                                |
| 12  | No USD rate today → «معاملهٔ تازه» disabled with hint                            |
| 13  | `/transactions/new`: 4 trade-type cards + branch context                         |
| 14  | EXPORT form renders                                                              |
| 15  | 7 sections; required fields marked                                               |
| 16  | FieldConfig-hidden fields not rendered (truck_type hidden for E2E12A/EXPORT)     |
| 17  | Live preview: 10 000 − 2 000 (عواید ترانسپورت is an expense) − 3 000 = +5 000 ؋  |
| 18  | Missing required fields → inline errors, no request                              |
| 19  | Save → 201, toast with serial, list of that day with the row highlighted         |
| 20  | Dari digits in money fields normalized on blur                                   |
| 21  | Currency USD → exchange_rate shown and required                                  |
| 22  | exchange_rate pre-filled from the day’s rate; USD preview                        |
| A   | «Add new trader» from the form → back with the new trader selected, form kept    |
| 23  | Rate deleted → submit → 428 → full-page notice with CTA                          |
| 24  | Enter the rate, come back → form restored from sessionStorage → saves            |
| 25  | Edit form pre-filled                                                             |
| 26  | Edit → PATCH → toast → list updated                                              |
| 27  | branch_manager opens another branch’s transaction → not-available page (API 404) |
| 28  | super_admin picker: branch first                                                 |
| 29  | super_admin: chosen branch saved                                                 |
| 30  | preview-summary math (API)                                                       |
| 31  | preview-summary for another branch → 403                                         |
| E   | No uncaught page errors                                                          |

---

# Stage 12b — detail page, documents, USD equivalent, branch-manager rate

```powershell
cd "D:\Kabul Cargo TN\frontend"
..\.venv\Scripts\python scripts\cleanup-stage12b.py --setup   # branches E2E12BA/E2E12BB, USD 60 (10 days ago) + 70 (today)
node scripts/verify-stage12b.mjs ..\stage12b_screenshots     # also writes 02-print.pdf (A4)
..\.venv\Scripts\python scripts\cleanup-stage12b.py           # rows, uploaded files on disk, history
```

| #   | Check                                                                                   |
| --- | --------------------------------------------------------------------------------------- |
| 1   | AFN transaction: USD at its own date’s USD rate (60), not today’s (70)                  |
| 2   | List shows the USD profit of an AFN row                                                 |
| 3   | Row click → detail: serial, trade badge, branch, dual date, status                      |
| 4   | Money table: each line in AFN + USD; profit green/red                                   |
| 5   | Read-only sections mirror the form                                                      |
| 6   | Print view: A4 PDF, no topbar / sidebar / buttons, letterhead + signature lines         |
| 7   | Upload a PDF and a PNG at once; listed with thumbnail                                   |
| 8   | Client refuses 11 MB and an .exe renamed .jpg (no request sent)                         |
| 9   | Server refuses the same files with its Dari message                                     |
| 10  | No raw /media/ URL in the API; download works with the token, 401 without               |
| 11  | Image opens in a lightbox, PDF in a new tab (blob)                                      |
| 12  | Another branch’s manager: no documents listed, download 404, detail not available       |
| 13  | «فقط دارای سند» filter (URL) and the document-count link to `#documents`                |
| 14  | Delete a document (confirm)                                                             |
| 15  | History timeline shows an edit (field, old → new, user, dual date)                      |
| 16  | Branch manager: past-date rate / edit / delete → 403                                    |
| 17  | No rate today → manager sees «ثبت نرخ امروز» on the list and the dashboard              |
| 18  | 428 → manager enters today’s rate in the dialog → the blocked save is retried, succeeds |
| 19  | Dashboard banner turns green                                                            |
| 20  | Delete a transaction from its detail page (own branch); other branch → 404              |
| E   | No uncaught page errors                                                                 |

---

# Stage 13 — finance pages (hawala, office expenses)

```powershell
cd "D:\Kabul Cargo TN\frontend"
..\.venv\Scripts\python scripts\cleanup-stage13.py --setup   # e2e_admin, e2e_mgr, e2e_mgr_b, E2E13A/B, USD 80 + PKR 0.25 ten days ago, USD 70 today
node scripts/verify-stage13.mjs ..\stage13_screenshots
..\.venv\Scripts\python scripts\cleanup-stage13.py           # removes records, rates and their history
```

25 checks: sidebar «مالی» for both roles; hawala and office-expense create / edit / delete with
Dari digits («۱٬۲۵۰٫۷۵»); the form shows the day's rate; the snapshot rate survives a later rate
change; history modal; category summary strip (salary separate) and totals footer equal the API
totals; category and date-range filters in the URL; branch scoping (list, direct id → 404,
foreign branch id → saved to own branch); super admin branch column and filter; page totals equal
the income statement's OPEX_OFFICE / OPEX_SALARY / OPEX_HAWALA_FEE; 428 on create and the
form's enter-today's-rate-then-retry flow; dashboard tile «مصارف دفتر این ماه» for both roles.

Each user may make 100 API requests a minute (stage 7 throttle); the script stays under it.
