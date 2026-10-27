/**
 * Stage 13 live check: Hawala and Office Expenses pages — against the real stack
 * (Django :8000 + Vite :5173).
 *   ..\.venv\Scripts\python scripts\cleanup-stage13.py --setup
 *   node scripts/verify-stage13.mjs <screenshot-dir>
 *   ..\.venv\Scripts\python scripts\cleanup-stage13.py
 * Env: KC_PASS (default: the password cleanup-stage13.py sets), KC_BROWSER.
 */
import fs from 'node:fs';

import { chromium } from 'playwright-core';

const BASE = process.env.KC_BASE_URL ?? 'http://localhost:5173';
const SHOTS = process.argv[2] ?? 'stage13-screenshots';
const PASS = process.env.KC_PASS ?? 'E2e-Stage13-Pass-2026';
const BROWSER =
  process.env.KC_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
let pages = {};
function check(id, name, ok, info = '') {
  results.push({ id, name, ok: Boolean(ok), info: String(info).slice(0, 300) });
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${id}. ${name}${info ? '  — ' + String(info).slice(0, 220) : ''}`,
  );
}
async function step(id, name, fn) {
  try {
    await fn();
  } catch (err) {
    check(id, name, false, `threw: ${err.message.split('\n')[0]}`);
    for (const [who, p] of Object.entries(pages)) {
      await p.screenshot({ path: `${SHOTS}/fail-${id}-${who}.png` }).catch(() => {});
    }
  }
}

const browser = await chromium.launch({ executablePath: BROWSER });
const errors = [];
async function session(username) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${username}: ${e}`));
  await page.goto(`${BASE}/login`);
  await page.fill('#username', username);
  await page.fill('#password', PASS);
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard');
  return page;
}
const api = (page, method, url, body) =>
  page.evaluate(
    async ({ method, url, body }) => {
      const r = await fetch(`/api${url}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('kc.access')}`,
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
const shamsi = (page, days) =>
  page.evaluate(async (n) => {
    const m = await import('/src/lib/date.ts');
    return m.shiftShamsi(m.todayShamsi(), n, 'day');
  }, days);
const toast = (p, text) => p.locator('div[role=status]', { hasText: text }).first();
const toDari = (s) => String(s).replace(/\d/g, (x) => String.fromCharCode(0x06f0 + Number(x)));
/** '20600.00' → '۲۰٬۶۰۰٫۰۰' (formatMoney's fa output without the symbol). */
const dariMoney = (s) => {
  const [i, f = '00'] = String(s).split('.');
  return toDari(`${i.replace(/\B(?=(\d{3})+(?!\d))/g, '٬')}٫${f.padEnd(2, '0').slice(0, 2)}`);
};
const rows = (p) => p.locator('tbody tr[tabindex]');
const submit = (p) => p.click('[data-testid=drawer-submit]');
const closedDrawer = (p) => p.waitForSelector('[data-testid=record-form]', { state: 'detached' });

const admin = await session('e2e_admin');
const mgr = await session('e2e_mgr');
const mgrB = await session('e2e_mgr_b');
pages = { admin, mgr, mgrB };
const me = (await api(mgr, 'GET', '/auth/me/')).data;
const meB = (await api(mgrB, 'GET', '/auth/me/')).data;
const A = me.branch.id;
const B = meB.branch.id;
const today = await shamsi(mgr, 0);
const tenDaysAgo = await shamsi(mgr, -10);
const period = `date_from=${tenDaysAgo}&date_to=${today}`;
const hawalaList = async (p, q = period) => (await api(p, 'GET', `/hawala/?${q}`)).data;
const officeList = async (p, q = period) => (await api(p, 'GET', `/office-expenses/?${q}`)).data;

// ================================ navigation ================================
await step(1, 'Sidebar «مالی» group with both pages — both roles', async () => {
  const links = async (p) =>
    p.locator('[data-testid=nav-finance] a').evaluateAll((as) => as.map((a) => a.pathname));
  const m = await links(mgr);
  const a = await links(admin);
  const want = ['/finance/hawala', '/finance/office-expenses'];
  const heading = await mgr.locator('[data-testid=nav-finance] p').textContent();
  check(
    1,
    'Sidebar «مالی» group with both pages — both roles',
    JSON.stringify(m) === JSON.stringify(want) &&
      JSON.stringify(a) === JSON.stringify(want) &&
      heading.includes('مالی'),
    `mgr=${m} admin=${a} heading=${heading}`,
  );
});

// ================================ hawala ================================
await step(2, 'Hawala create (UI): Dari digits with «٫» and «٬», AFN', async () => {
  await mgr.goto(`${BASE}/finance/hawala`);
  await mgr.click('[data-testid=add-record]');
  await mgr.fill('[data-testid=field-from_party]', 'صرافی کابل');
  await mgr.fill('[data-testid=field-to_party]', 'صرافی تورخم');
  await mgr.fill('[data-testid=field-amount]', '۱٬۲۵۰٫۷۵');
  await mgr.selectOption('[data-testid=field-currency]', 'AFN');
  await mgr.fill('[data-testid=field-fee]', '۵۰');
  const note = await mgr.getByTestId('rate-note').textContent();
  await submit(mgr);
  await toast(mgr, 'حواله ثبت شد').waitFor();
  await closedDrawer(mgr);
  const rec = (await hawalaList(mgr, `date=${today}`)).results.find(
    (r) => r.from_party === 'صرافی کابل',
  );
  const row = await rows(mgr).filter({ hasText: 'صرافی کابل' }).first().textContent();
  check(
    2,
    'Hawala create (UI): Dari digits with «٫» and «٬», AFN',
    rec?.amount === '1250.75' &&
      rec.fee === '50.00' &&
      rec.rate_used === null &&
      rec.branch === A &&
      note.includes('نرخ لازم نیست') &&
      row.includes('۱٬۲۵۰٫۷۵') &&
      row.includes('مدیر'),
    `${JSON.stringify(rec)} | ${row}`,
  );
});

let usdHawala;
await step(3, 'Hawala in USD dated ten days ago: form shows that day’s rate; snapshot stored', async () => {
  await mgr.goto(`${BASE}/finance/hawala/new?${period}`);
  await mgr.fill('[data-testid=field-date]', toDari(tenDaysAgo));
  await mgr.fill('[data-testid=field-from_party]', 'شرکت الف');
  await mgr.fill('[data-testid=field-to_party]', 'شرکت ب');
  await mgr.fill('[data-testid=field-amount]', '100');
  await mgr.selectOption('[data-testid=field-currency]', 'USD');
  await mgr.fill('[data-testid=field-fee]', '2');
  await mgr.waitForFunction(() =>
    document.querySelector('[data-testid=rate-note]')?.textContent.includes('۸۰'),
  );
  const note = await mgr.getByTestId('rate-note').textContent();
  await submit(mgr);
  await toast(mgr, 'حواله ثبت شد').waitFor();
  await closedDrawer(mgr);
  usdHawala = (await hawalaList(mgr)).results.find((r) => r.from_party === 'شرکت الف');
  const row = await rows(mgr).filter({ hasText: 'شرکت الف' }).first().textContent();
  check(
    3,
    'Hawala in USD dated ten days ago: form shows that day’s rate; snapshot stored',
    note.includes('۸۰٫۰۰') &&
      usdHawala?.rate_used === '80.00000000' &&
      usdHawala.amount_afn === '8000.00' &&
      usdHawala.fee_afn === '160.00' &&
      row.includes('۸٬۰۰۰٫۰۰') &&
      row.includes(toDari(tenDaysAgo)),
    `${note} | ${JSON.stringify(usdHawala)}`,
  );
});

await step(4, 'Later rate change does not alter the stored hawala (snapshot)', async () => {
  const rate = (await api(admin, 'GET', `/exchange-rates/?date=${tenDaysAgo}&currency=USD`)).data;
  const id = (Array.isArray(rate) ? rate : rate.results)[0].id;
  const patched = await api(admin, 'PATCH', `/exchange-rates/${id}/`, { rate: '95' });
  const after = (await api(mgr, 'GET', `/hawala/${usdHawala.id}/`)).data;
  await mgr.goto(`${BASE}/finance/hawala/${usdHawala.id}/edit?${period}`);
  await mgr.getByTestId('rate-note').waitFor();
  const note = await mgr.getByTestId('rate-note').textContent();
  await mgr.keyboard.press('Escape');
  check(
    4,
    'Later rate change does not alter the stored hawala (snapshot)',
    patched.status === 200 &&
      after.rate_used === '80.00000000' &&
      after.amount_afn === '8000.00' &&
      note.includes('۸۰٫۰۰') &&
      !note.includes('۹۵'),
    `${patched.status} ${after.rate_used} | ${note}`,
  );
});

await step(5, 'Hawala edit (fee) + history modal shows only the changed field', async () => {
  await mgr.goto(`${BASE}/finance/hawala/${usdHawala.id}/edit?${period}`);
  await mgr.fill('[data-testid=field-fee]', '۳٫۵');
  await submit(mgr);
  await toast(mgr, 'حواله ذخیره شد').waitFor();
  await closedDrawer(mgr);
  await rows(mgr)
    .filter({ hasText: 'شرکت الف' })
    .getByTestId('history-button')
    .click();
  await mgr.getByTestId('history-modal').locator('li').first().waitFor();
  const text = await mgr.getByTestId('history-modal').textContent();
  const stored = (await api(mgr, 'GET', `/hawala/${usdHawala.id}/`)).data;
  await mgr.keyboard.press('Escape');
  check(
    5,
    'Hawala edit (fee) + history modal shows only the changed field',
    stored.fee === '3.50' &&
      stored.rate_used === '80.00000000' &&
      text.includes('مصرف حواله') &&
      text.includes('۳٫۵۰') &&
      text.includes('۲٫۰۰') &&
      !text.includes('نرخ استفاده'),
    text.slice(0, 200),
  );
});

await step(6, 'Hawala totals footer = API totals (fee in AFN and USD)', async () => {
  await mgr.goto(`${BASE}/finance/hawala?${period}`);
  await mgr.getByTestId('totals').waitFor();
  const data = await hawalaList(mgr);
  const fee = await mgr.getByTestId('total-fee-afn').textContent();
  const feeUsd = await mgr.getByTestId('total-fee-usd').textContent();
  const amount = await mgr.getByTestId('total-amount-afn').textContent();
  const count = await mgr.getByTestId('totals-count').textContent();
  await mgr.screenshot({ path: `${SHOTS}/hawala.png`, fullPage: true });
  // fee: 50 AFN + 3.50 USD × 80 = 330 AFN
  check(
    6,
    'Hawala totals footer = API totals (fee in AFN and USD)',
    data.totals.fee.afn === '330.00' &&
      fee.includes(dariMoney(data.totals.fee.afn)) &&
      feeUsd.includes(dariMoney(data.totals.fee.usd)) &&
      amount.includes(dariMoney(data.totals.amount.afn)) &&
      count.includes('۲'),
    `${JSON.stringify(data.totals.fee)} | ${fee} ${feeUsd} ${amount} ${count}`,
  );
});

// ================================ office expenses ================================
await step(7, 'Office expense create (UI): rent ۳٬۰۰۰ AFN with person and bill number', async () => {
  await mgr.goto(`${BASE}/finance/office-expenses?${period}`);
  await mgr.click('[data-testid=add-record]');
  await mgr.selectOption('[data-testid=field-category]', 'RENT');
  await mgr.fill('[data-testid=field-amount]', '۳٬۰۰۰');
  await mgr.fill('[data-testid=field-person]', 'صاحب خانه');
  await mgr.fill('[data-testid=field-bill_number]', 'R-77');
  await mgr.fill('[data-testid=field-description]', 'کرایهٔ ماه');
  await submit(mgr);
  await toast(mgr, 'مصرف دفتر ثبت شد').waitFor();
  await closedDrawer(mgr);
  const rec = (await officeList(mgr)).results.find((r) => r.bill_number === 'R-77');
  const row = await rows(mgr).filter({ hasText: 'R-77' }).first().textContent();
  check(
    7,
    'Office expense create (UI): rent ۳٬۰۰۰ AFN with person and bill number',
    rec?.amount === '3000.00' &&
      rec.currency === 'AFN' &&
      rec.category === 'RENT' &&
      row.includes('کرایه') &&
      row.includes('صاحب خانه') &&
      row.includes('۳٬۰۰۰٫۰۰'),
    `${JSON.stringify(rec)} | ${row}`,
  );
});

await step(8, 'Office expense in PKR ten days ago: rate note 0.25, AFN equivalent 100', async () => {
  await mgr.click('[data-testid=add-record]');
  await mgr.fill('[data-testid=field-date]', toDari(tenDaysAgo));
  await mgr.selectOption('[data-testid=field-category]', 'FUEL');
  await mgr.fill('[data-testid=field-amount]', '۴۰۰');
  await mgr.selectOption('[data-testid=field-currency]', 'PKR');
  await mgr.waitForFunction(() =>
    document.querySelector('[data-testid=rate-note]')?.textContent.includes('۰٫۲۵'),
  );
  await submit(mgr);
  await toast(mgr, 'مصرف دفتر ثبت شد').waitFor();
  await closedDrawer(mgr);
  const rec = (await officeList(mgr)).results.find((r) => r.category === 'FUEL');
  const row = await rows(mgr).filter({ hasText: 'تیل' }).first().textContent();
  check(
    8,
    'Office expense in PKR ten days ago: rate note 0.25, AFN equivalent 100',
    rec?.rate_used === '0.25000000' && rec.amount_afn === '100.00' && row.includes('۱۰۰٫۰۰'),
    `${JSON.stringify(rec)} | ${row}`,
  );
});

await step(9, 'Salary in USD today (rate 70) and an API-created kitchen expense', async () => {
  await mgr.click('[data-testid=add-record]');
  await mgr.selectOption('[data-testid=field-category]', 'SALARY');
  await mgr.fill('[data-testid=field-amount]', '۲۵۰');
  await mgr.selectOption('[data-testid=field-currency]', 'USD');
  await mgr.fill('[data-testid=field-person]', 'کارمند دفتر');
  await mgr.waitForFunction(() =>
    document.querySelector('[data-testid=rate-note]')?.textContent.includes('۷۰'),
  );
  await submit(mgr);
  await toast(mgr, 'مصرف دفتر ثبت شد').waitFor();
  await closedDrawer(mgr);
  const kitchen = await api(mgr, 'POST', '/office-expenses/', {
    branch: A,
    date: today,
    category: 'KITCHEN',
    amount: '۵۰۰٫۵۰',
    currency: 'AFN',
  });
  const rec = (await officeList(mgr)).results.find((r) => r.category === 'SALARY');
  check(
    9,
    'Salary in USD today (rate 70) and an API-created kitchen expense',
    rec?.rate_used === '70.00000000' &&
      rec.amount_afn === '17500.00' &&
      kitchen.status === 201 &&
      kitchen.data.amount === '500.50',
    `${JSON.stringify(rec)} | ${kitchen.status} ${kitchen.data.amount}`,
  );
});

await step(10, 'Category summary strip: salary separate, non-salary and per category (AFN)', async () => {
  await mgr.goto(`${BASE}/finance/office-expenses?${period}`);
  await mgr.getByTestId('category-summary').waitFor();
  await mgr.waitForFunction(
    () => document.querySelector('[data-testid=summary-KITCHEN]') !== null,
  );
  const salary = await mgr.getByTestId('summary-salary-value-afn').textContent();
  const nonSalary = await mgr.getByTestId('summary-non-salary-value-afn').textContent();
  const fuel = await mgr.getByTestId('summary-FUEL-value-afn').textContent();
  const rent = await mgr.getByTestId('summary-RENT-value-afn').textContent();
  const salaryChipInGroups = await mgr.getByTestId('summary-SALARY').count();
  await mgr.screenshot({ path: `${SHOTS}/office-expenses.png`, fullPage: true });
  check(
    10,
    'Category summary strip: salary separate, non-salary and per category (AFN)',
    salary.includes('۱۷٬۵۰۰٫۰۰') &&
      nonSalary.includes('۳٬۶۰۰٫۵۰') &&
      fuel.includes('۱۰۰٫۰۰') &&
      rent.includes('۳٬۰۰۰٫۰۰') &&
      salaryChipInGroups === 0,
    `${salary} | ${nonSalary} | ${fuel} | ${rent}`,
  );
});

await step(11, 'Office totals footer = API totals; by currency listed', async () => {
  const data = await officeList(mgr);
  const total = await mgr.getByTestId('total-amount-afn').textContent();
  const byCur = await mgr.getByTestId('totals-by-currency').textContent();
  check(
    11,
    'Office totals footer = API totals; by currency listed',
    data.totals.afn === '21100.50' &&
      data.count === 4 &&
      total.includes(dariMoney(data.totals.afn)) &&
      byCur.includes('کلدار') &&
      byCur.includes('$'),
    `${data.totals.afn} ${data.count} | ${total} | ${byCur}`,
  );
});

await step(12, 'Category filter (URL state): only salary rows, totals follow the filter', async () => {
  await mgr.selectOption('[data-testid=filter-category]', 'SALARY');
  await mgr.waitForURL(/category=SALARY/);
  await mgr.waitForFunction(
    () => document.querySelectorAll('tbody tr[tabindex]').length === 1,
  );
  const total = await mgr.getByTestId('total-amount-afn').textContent();
  await mgr.reload();
  await mgr.waitForFunction(
    () => document.querySelectorAll('tbody tr[tabindex]').length === 1,
  );
  const kept = await mgr.locator('[data-testid=filter-category]').inputValue();
  check(
    12,
    'Category filter (URL state): only salary rows, totals follow the filter',
    total.includes('۱۷٬۵۰۰٫۰۰') && kept === 'SALARY',
    `${total} kept=${kept}`,
  );
});

await step(13, 'Date-range filter: ten-days-ago records drop out of today-only range', async () => {
  await mgr.goto(`${BASE}/finance/office-expenses?date_from=${today}&date_to=${today}`);
  await mgr.getByTestId('totals').waitFor();
  await mgr.waitForFunction(
    () => document.querySelectorAll('tbody tr[tabindex]').length === 3,
  );
  const fuelRows = await rows(mgr).filter({ hasText: 'تیل' }).count();
  const hw = await hawalaList(mgr, `date_from=${today}&date_to=${today}`);
  check(
    13,
    'Date-range filter: ten-days-ago records drop out of today-only range',
    fuelRows === 0 && hw.count === 1 && hw.results[0].from_party === 'صرافی کابل',
    `fuel=${fuelRows} hawala=${hw.count}`,
  );
});

await step(14, 'Validation: bad amount and missing parties stay in the form', async () => {
  await mgr.goto(`${BASE}/finance/hawala/new`);
  await mgr.fill('[data-testid=field-amount]', '۱۲٫۳۴۵');
  await submit(mgr);
  await mgr.waitForSelector('[role=alert], [id$=-error]');
  const text = await mgr.getByTestId('record-form').textContent();
  const open = await mgr.getByTestId('record-form').isVisible();
  await mgr.keyboard.press('Escape');
  check(
    14,
    'Validation: bad amount and missing parties stay in the form',
    open && text.includes('مبلغ درست نیست') && text.includes('لازم است'),
    text.slice(0, 160),
  );
});

// ================================ branch scoping ================================
await step(15, 'Branch manager B sees none of branch A’s records (list and direct id)', async () => {
  const listB = await officeList(mgrB);
  const hwB = await hawalaList(mgrB);
  const direct = await api(mgrB, 'GET', `/hawala/${usdHawala.id}/`);
  await mgrB.goto(`${BASE}/finance/hawala/${usdHawala.id}/edit`);
  await mgrB.waitForFunction(() => document.body.textContent.includes('پیدا نشد'));
  check(
    15,
    'Branch manager B sees none of branch A’s records (list and direct id)',
    listB.count === 0 && hwB.count === 0 && direct.status === 404,
    `office=${listB.count} hawala=${hwB.count} direct=${direct.status}`,
  );
});

await step(16, 'Branch manager cannot create for another branch (saved to own branch)', async () => {
  const r = await api(mgrB, 'POST', '/office-expenses/', {
    branch: A,
    date: today,
    category: 'OTHER',
    amount: '10',
    currency: 'AFN',
  });
  const seenByA = (await officeList(mgr)).results.some((x) => x.id === r.data.id);
  check(
    16,
    'Branch manager cannot create for another branch (saved to own branch)',
    r.status === 201 && r.data.branch === B && !seenByA,
    `${r.status} branch=${r.data.branch}`,
  );
});

await step(17, 'Super admin: all branches, branch column, branch filter', async () => {
  await admin.goto(`${BASE}/finance/office-expenses?${period}`);
  await admin.getByTestId('totals').waitFor();
  await admin.waitForFunction(() => document.querySelectorAll('tbody tr[tabindex]').length >= 5);
  const all = await rows(admin).count();
  const header = await admin.locator('thead').textContent();
  await admin.selectOption('[data-testid=filter-branch]', String(B));
  await admin.waitForFunction(() => document.querySelectorAll('tbody tr[tabindex]').length === 1);
  const onlyB = await rows(admin).first().textContent();
  check(
    17,
    'Super admin: all branches, branch column, branch filter',
    all >= 5 && header.includes('بندر') && onlyB.includes('بندر آزمایشی ۱۳ ب'),
    `all=${all} | ${onlyB}`,
  );
});

// ================================ consistency ================================
await step(18, 'Consistency: page totals = income statement OPEX_OFFICE / OPEX_SALARY / OPEX_HAWALA_FEE', async () => {
  const office = (await officeList(mgr)).totals;
  const hawala = (await hawalaList(mgr)).totals;
  const report = (
    await api(admin, 'GET', `/income-statement/?branch=${A}&${period}`)
  ).data;
  const line = (code) => report.lines.find((l) => l.code === code);
  const pairs = [
    [line('OPEX_OFFICE'), office.non_salary],
    [line('OPEX_SALARY'), office.salary],
    [line('OPEX_HAWALA_FEE'), hawala.fee],
  ];
  check(
    18,
    'Consistency: page totals = income statement OPEX_OFFICE / OPEX_SALARY / OPEX_HAWALA_FEE',
    pairs.every(([l, tot]) => l && l.amount_afn === tot.afn && l.amount_usd === tot.usd),
    pairs.map(([l, tot]) => `${l?.code}: ${l?.amount_afn}/${tot.afn} ${l?.amount_usd}/${tot.usd}`).join(' | '),
  );
});

// ================================ delete ================================
await step(19, 'Delete with confirm (hawala) — gone from list and API', async () => {
  await mgr.goto(`${BASE}/finance/hawala?${period}`);
  await rows(mgr).filter({ hasText: 'صرافی کابل' }).getByTestId('delete-button').click();
  await mgr.click('[data-testid=confirm-ok]');
  await toast(mgr, 'حواله حذف شد').waitFor();
  await mgr.waitForFunction(() => document.querySelectorAll('tbody tr[tabindex]').length === 1);
  const left = await hawalaList(mgr);
  check(
    19,
    'Delete with confirm (hawala) — gone from list and API',
    left.count === 1 && left.results[0].id === usdHawala.id,
    `count=${left.count}`,
  );
});

// ================================ 428 soft lock ================================
await step(20, '428 on create for both (API) when today’s USD rate is missing', async () => {
  const rate = (await api(admin, 'GET', `/exchange-rates/?date=${today}&currency=USD`)).data;
  const id = (Array.isArray(rate) ? rate : rate.results)[0].id;
  const del = await api(admin, 'DELETE', `/exchange-rates/${id}/`);
  const h = await api(mgr, 'POST', '/hawala/', {
    branch: A,
    from_party: 'x',
    to_party: 'y',
    amount: '1',
    currency: 'AFN',
  });
  const o = await api(mgr, 'POST', '/office-expenses/', {
    branch: A,
    category: 'OTHER',
    amount: '1',
    currency: 'AFN',
  });
  check(
    20,
    '428 on create for both (API) when today’s USD rate is missing',
    del.status === 204 &&
      h.status === 428 &&
      o.status === 428 &&
      h.data.code === 'TODAY_RATE_MISSING',
    `${del.status} ${h.status} ${o.status} ${h.data.code}`,
  );
});

await step(21, '428 in the form: manager enters today’s rate, the save is retried automatically', async () => {
  await mgr.goto(`${BASE}/finance/office-expenses/new`);
  await mgr.selectOption('[data-testid=field-category]', 'STATIONERY');
  await mgr.fill('[data-testid=field-amount]', '۲۵۰');
  await mgr.fill('[data-testid=field-bill_number]', 'ST-428');
  await submit(mgr);
  await mgr.getByTestId('rate-missing-panel').waitFor();
  await mgr.screenshot({ path: `${SHOTS}/rate-missing.png` });
  await mgr.click('[data-testid=rate-missing-cta]');
  await mgr.getByTestId('today-rate-dialog').waitFor();
  await mgr.fill('[data-testid=today-rate-input]', '۷۰٫۵');
  await mgr.click('[data-testid=today-rate-save]');
  await toast(mgr, 'مصرف دفتر ثبت شد').waitFor({ timeout: 10000 });
  await closedDrawer(mgr);
  const rec = (await officeList(mgr, `date=${today}`)).results.find((r) => r.bill_number === 'ST-428');
  const rate = (await api(mgr, 'GET', `/exchange-rates/?date=${today}&currency=USD`)).data;
  const stored = (Array.isArray(rate) ? rate : rate.results)[0];
  check(
    21,
    '428 in the form: manager enters today’s rate, the save is retried automatically',
    rec?.amount === '250.00' && stored?.rate === '70.50000000',
    `${JSON.stringify(rec)} | rate=${stored?.rate}`,
  );
});

// ================================ dashboard ================================
await step(22, 'Dashboard tile «مصارف دفتر این ماه» — branch manager (own branch)', async () => {
  await mgr.goto(`${BASE}/dashboard`);
  await mgr.getByTestId('tile-office-month-value').waitFor();
  const month = await mgr.evaluate(async () => (await import('/src/lib/date.ts')).currentShamsiMonth());
  const data = await officeList(mgr, `date_from=${month.from}&date_to=${month.to}`);
  const value = await mgr.getByTestId('tile-office-month-value').textContent();
  const label = await mgr.getByTestId('tile-office-month').textContent();
  check(
    22,
    'Dashboard tile «مصارف دفتر این ماه» — branch manager (own branch)',
    label.includes('مصارف دفتر این ماه') && value.includes(dariMoney(data.totals.afn)),
    `${value} vs ${data.totals.afn}`,
  );
});

await step(23, 'Dashboard tile — super admin (all branches) links to the page', async () => {
  await admin.goto(`${BASE}/dashboard`);
  await admin.getByTestId('tile-office-month-value').waitFor();
  const month = await admin.evaluate(async () => (await import('/src/lib/date.ts')).currentShamsiMonth());
  const data = await officeList(admin, `date_from=${month.from}&date_to=${month.to}`);
  const value = await admin.getByTestId('tile-office-month-value').textContent();
  const href = await admin.getByTestId('tile-office-month').getAttribute('href');
  check(
    23,
    'Dashboard tile — super admin (all branches) links to the page',
    value.includes(dariMoney(data.totals.afn)) && href === '/finance/office-expenses',
    `${value} vs ${data.totals.afn} ${href}`,
  );
});

await step(24, 'English UI: labels and LTR digits on the office-expenses page', async () => {
  await mgr.evaluate(async () => (await import('/src/i18n/index.ts')).default.changeLanguage('en'));
  await mgr.goto(`${BASE}/finance/office-expenses?${period}`);
  await mgr.getByTestId('totals').waitFor();
  const heading = await mgr.locator('h1').first().textContent();
  const summary = await mgr.getByTestId('summary-salary').textContent();
  await mgr.evaluate(async () => (await import('/src/i18n/index.ts')).default.changeLanguage('fa'));
  check(
    24,
    'English UI: labels and LTR digits on the office-expenses page',
    heading.includes('Office expenses') && summary.includes('Salary') && /17,500\.00/.test(summary),
    `${heading} | ${summary}`,
  );
});

await step(25, 'No uncaught page errors in any session', async () => {
  check(25, 'No uncaught page errors in any session', errors.length === 0, errors.join(' | '));
});

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
fs.writeFileSync(`${SHOTS}/results.json`, JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
