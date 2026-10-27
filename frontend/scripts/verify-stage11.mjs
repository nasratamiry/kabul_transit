/**
 * Stage 11 live check: partner pages (traders, transport companies) for both roles, against
 * the real stack (Django :8000 + Vite :5173). See VERIFY.md.
 *   ..\.venv\Scripts\python scripts\cleanup-stage11.py --setup
 *   node scripts/verify-stage11.mjs <screenshot-dir>
 *   ..\.venv\Scripts\python scripts\cleanup-stage11.py
 * Env: KC_PASS (default: the password cleanup-stage11.py sets), KC_BROWSER (Edge/Chrome exe).
 */
import fs from 'node:fs';

import { chromium } from 'playwright-core';

const BASE = process.env.KC_BASE_URL ?? 'http://localhost:5173';
const SHOTS = process.argv[2] ?? 'stage11-screenshots';
const PASS = process.env.KC_PASS ?? 'E2e-Stage11-Pass-2026';
const BROWSER =
  process.env.KC_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
fs.mkdirSync(SHOTS, { recursive: true });

const T1 = 'تاجر آزمایشی ۱';
const T2 = 'تاجر آزمایشی ۲';
const TM = 'تاجر آزمایشی مدیر';
const C1 = 'شرکت آزمایشی الف';

const results = [];
function check(id, name, ok, info = '') {
  results.push({ id, name, ok: Boolean(ok), info: String(info).slice(0, 300) });
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${id}. ${name}${info ? '  — ' + String(info).slice(0, 200) : ''}`,
  );
}
async function step(id, name, fn) {
  try {
    await fn();
  } catch (err) {
    check(id, name, false, `threw: ${err.message.split('\n')[0]}`);
  }
}

const browser = await chromium.launch({ executablePath: BROWSER });
const errors = [];
async function session(username) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${username}: ${e}`));
  await page.goto(`${BASE}/login`);
  await page.fill('#username', username);
  await page.fill('#password', PASS);
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard');
  return page;
}

/** API call as the page's user, without UI toasts. */
const api = (page, method, url, body) =>
  page.evaluate(
    async ({ method, url, body }) => {
      const r = await fetch(`/api${url}`, {
        method,
        headers: {
          Authorization: `Bearer ${localStorage.getItem('kc.access')}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await r.text();
      let data = text;
      try {
        data = JSON.parse(text);
      } catch {
        /* not JSON */
      }
      return { status: r.status, data };
    },
    { method, url, body },
  );

const admin = await session('e2e_admin');
const page = admin;
const toast = (p, text) => p.locator('div[role=status]', { hasText: text }).first();
const row = (p, text) => p.locator('tbody tr', { hasText: text }).first();
const bodyRows = (p) => p.locator('tbody tr:not([data-testid=skeleton-row])');
const submit = (p) => p.click('[data-testid=drawer-submit]');

async function createPartner(p, fields) {
  await p.click('[data-testid=add-partner]');
  for (const [name, value] of Object.entries(fields)) {
    await p.fill(`[role=dialog] [name=${name}]`, value);
  }
  await p.locator('[role=dialog] [name=name]').focus(); // blur the last field (normalizes digits)
  await submit(p);
}

async function waitRows(p, predicate, timeout = 5000) {
  const until = Date.now() + timeout;
  let texts = [];
  while (Date.now() < until) {
    texts = await bodyRows(p).allTextContents();
    if (predicate(texts)) return texts;
    await p.waitForTimeout(200);
  }
  return texts;
}

// =============================== Traders ===============================
await step(1, 'super_admin opens /partners/traders → Dari headers', async () => {
  await page.goto(`${BASE}/partners/traders`);
  await page.waitForSelector('th');
  const headers = (await page.locator('thead th').allTextContents()).join(' | ');
  check(
    1,
    'super_admin opens /partners/traders → Dari headers',
    headers.includes('نام تاجر / مشتری') &&
      headers.includes('تاریخ ثبت') &&
      (await page.locator('h1').textContent()) === 'تاجران',
    headers,
  );
});

let t1 = null;
await step(2, 'Create trader «تاجر آزمایشی ۱» → in list + toast', async () => {
  await createPartner(page, {
    name: T1,
    phone: '۰۷۰۱۲۳۴۵۶۷',
    address: 'کابل، شهر نو، سرک اول، کوچهٔ دوم',
  });
  await toast(page, `«${T1}» اضافه شد`).waitFor({ timeout: 10000 });
  await row(page, T1).waitFor();
  t1 = (await api(page, 'GET', `/traders/?search=${encodeURIComponent(T1)}`)).data[0];
  check(2, 'Create trader «تاجر آزمایشی ۱» → in list + toast', Boolean(t1));
  check(8, 'Phone «۰۷۰۱۲۳۴۵۶۷» → stored «0701234567»', t1?.phone === '0701234567', t1?.phone);
  await page.screenshot({ path: `${SHOTS}/01-traders-list.png` });
});

const T1E = `${T1} (ویرایش)`;
await step(3, 'Edit trader name → persists', async () => {
  await row(page, T1).click();
  await page.waitForURL(/\/partners\/traders\/\d+\/edit/);
  await page.screenshot({ path: `${SHOTS}/02-trader-drawer.png` });
  await page.fill('[role=dialog] [name=name]', T1E);
  await submit(page);
  await toast(page, 'ذخیره شد').waitFor({ timeout: 10000 });
  const t = (await api(page, 'GET', `/traders/${t1.id}/`)).data;
  check(3, 'Edit trader name → persists', t.name === T1E, t.name);
});

await step(4, 'Search by partial name filters', async () => {
  await createPartner(page, { name: T2 });
  await toast(page, `«${T2}» اضافه شد`).waitFor({ timeout: 10000 });
  await page.fill('[data-testid=partner-search]', 'ویرایش');
  const texts = await waitRows(page, (r) => r.length === 1);
  await page.fill('[data-testid=partner-search]', '');
  await waitRows(page, (r) => r.length === 2);
  check(
    4,
    'Search by partial name filters',
    texts.length === 1 && texts[0].includes(T1E),
    `${texts.length} rows`,
  );
});

await step(6, 'Deactivate → row greys out', async () => {
  await row(page, T2).locator('[data-testid=deactivate]').click();
  await page.click('[data-testid=confirm-ok]');
  await toast(page, 'غیرفعال شد').waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  const cls = await row(page, T2).getAttribute('class');
  check(
    6,
    'Deactivate → row greys out',
    cls.includes('text-gray-500') && (await row(page, T2).textContent()).includes('غیرفعال'),
  );
});

await step(5, 'Filter «فقط فعال» / «فقط غیرفعال»', async () => {
  await page.selectOption('[data-testid=active-filter]', 'true');
  const act = await waitRows(page, (r) => r.length === 1);
  const url = page.url();
  await page.selectOption('[data-testid=active-filter]', 'false');
  const inact = await waitRows(page, (r) => r.length === 1 && r[0].includes(T2));
  await page.selectOption('[data-testid=active-filter]', '');
  check(
    5,
    'Filter «فقط فعال» / «فقط غیرفعال»',
    act.length === 1 &&
      act[0].includes(T1E) &&
      inact[0]?.includes(T2) &&
      url.includes('is_active=true'),
    `active=${act.length}, inactive=${inact.length}, url=${url}`,
  );
});

await step(7, 'Trader name not unique → duplicate allowed (backend has no unique)', async () => {
  const r = await api(page, 'POST', '/traders/', { name: T2 });
  check(
    7,
    'Trader name not unique → duplicate allowed (backend has no unique)',
    r.status === 201,
    `status=${r.status}`,
  );
  await page.reload();
  await waitRows(page, (rows) => rows.filter((t) => t.includes(T2)).length === 2);
});

await step(9, 'Delete empty trader → removed', async () => {
  const before = await bodyRows(page).count();
  await page
    .locator('tbody tr', { hasText: T2 })
    .last()
    .getByRole('button', { name: 'حذف' })
    .click();
  await page.click('[data-testid=confirm-ok]');
  await toast(page, 'حذف شد').waitFor({ timeout: 10000 });
  const after = await waitRows(page, (r) => r.length === before - 1);
  check(
    9,
    'Delete empty trader → removed',
    after.length === before - 1,
    `${before} → ${after.length}`,
  );
});

await step(10, 'Delete trader with a transaction → 409 Dari toast', async () => {
  // A transaction needs today's USD rate (428 soft lock); add it only if missing.
  const today = await page.evaluate(async () => (await import('/src/lib/date.ts')).todayShamsi());
  const rates = await api(page, 'GET', `/exchange-rates/?currency=USD&date=${today}`);
  if (!rates.data.length)
    await api(page, 'POST', '/exchange-rates/', { date: today, currency: 'USD', rate: '70' });
  const mgr = await session('e2e_mgr');
  // The API requires `branch` even from a branch manager (it then forces their own branch).
  const me = await api(mgr, 'GET', '/auth/me/');
  const tx = await api(mgr, 'POST', '/transactions/', {
    branch: me.data.branch.id,
    trade_type: 'EXPORT',
    serial_number: 'E2E11-1',
    trader: t1.id,
  });
  await mgr.context().close();
  await row(page, T1E).getByRole('button', { name: 'حذف' }).click();
  await page.click('[data-testid=confirm-ok]');
  const err = toast(page, 'حذف ممکن نیست');
  await err.waitFor({ timeout: 10000 });
  const text = await err.textContent();
  check(
    10,
    'Delete trader with a transaction → 409 Dari toast',
    tx.status === 201 && (await row(page, T1E).isVisible()) && text.includes('معاملات'),
    `tx=${tx.status}, toast=${text}`,
  );
  await page.screenshot({ path: `${SHOTS}/03-trader-delete-409.png` });
});

await step('S', 'Sort by created_at (header button) reverses order', async () => {
  await page.click('[data-testid=sort-created_at]');
  const asc = await bodyRows(page).allTextContents();
  await page.click('[data-testid=sort-created_at]');
  const desc = await bodyRows(page).allTextContents();
  const aria = await page.locator('th[aria-sort=descending]').count();
  check(
    'S',
    'Sort by created_at (header button) reverses order',
    asc.length > 1 && asc[0] === desc.at(-1) && aria === 1,
  );
  await page.click('[data-testid=sort-name]');
});

// =========================== Transport companies ===========================
await step(12, 'Transport companies: create, edit, unique name 400, delete', async () => {
  await page.goto(`${BASE}/partners/transport-companies`);
  await createPartner(page, { name: C1, phone: '+۹۲ ۳۰۰ ۱۲۳۴۵۶۷', country: 'پاکستان' });
  await toast(page, `«${C1}» اضافه شد`).waitFor({ timeout: 10000 });
  const c = (await api(page, 'GET', `/transport-companies/?search=${encodeURIComponent(C1)}`))
    .data[0];
  await row(page, C1).click();
  await page.fill('[role=dialog] [name=country]', 'ایران');
  await submit(page);
  await toast(page, 'ذخیره شد').waitFor({ timeout: 10000 });
  const edited = (await api(page, 'GET', `/transport-companies/${c.id}/`)).data;
  await createPartner(page, { name: C1 });
  const dupError = page.locator('[role=dialog] [role=alert]').first();
  await dupError.waitFor({ timeout: 10000 });
  const dupText = await dupError.textContent();
  await page.keyboard.press('Escape');
  await row(page, C1).getByRole('button', { name: 'حذف' }).click();
  await page.click('[data-testid=confirm-ok]');
  await toast(page, 'حذف شد').waitFor({ timeout: 10000 });
  const gone =
    (await api(page, 'GET', `/transport-companies/?search=${encodeURIComponent(C1)}`)).data
      .length === 0;
  check(
    12,
    'Transport companies: create, edit, unique name 400, delete',
    c?.phone === '+92 300 1234567' &&
      edited.country === 'ایران' &&
      /[\u0600-\u06FF]/.test(dupText) &&
      gone,
    `phone=${c?.phone}, country=${edited.country}, dup=${dupText}, gone=${gone}`,
  );
  await page.screenshot({ path: `${SHOTS}/04-transport-companies.png` });
});

// ================================ Roles ================================
let tm = null;
await step(13, 'branch_manager sees «شرکا», both pages open, no «مدیریت»', async () => {
  const mgr = await session('e2e_mgr');
  await mgr
    .locator('[data-testid=nav-partners]')
    .waitFor({ timeout: 10000 })
    .catch(() => {});
  const partnersNav = await mgr.locator('[data-testid=nav-partners]').isVisible();
  const adminNav = await mgr.locator('[data-testid=nav-admin]').count();
  await mgr.click('[data-testid=nav-partners] >> text=تاجران');
  await mgr.waitForURL('**/partners/traders');
  await mgr.waitForSelector('[data-testid=add-partner]');
  await mgr.goto(`${BASE}/partners/transport-companies`);
  // Wait for the page itself (React Router 7 renders the route after the load event).
  await mgr
    .locator('h1', { hasText: 'شرکت‌های ترانسپورت' })
    .waitFor({ timeout: 10000 })
    .catch(() => {});
  const h1 = await mgr.locator('h1').textContent();
  check(
    13,
    'branch_manager sees «شرکا», both pages open, no «مدیریت»',
    partnersNav && adminNav === 0 && h1 === 'شرکت‌های ترانسپورت',
    `partnersNav=${partnersNav} adminNav=${adminNav} h1=${h1}`,
  );
  await mgr.goto(`${BASE}/partners/traders`);
  await mgr.screenshot({ path: `${SHOTS}/05-traders-branch-manager.png` });

  // 14: manager creates → super_admin and the other branch's manager see it
  await createPartner(mgr, { name: TM, phone: '0799000111' });
  await toast(mgr, `«${TM}» اضافه شد`).waitFor({ timeout: 10000 });
  const seenAdmin = (await api(page, 'GET', `/traders/?search=${encodeURIComponent(TM)}`)).data;
  const other = await session('e2e_mgr_b');
  await other.goto(`${BASE}/partners/traders`);
  const seenOther = await row(other, TM)
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  await other.context().close();
  tm = seenAdmin[0];
  check(
    14,
    'branch_manager creates trader → super_admin and other branch see it',
    seenAdmin.length === 1 && seenOther,
  );

  // 15: manager edits a trader the super admin created
  await row(mgr, T1E).click();
  await mgr.fill('[role=dialog] [name=company_name]', 'شرکت تجارتی آزمون');
  await submit(mgr);
  await toast(mgr, 'ذخیره شد').waitFor({ timeout: 10000 });
  const t = (await api(page, 'GET', `/traders/${t1.id}/`)).data;
  check(
    15,
    'branch_manager edits a trader created by super_admin',
    t.company_name === 'شرکت تجارتی آزمون',
    t.company_name,
  );

  // 16: no regression of the stage-10 guard
  await mgr.goto(`${BASE}/admin/users`);
  const forbidden = await mgr.getByText('دسترسی ندارید').isVisible();
  check(16, 'branch_manager on /admin/users → 403 page', forbidden);
  await mgr.context().close();
});

// =============================== Shared ===============================
await step(17, 'Dashboard tiles show active counts', async () => {
  await page.goto(`${BASE}/dashboard`);
  await page.waitForSelector('[data-testid=tile-traders-value]');
  const tile = await page.textContent('[data-testid=tile-traders-value]');
  const companies = await page.textContent('[data-testid=tile-companies-value]');
  const active = (await api(page, 'GET', '/traders/?is_active=true')).data.length;
  const toDari = (n) => String(n).replace(/\d/g, (d) => String.fromCharCode(0x06f0 + Number(d)));
  check(
    17,
    'Dashboard tiles show active counts',
    tile === toDari(active) && companies === toDari(0),
    `traders tile=${tile} (api ${active}), companies=${companies}`,
  );
  await page.screenshot({ path: `${SHOTS}/06-dashboard-tiles.png` });
  await page.click('[data-testid=tile-traders]');
  await page.waitForURL('**/partners/traders?is_active=true');
});

await step(19, 'Deep link ?is_active=true applies the filter on load', async () => {
  await page.goto(`${BASE}/partners/traders?is_active=true`);
  const texts = await waitRows(page, (r) => r.length >= 1 && !r.some((t) => t.includes('غیرفعال')));
  const value = await page.inputValue('[data-testid=active-filter]');
  const active = (await api(page, 'GET', '/traders/?is_active=true')).data.length;
  check(
    19,
    'Deep link ?is_active=true applies the filter on load',
    value === 'true' && texts.every((t) => !t.includes('غیرفعال')) && texts.length === active,
    `select=${value}, rows=${texts.length}, api active=${active}`,
  );
});

await step(20, 'Mobile: horizontal scroll + sticky first column', async () => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${BASE}/partners/traders`);
  // A real data row, not one of the loading skeleton rows.
  await page.waitForSelector('tbody tr[tabindex] td');
  const info = await page.evaluate(() => {
    const box = document.querySelector('table').parentElement;
    const td = document.querySelector('tbody tr[tabindex] td');
    return { scroll: box.scrollWidth > box.clientWidth, sticky: getComputedStyle(td).position };
  });
  await page.screenshot({ path: `${SHOTS}/07-mobile.png` });
  await page.setViewportSize({ width: 1366, height: 860 });
  check(
    20,
    'Mobile: horizontal scroll + sticky first column',
    info.scroll && info.sticky === 'sticky',
    JSON.stringify(info),
  );
});

// Check 11 (history modal) is not run: the API has no history endpoint for partners.
check(18, 'No uncaught page errors (both roles)', errors.length === 0, errors.join(' | '));
await browser.close();
fs.writeFileSync(`${SHOTS}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
