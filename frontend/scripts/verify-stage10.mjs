/**
 * Stage 10 live check: the four super-admin pages against the real stack (Django :8000 +
 * Vite :5173). See VERIFY.md.
 *   node scripts/verify-stage10.mjs <screenshot-dir>
 * Env: KC_ADMIN_USER / KC_ADMIN_PASS (a super_admin), KC_BROWSER (Edge/Chrome exe).
 * Creates branches TESTKC / DELKC, users e2e_sa2 / e2e_mgr2 and a few rates; edits two
 * statement lines and restores them. Run scripts/cleanup-stage10.py afterwards.
 * Needs a database with no exchange rate for today (the red-banner checks).
 */
import fs from 'node:fs';

import { chromium } from 'playwright-core';

const BASE = process.env.KC_BASE_URL ?? 'http://localhost:5173';
const API = process.env.KC_API_URL ?? 'http://127.0.0.1:8000/api';
const SHOTS = process.argv[2] ?? 'stage10-screenshots';
const ADMIN = [process.env.KC_ADMIN_USER, process.env.KC_ADMIN_PASS];
const BROWSER =
  process.env.KC_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
if (!ADMIN.every(Boolean)) {
  console.error('Set KC_ADMIN_USER and KC_ADMIN_PASS (see VERIFY.md)');
  process.exit(2);
}
fs.mkdirSync(SHOTS, { recursive: true });

const MGR = 'e2e_mgr2';
const PASS = {
  mgr: 'Kc-Manager-Pass-2026!',
  changed: 'Kc-Changed-Pass-2026!',
  reset: 'Kc-Reset-Pass-2026!',
};
const toDari = (s) => String(s).replace(/[0-9]/g, (d) => String.fromCharCode(0x06f0 + Number(d)));
const DARI = /[\u0600-\u06FF]/;

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

async function httpLogin(username, password) {
  const r = await fetch(`${API}/auth/login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return r.status;
}

const browser = await chromium.launch({ executablePath: BROWSER });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));

/** API call with the logged-in user's token, without the UI's toasts. */
const api = (method, url, body) =>
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
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { status: r.status, data };
    },
    { method, url, body },
  );

const dialog = () => page.locator('[role=dialog]').last();
const toast = (text) => page.locator('div[role=status]', { hasText: text }).first();
const row = (text) => page.locator('tbody tr', { hasText: text }).first();
const submit = () => page.click('[data-testid=drawer-submit]');
const confirmOk = () => page.click('[data-testid=confirm-ok]');
const shamsiShift = (days) =>
  page.evaluate(async (n) => {
    const m = await import('/src/lib/date.ts');
    return m.shiftShamsi(m.todayShamsi(), n, 'day');
  }, days);

async function login(p, user, pass) {
  await p.goto(`${BASE}/login`);
  await p.fill('#username', user);
  await p.fill('#password', pass);
  await p.click('button[type=submit]');
  await p.waitForURL('**/dashboard');
}

await login(page, ...ADMIN);
let branchId = null;

// ============================== Branches ==============================
await step(1, 'Create branch «تست کرگو» TESTKC → in list + toast with 172 fields', async () => {
  await page.goto(`${BASE}/admin/branches`);
  await page.click('[data-testid=add-branch]');
  await page.waitForURL('**/admin/branches/new');
  await page.fill('input[name=name]', 'تست کرگو');
  await page.fill('input[name=code]', 'testkc');
  await page.fill('input[name=city]', 'کابل');
  await page.fill('input[name=phone]', '۰۷۹۹ ۱۲۳ ۴۵۶');
  await submit();
  await toast('تست کرگو').waitFor({ timeout: 10000 });
  const text = await toast('تست کرگو').textContent();
  await page.waitForURL(/\/admin\/branches$/);
  await row('TESTKC').waitFor();
  const found = await api('GET', '/branches/?search=TESTKC');
  branchId = found.data[0]?.id;
  check(
    1,
    'Create branch «تست کرگو» TESTKC → in list + toast with 172 fields',
    text.includes('۱۷۲') && branchId && found.data[0].code === 'TESTKC',
    text,
  );
  await page.screenshot({ path: `${SHOTS}/01-branches-list.png` });
});

await step(6, 'New branch has 172 FieldConfig rows (signal)', async () => {
  const fc = await api('GET', `/field-configs/?branch=${branchId}`);
  check(
    6,
    'New branch has 172 FieldConfig rows (signal)',
    fc.status === 200 && fc.data.length === 172,
    `rows=${fc.data.length}`,
  );
});

await step(2, 'Edit branch name → persists', async () => {
  await row('TESTKC').click();
  await page.waitForURL(/\/admin\/branches\/\d+\/edit$/);
  await page.fill('input[name=name]', 'تست کرگو ۲');
  await submit();
  await page.waitForURL(/\/admin\/branches$/);
  await row('تست کرگو ۲').waitFor();
  const b = await api('GET', `/branches/${branchId}/`);
  check(2, 'Edit branch name → persists', b.data.name === 'تست کرگو ۲', b.data.name);
});

await step(3, 'Code field disabled on edit', async () => {
  await page.goto(`${BASE}/admin/branches/${branchId}/edit`);
  const code = page.locator('input[name=code]');
  await code.waitFor();
  check(
    3,
    'Code field disabled on edit (deep link works)',
    (await code.isDisabled()) && (await code.inputValue()) === 'TESTKC',
  );
  await page.keyboard.press('Escape');
  await page.waitForURL(/\/admin\/branches$/);
});

// =============================== Users ================================
await step(7, 'Create super_admin user (branch hidden) → branch null', async () => {
  await page.goto(`${BASE}/admin/users`);
  await page.click('[data-testid=add-user]');
  await page.fill('input[name=username]', 'e2e_sa2');
  await page.fill('input[name=password]', 'Kc-Strong-Pass-2026!');
  const strength = await page.getAttribute('[data-testid=password-strength]', 'data-strength');
  await page.selectOption('select[name=role]', 'super_admin');
  const branchFields = await page.locator('[data-testid=user-branch]').count();
  await submit();
  await toast('e2e_sa2').waitFor({ timeout: 10000 });
  const u = await api('GET', '/users/?search=e2e_sa2');
  check(
    7,
    'Create super_admin user (branch hidden) → branch null',
    branchFields === 0 && u.data[0]?.role === 'super_admin' && u.data[0]?.branch === null,
    `strength=${strength}, branchFields=${branchFields}`,
  );
});

await step(8, 'branch_manager without branch → «برای مدیر بندر، بندر لازم است»', async () => {
  await page.click('[data-testid=add-user]');
  await page.fill('input[name=username]', MGR);
  await page.fill('input[name=password]', PASS.mgr);
  await page.fill('input[name=first_name]', 'مدیر');
  await submit();
  const msg = dialog().getByText('برای مدیر بندر، بندر لازم است');
  await msg.waitFor({ timeout: 5000 });
  check(
    8,
    'branch_manager without branch → «برای مدیر بندر، بندر لازم است»',
    await msg.isVisible(),
  );
  await page.screenshot({ path: `${SHOTS}/02-user-drawer-branch-required.png` });
});

await step(9, 'branch_manager with branch → created; sees no «مدیریت»', async () => {
  await page.selectOption('[data-testid=user-branch]', String(branchId));
  await submit();
  await toast(MGR).waitFor({ timeout: 10000 });
  const ctxB = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  const pb = await ctxB.newPage();
  await login(pb, MGR, PASS.mgr);
  await pb.waitForSelector('[data-testid=greeting]');
  const adminNav = await pb.locator('[data-testid=nav-admin]').count();
  const tiles = await pb.locator('[data-testid=tile-branches]').count();
  await pb.goto(`${BASE}/admin/branches`);
  const forbidden = await pb.getByText('دسترسی ندارید').isVisible();
  await ctxB.close();
  check(
    9,
    'branch_manager with branch → created; sees no «مدیریت», /admin → 403 page',
    adminNav === 0 && tiles === 0 && forbidden,
    `adminNav=${adminNav}, tiles=${tiles}, forbidden=${forbidden}`,
  );
  check('32a', 'Dashboard tiles hidden for branch_manager', tiles === 0);
});

await step(10, 'Edit without password keeps it; with password changes it', async () => {
  await row(MGR).click();
  await page.fill('input[name=last_name]', 'آزمایشی');
  await submit();
  await toast(MGR).waitFor({ timeout: 10000 });
  const keep = await httpLogin(MGR, PASS.mgr);
  await row(MGR).click();
  await page.fill('input[name=password]', PASS.changed);
  await submit();
  await page.waitForURL(/\/admin\/users$/);
  const changed = await httpLogin(MGR, PASS.changed);
  check(
    10,
    'Edit without password keeps it; with password changes it',
    keep === 200 && changed === 200,
    `old after plain edit=${keep}, new after password edit=${changed}`,
  );
});

await step(11, 'Reset password dialog → new password works', async () => {
  await row(MGR).getByRole('button', { name: 'رمز تازه' }).click();
  await page.fill('[data-testid=reset-password-input]', PASS.reset);
  await page.click('[data-testid=reset-submit]');
  await toast('عوض شد').waitFor({ timeout: 10000 });
  check(
    11,
    'Reset password dialog → new password works',
    (await httpLogin(MGR, PASS.reset)) === 200,
  );
});

await step(12, 'Lock (5 wrong logins) → Unlock button → unlock → login works', async () => {
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push(await httpLogin(MGR, 'wrong-' + i));
  await page.reload();
  const badge = row(MGR).locator('[data-testid=locked-badge]');
  await badge.waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${SHOTS}/03-users-locked.png` });
  await row(MGR).locator('[data-testid=unlock]').click();
  await confirmOk();
  await toast('باز شد').waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  const badgeGone = (await row(MGR).locator('[data-testid=locked-badge]').count()) === 0;
  // The per-IP failed-login limit (5/min) still answers 429 until its window ends.
  let after = 0;
  for (let i = 0; i < 9; i++) {
    after = await httpLogin(MGR, PASS.reset);
    if (after !== 429) break;
    await new Promise((r) => setTimeout(r, 10000));
  }
  check(
    12,
    'Lock (5 wrong logins) → Unlock button → unlock → login works',
    statuses.at(-1) === 423 && badgeGone && after === 200,
    `wrong=${statuses}, badgeGone=${badgeGone}, login after=${after}`,
  );
});

await step(13, 'Deactivate user → cannot log in', async () => {
  await row(MGR).locator('[data-testid=deactivate]').click();
  await confirmOk();
  await toast('غیرفعال شد').waitFor({ timeout: 10000 });
  const status = await httpLogin(MGR, PASS.reset);
  check(13, 'Deactivate user → cannot log in', status === 401, `login=${status}`);
});

// ====================== Branches (need the user above) ======================
await step(4, 'Toggle branch is_active → list shows غیرفعال', async () => {
  await page.goto(`${BASE}/admin/branches/${branchId}/edit`);
  await page.click('#branch-active');
  await submit();
  await page.waitForURL(/\/admin\/branches$/);
  await page.waitForTimeout(500);
  const text = await row('TESTKC').textContent();
  check(4, 'Toggle branch is_active → list shows غیرفعال', text.includes('غیرفعال'), text);
});

await step(5, 'Delete branch with user → Dari error; empty branch → deleted', async () => {
  await row('TESTKC').getByRole('button', { name: 'حذف' }).click();
  await confirmOk();
  const err = toast('حذف ممکن نیست');
  await err.waitFor({ timeout: 10000 });
  const errText = await err.textContent();
  const stillThere = await row('TESTKC').isVisible();
  await page.click('[data-testid=add-branch]');
  await page.fill('input[name=name]', 'شاخهٔ حذف');
  await page.fill('input[name=code]', 'DELKC');
  await page.fill('input[name=city]', 'هرات');
  await submit();
  await row('DELKC').waitFor({ timeout: 10000 });
  await row('DELKC').getByRole('button', { name: 'حذف' }).click();
  await confirmOk();
  await toast('حذف شد').waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  const gone = (await row('DELKC').count()) === 0;
  check(
    5,
    'Delete branch with user → Dari error; empty branch → deleted',
    stillThere && gone && errText.includes('کاربران'),
    errText,
  );
});

// ============================ Exchange rates ============================
await step(14, 'No USD rate today → red banner + CTA', async () => {
  await page.goto(`${BASE}/admin/exchange-rates`);
  const banner = page.locator('[data-testid=today-rate-banner]');
  await page.waitForSelector('[data-testid=today-rate-banner]:not([data-state=pending])');
  const state = await banner.getAttribute('data-state');
  const cta = await page.locator('[data-testid=today-rate-cta]').isVisible();
  check(14, 'No USD rate today → red banner + CTA', state === 'missing' && cta, `state=${state}`);
  await page.screenshot({ path: `${SHOTS}/04-rates-banner-red.png` });
  await page.locator('h1').click();
  await page.keyboard.press('r');
  await page.waitForURL('**/exchange-rates/new', { timeout: 5000 });
  // React Router 7 renders a navigation in a transition: the URL changes before the drawer is
  // on screen, and an Escape pressed in between has nothing to close yet.
  await page.waitForSelector('[role=dialog]');
  const title = await page.getAttribute('[data-testid=add-rate]', 'title');
  check(
    '14b',
    'Keyboard shortcut R opens the create drawer (tooltip documents it)',
    title?.includes('R'),
    title,
  );
  await page.keyboard.press('Escape');
  await page.waitForURL(/\/exchange-rates$/);
});

await step(15, 'CTA → drawer today + USD → save → banner green', async () => {
  await page.click('[data-testid=today-rate-cta]');
  await page.waitForURL('**/exchange-rates/new');
  const date = await page.inputValue('input[name=date]');
  const today = await shamsiShift(0);
  const currency = await page.inputValue('select[name=currency]');
  await page.fill('input[name=rate]', '۷۰٫۵');
  await submit();
  await toast('ثبت شد').waitFor({ timeout: 10000 });
  await page.waitForSelector('[data-testid=today-rate-banner][data-state=set]', { timeout: 10000 });
  const text = await page.textContent('[data-testid=today-rate-banner]');
  check(
    15,
    'CTA → drawer today + USD → save → banner green',
    date === today && currency === 'USD' && text.includes('۷۰٫۵۰'),
    `date=${date}, currency=${currency}, banner=${text}`,
  );
  await page.screenshot({ path: `${SHOTS}/05-rates-banner-green.png` });
});

await step(16, 'Future date → backend 400 → Dari error under the date', async () => {
  await page.click('[data-testid=add-rate]');
  await page.fill('input[name=date]', await shamsiShift(1));
  await page.selectOption('select[name=currency]', 'EUR');
  await page.fill('input[name=rate]', '80');
  const resp = page.waitForResponse(
    (r) => r.url().endsWith('/api/exchange-rates/') && r.request().method() === 'POST',
  );
  await submit();
  const status = (await resp).status();
  const msg = dialog().getByText('آینده');
  await msg.first().waitFor({ timeout: 5000 });
  check(
    16,
    'Future date → backend 400 → Dari error under the date',
    status === 400,
    `status=${status}, msg=${await msg.first().textContent()}`,
  );
  await page.keyboard.press('Escape');
});

await step(17, 'AFN not offered; API rejects AFN with a Dari 400', async () => {
  await page.click('[data-testid=add-rate]');
  await page.waitForSelector('[role=dialog] select[name=currency] option', { state: 'attached' });
  const options = await page.locator('select[name=currency] option').allTextContents();
  await page.keyboard.press('Escape');
  await page.waitForURL(/\/exchange-rates$/);
  const r = await api('POST', '/exchange-rates/', {
    date: await shamsiShift(0),
    currency: 'AFN',
    rate: '1',
  });
  const msg = JSON.stringify(r.data);
  check(
    17,
    'AFN not offered; API rejects AFN with a Dari 400',
    options.length > 0 &&
      !options.some((o) => o.includes('AFN')) &&
      r.status === 400 &&
      DARI.test(msg),
    `options=${options.join('|')}, status=${r.status}, ${msg}`,
  );
});

async function createRate(dateKey, currency, rate) {
  await page.click('[data-testid=add-rate]');
  await page.fill('input[name=date]', dateKey);
  await page.selectOption('select[name=currency]', currency);
  await page.fill('input[name=rate]', rate);
  await page.locator('input[name=rate]').blur();
  const typed = await page.inputValue('input[name=rate]');
  await submit();
  await toast('ثبت شد').first().waitFor({ timeout: 10000 });
  await page.waitForURL(/\/exchange-rates$/);
  return typed;
}

await step(18, '8-decimal rate 0.00028571 accepted and shown', async () => {
  await createRate(await shamsiShift(0), 'IRR', '0.00028571');
  await page.waitForTimeout(500);
  const text = await row('IRR').textContent();
  const r = await api('GET', '/exchange-rates/?currency=IRR');
  check(
    18,
    '8-decimal rate 0.00028571 accepted and shown',
    r.data[0]?.rate === '0.00028571' && text.includes('۰٫۰۰۰۲۸۵۷۱'),
    text,
  );
});

await step(19, 'Dari digits «۰٫۰۰۰۲۸» normalized → 0.00028', async () => {
  const typed = await createRate(await shamsiShift(-1), 'PKR', '۰٫۰۰۰۲۸');
  const r = await api('GET', '/exchange-rates/?currency=PKR');
  check(
    19,
    'Dari digits «۰٫۰۰۰۲۸» normalized → 0.00028',
    typed === '0.00028' && r.data[0]?.rate === '0.00028000',
    `input after blur=${typed}, stored=${r.data[0]?.rate}`,
  );
});

await step(20, 'Shamsi date-range filter (Dari digits)', async () => {
  await createRate(await shamsiShift(-10), 'EUR', '75');
  const all = await page.locator('tbody tr').count();
  await page.fill('[data-testid=date-from]', toDari(await shamsiShift(-5)));
  await page.locator('[data-testid=date-from]').blur();
  await page.waitForTimeout(400);
  const fromRows = await page.locator('tbody tr').allTextContents();
  await page.fill('[data-testid=date-from]', '');
  await page.fill('[data-testid=date-to]', await shamsiShift(-6));
  await page.waitForTimeout(400);
  const toRows = await page.locator('tbody tr').allTextContents();
  await page.fill('[data-testid=date-to]', '');
  await page.waitForTimeout(300);
  check(
    20,
    'Shamsi date-range filter (Dari digits)',
    all === 4 &&
      fromRows.length === 3 &&
      !fromRows.some((t) => t.includes('EUR')) &&
      toRows.length === 1 &&
      toRows[0].includes('EUR'),
    `all=${all}, from=${fromRows.length}, to=${toRows.length}`,
  );
});

await step(21, 'Delete rate → confirm → removed', async () => {
  await row('EUR').getByRole('button', { name: 'حذف' }).click();
  await confirmOk();
  await toast('نرخ حذف شد').waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  const r = await api('GET', '/exchange-rates/?currency=EUR');
  check(
    21,
    'Delete rate → confirm → removed',
    r.data.length === 0 && (await row('EUR').count()) === 0,
  );
});

// ============================ Statement lines ============================
let office = null;
let seal = null;
await step(22, 'Grouped by section (5 with «سایر عواید»), every line shown', async () => {
  await page.goto(`${BASE}/admin/statement-lines`);
  await row('OPEX_OFFICE').waitFor();
  const sections = await page.locator('[data-testid^=section-]').count();
  const rows = await page.locator('[data-testid^=section-] tbody tr').count();
  const lines = (await api('GET', '/statement-lines/')).data;
  office = lines.find((l) => l.code === 'OPEX_OFFICE');
  seal = lines.find((l) => l.code === 'COGS_SEAL');
  // 17 standard lines + one «سایر عواید» line per office-income category (+ added types).
  check(
    22,
    'Grouped by section (5 with «سایر عواید»), every line shown',
    sections === 5 &&
      rows === lines.length &&
      rows >= 22 &&
      lines.filter((l) => l.section === 'OTHER_INCOME').length >= 5,
    `sections=${sections}, rows=${rows}`,
  );
  await page.screenshot({ path: `${SHOTS}/06-statement-lines.png`, fullPage: true });
});

await step(23, 'Inline edit label_fa saves on blur', async () => {
  await row('OPEX_OFFICE')
    .getByRole('button', { name: /^عنوان \(دری\)/ })
    .click();
  await page.fill('[data-testid=inline-input]', 'مصارف دفتر (آزمایش)');
  await page.locator('h1').click(); // blur
  await toast('ذخیره شد').waitFor({ timeout: 10000 });
  const l = await api('GET', `/statement-lines/${office.id}/`);
  check(
    23,
    'Inline edit label_fa saves on blur',
    l.data.label_fa === 'مصارف دفتر (آزمایش)',
    l.data.label_fa,
  );
});

await step(
  24,
  'REVENUE section with an expense source → Dari error (UI + backend 400)',
  async () => {
    await row('COGS_SEAL').getByRole('button', { name: 'ویرایش' }).click();
    await page.waitForURL(/statement-lines\/\d+\/edit$/);
    await page.selectOption('[data-testid=line-section]', 'REVENUE');
    await submit();
    const ui = dialog().getByText('بخش عاید فقط');
    await ui.first().waitFor({ timeout: 5000 });
    await page.keyboard.press('Escape');
    const r = await api('PATCH', `/statement-lines/${seal.id}/`, { section: 'REVENUE' });
    check(
      24,
      'REVENUE section with an expense source → Dari error (UI + backend 400)',
      r.status === 400 && JSON.stringify(r.data).includes('بخش عاید فقط'),
      `api=${r.status} ${JSON.stringify(r.data)}`,
    );
  },
);

await step(25, 'Toggle is_active off → greyed + income statement warns', async () => {
  await row('COGS_SEAL').getByRole('switch').click();
  await toast('COGS_SEAL').waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  const cls = await row('COGS_SEAL').getAttribute('class');
  const report = await api('GET', '/income-statement/');
  const warns = report.data.warnings ?? [];
  const warned = warns.some((w) => w.includes('seal_expense') || w.includes('سیم'));
  await row('COGS_SEAL').getByRole('switch').click(); // restore
  await page.waitForTimeout(800);
  check(
    25,
    'Toggle is_active off → greyed + income statement warns',
    cls.includes('opacity-50') && warned,
    warns.join(' | '),
  );
});

await step(26, 'History modal shows the inline edit, user and dual date', async () => {
  await row('OPEX_OFFICE').locator('[data-testid=history-button]').click();
  await page.waitForURL(/statement-lines\/\d+\/history$/);
  await page.locator('[data-testid=history-item]').first().waitFor({ timeout: 10000 });
  const first = await page.locator('[data-testid=history-item]').first().textContent();
  const count = await page.locator('[data-testid=history-item]').count();
  check(
    26,
    'History modal shows the inline edit, user and dual date',
    count >= 2 &&
      first.includes(ADMIN[0]) &&
      first.includes('مصارف دفتر (آزمایش)') &&
      /[۰-۹]{4}-[۰-۹]{2}-[۰-۹]{2}/.test(first) &&
      /20\d\d-\d\d-\d\d/.test(first),
    first,
  );
  await page.screenshot({ path: `${SHOTS}/07-history-modal.png` });
  await page.keyboard.press('Escape');
  await api('PATCH', `/statement-lines/${office.id}/`, { label_fa: office.label_fa }); // restore
});

// =============================== Dashboard ===============================
await step(32, 'Dashboard: super_admin tiles + rate card', async () => {
  await page.goto(`${BASE}/dashboard`);
  await page.waitForSelector('[data-testid=tile-rate-value]');
  await page.waitForSelector('[data-testid=tile-lines-value]');
  const rate = await page.textContent('[data-testid=tile-rate-value]');
  const lines = await page.textContent('[data-testid=tile-lines-value]');
  const banner = await page.getAttribute('[data-testid=today-rate-banner]', 'data-state');
  // Active lines: the 17 standard ones + one «سایر عواید» line per office-income category.
  const active = (await api('GET', '/statement-lines/')).data.filter((l) => l.is_active).length;
  const dari = String(active).replace(/\d/g, (x) => '۰۱۲۳۴۵۶۷۸۹'[Number(x)]);
  check(
    32,
    'Dashboard: super_admin tiles + rate card',
    rate === 'ثبت شده' && lines === dari && active >= 22 && banner === 'set',
    `rate=${rate}, lines=${lines}`,
  );
  await page.screenshot({ path: `${SHOTS}/08-dashboard-admin.png` });
});

check('E', 'No uncaught page errors', consoleErrors.length === 0, consoleErrors.join(' | '));
await browser.close();
fs.writeFileSync(`${SHOTS}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
