/**
 * Revenue & expense types live check: the super admin's «مدیریت → عواید و مصارف» page adds a
 * revenue type «کمیشن خدمات» and an expense type «مصرف پارکنگ», makes the expense required for
 * the «شیرخان» test branch's IMPORT form and hides a built-in expense there; the branch manager's
 * form follows; a transaction is saved and its balance, detail, print view, income statement
 * (Revenue + COGS lines), drill-down and Excel export are checked; the branch manager records an
 * office income, which appears under «سایر عواید» and on the dashboard. Also: «بندر والی» instead
 * of «استراس» everywhere, Pashto / English names, kind change blocked once amounts exist, the
 * branch manager's limits — against the real stack (Django + Vite).
 *   ..\.venv\Scripts\python scripts\cleanup-money-admin.py --setup
 *   node scripts/verify-money-admin.mjs <screenshot-dir>
 *   ..\.venv\Scripts\python scripts\cleanup-money-admin.py
 * Env: KC_BASE_URL, KC_PASS (default: the password cleanup-money-admin.py sets), KC_BROWSER,
 * KC_PYTHON (opens the Excel files with openpyxl through scripts/xlsx_dump.py).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { chromium } from 'playwright-core';

const BASE = process.env.KC_BASE_URL ?? 'http://localhost:5173';
const SHOTS = process.argv[2] ?? 'money-admin-screenshots';
const PASS = process.env.KC_PASS ?? 'E2e-Money-Pass-2026';
const PYTHON = process.env.KC_PYTHON ?? '../.venv/Scripts/python.exe';
const BROWSER =
  process.env.KC_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
fs.mkdirSync(SHOTS, { recursive: true });

const REV = 'E2EMONEY_COMMISSION';
const EXP = 'E2EMONEY_PARKING';
const field = (name) => `[data-testid="field-${name}"]`;
const SERIAL = `E2EMONEY-${Date.now() % 100000}`;

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
async function session(username, lang = 'fa') {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${username}: ${e}`));
  await page.goto(`${BASE}/login`);
  await page.evaluate((l) => localStorage.setItem('kc.lang', l), lang);
  await page.fill('#username', username);
  await page.fill('#password', PASS);
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard');
  return page;
}
const api = (page, method, url, body) =>
  page.evaluate(
    async ({ method, url, body }) => {
      const send = () =>
        fetch(`/api${url}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('kc.access')}`,
          },
          body: body ? JSON.stringify(body) : undefined,
        });
      let r = await send();
      if (r.status === 429) {
        const wait = Math.min(Number(r.headers.get('retry-after')) || 30, 65);
        await new Promise((done) => setTimeout(done, wait * 1000));
        r = await send();
      }
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
/** GET a file with the page's token and save it under SHOTS. */
async function fetchFile(page, url, name) {
  const b64 = await page.evaluate(async (url) => {
    const r = await fetch(`/api${url}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('kc.access')}` },
    });
    const bytes = new Uint8Array(await r.arrayBuffer());
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  }, url);
  const target = path.join(SHOTS, name);
  fs.writeFileSync(target, Buffer.from(b64, 'base64'));
  return target;
}
const xlsx = (file) => {
  const r = spawnSync(PYTHON, ['scripts/xlsx_dump.py', file], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
};
const toast = (p, text) => p.locator('div[role=status]', { hasText: text }).first();
const bodyText = (p) => p.locator('body').innerText();

const admin = await session('e2e_money_admin');
const mgr = await session('e2e_money_mgr');
const mgr2 = await session('e2e_money_mgr2');
pages = { admin, mgr, mgr2 };
const A = (await api(mgr, 'GET', '/auth/me/')).data.branch.id;
const B = (await api(mgr2, 'GET', '/auth/me/')).data.branch.id;
const today = (await api(mgr, 'GET', '/dashboard/summary/')).data.today_rate.date;
const SETTINGS = (tab) => `${BASE}/admin/money-settings?tab=${tab}&branch=${A}&type=IMPORT`;
let txId = null;

await step(
  1,
  'Page opens: built-in types, «پرداخت مشتری» locked, «بندر والی» not «استراس»',
  async () => {
    await admin.goto(SETTINGS('revenue'));
    await admin.getByTestId('ms-row-CUSTOMER_PAYMENT').waitFor();
    const kindLocked = await admin.getByTestId('ms-kind-CUSTOMER_PAYMENT').isDisabled();
    const visLocked = await admin
      .locator('[data-testid=ms-vis-CUSTOMER_PAYMENT-HIDDEN] input')
      .isDisabled();
    await admin.getByTestId('ms-tab-expenses').click();
    await admin.getByTestId('ms-row-REVENUE_ESTRAS').waitFor();
    const text = await bodyText(admin);
    await admin.screenshot({ path: `${SHOTS}/01-expenses.png`, fullPage: true });
    check(
      1,
      'Page opens: built-in types, «پرداخت مشتری» locked, «بندر والی» not «استراس»',
      kindLocked && visLocked && text.includes('عواید بندر والی') && !text.includes('استراس'),
      `kind=${kindLocked} vis=${visLocked}`,
    );
  },
);

await step(
  2,
  'Add revenue type «کمیشن خدمات» (fa / ps / en) after the customer payment',
  async () => {
    await admin.getByTestId('ms-tab-revenue').click();
    await admin.getByTestId('ms-add').click();
    await admin.fill('[data-testid=ms-add-name_fa]', 'کمیشن خدمات');
    await admin.fill('[data-testid=ms-add-name_ps]', 'د خدماتو کمیشن');
    await admin.fill('[data-testid=ms-add-name_en]', 'E2EMONEY commission');
    const options = await admin.locator('[data-testid=ms-add-position] option').allTextContents();
    await admin.getByTestId('ms-add-submit').click();
    await admin.getByTestId(`ms-row-${REV}`).waitFor();
    const order = await admin
      .locator('[data-testid^=ms-row-]')
      .evaluateAll((els) => els.map((e) => e.dataset.testid.replace('ms-row-', '')));
    const types = (await api(admin, 'GET', '/money-types/')).data;
    const created = types.find((x) => x.code === REV);
    check(
      2,
      'Add revenue type «کمیشن خدمات» (fa / ps / en) after the customer payment',
      created?.kind === 'REVENUE' &&
        created.name_ps === 'د خدماتو کمیشن' &&
        order[0] === 'CUSTOMER_PAYMENT' &&
        order[1] === REV &&
        options.length >= 2,
      order.join(','),
    );
  },
);

await step(3, 'Add expense type «مصرف پارکنگ» (section: direct costs)', async () => {
  await admin.getByTestId('ms-tab-expenses').click();
  await admin.getByTestId('ms-add').click();
  await admin.fill('[data-testid=ms-add-name_fa]', 'مصرف پارکنگ');
  await admin.fill('[data-testid=ms-add-name_en]', 'E2EMONEY parking');
  await admin.selectOption('[data-testid=ms-add-section]', 'COGS');
  await admin.getByTestId('ms-add-submit').click();
  await admin.getByTestId(`ms-row-${EXP}`).waitFor();
  const lines = (await api(admin, 'GET', '/statement-lines/')).data;
  const line = lines.find((l) => l.source_field === `@money:${EXP}`);
  const revLine = lines.find((l) => l.source_field === `@money:${REV}`);
  check(
    3,
    'Add expense type «مصرف پارکنگ» (section: direct costs)',
    line?.section === 'COGS' && revLine?.section === 'REVENUE',
    `${line?.code}/${line?.section} ${revLine?.code}/${revLine?.section}`,
  );
});

await step(
  4,
  'Staged: parking «لازم», built-in «خاک‌پولی بانکی» hidden → preview, then save',
  async () => {
    await admin.getByTestId(`ms-vis-${EXP}-REQUIRED`).click();
    await admin.getByTestId('ms-vis-KHAK_PULI_BANK-HIDDEN').click();
    const bar = await admin.getByTestId('ms-unsaved-bar').textContent();
    const preview = admin.getByTestId('ms-preview');
    await preview.locator(field(`@money:${EXP}`)).waitFor();
    const previewText = await preview.innerText();
    const requiredMark = await preview
      .locator('label', { hasText: 'مصرف پارکنگ' })
      .locator('span.text-red-600')
      .count();
    await admin.screenshot({ path: `${SHOTS}/02-staged.png`, fullPage: true });
    await admin.getByTestId('ms-save').click();
    await toast(admin, 'ذخیره شد').waitFor();
    const visA = (await api(admin, 'GET', `/money-types/visibility/?branch=${A}&trade_type=IMPORT`))
      .data;
    const visB = (await api(admin, 'GET', `/money-types/visibility/?branch=${B}&trade_type=IMPORT`))
      .data;
    const v = (rows, code) => rows.find((r) => r.code === code)?.visibility;
    check(
      4,
      'Staged: parking «لازم», built-in «خاک‌پولی بانکی» hidden → preview, then save',
      (bar.includes('۲') || bar.includes('2')) &&
        requiredMark === 1 &&
        !previewText.includes('خاک‌پولی تحویلی بانک') &&
        v(visA, EXP) === 'REQUIRED' &&
        v(visA, 'KHAK_PULI_BANK') === 'HIDDEN' &&
        v(visB, EXP) === 'OPTIONAL' &&
        v(visB, 'KHAK_PULI_BANK') === 'OPTIONAL',
      `${bar} | A ${v(visA, EXP)}/${v(visA, 'KHAK_PULI_BANK')} B ${v(visB, EXP)}/${v(visB, 'KHAK_PULI_BANK')}`,
    );
  },
);

await step(
  5,
  'Branch manager’s form: «عواید» and «مصارف» sections follow the settings',
  async () => {
    await mgr.goto(`${BASE}/transactions/new/IMPORT`);
    await mgr.getByTestId('section-revenue').waitFor();
    const revenue = await mgr
      .locator('[data-testid=section-revenue] [data-testid^="field-"]')
      .evaluateAll((els) => els.map((e) => e.dataset.testid));
    const expenses = await mgr
      .locator('[data-testid=section-expenses] [data-testid^="field-"]')
      .evaluateAll((els) => els.map((e) => e.dataset.testid));
    const required = await mgr
      .locator('[data-testid=section-expenses] label', { hasText: 'مصرف پارکنگ' })
      .locator('span.text-red-600')
      .count();
    const text = await bodyText(mgr);
    await mgr2.goto(`${BASE}/transactions/new/IMPORT`);
    await mgr2.getByTestId('section-expenses').waitFor();
    const other = await mgr2.locator(field('khak_puli_bank')).count();
    const otherRequired = await mgr2
      .locator('[data-testid=section-expenses] label', { hasText: 'مصرف پارکنگ' })
      .locator('span.text-red-600')
      .count();
    check(
      5,
      'Branch manager’s form: «عواید» and «مصارف» sections follow the settings',
      revenue[0] === 'field-customer_payment' &&
        revenue.includes(`field-@money:${REV}`) &&
        expenses.includes(`field-@money:${EXP}`) &&
        !expenses.includes('field-khak_puli_bank') &&
        required === 1 &&
        other === 1 &&
        otherRequired === 0 &&
        !text.includes('استراس'),
      `${revenue.join(',')} | ${expenses.length} expenses`,
    );
  },
);

await step(6, 'Required added type: empty → inline error, nothing posted', async () => {
  await mgr.fill(field('serial_number'), SERIAL);
  await mgr.fill(field('plate_afghan'), 'کابل ۴۴۲');
  await mgr.fill(field('driver_name'), 'راننده آزمایشی');
  await mgr.fill(field('customer_payment'), '۱۰۰۰');
  await mgr.fill(field(`@money:${REV}`), '۲۰۰');
  await mgr.fill(field('khak_puli_cash'), '100');
  let posted = false;
  const listener = (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/transactions/')) posted = true;
  };
  mgr.on('request', listener);
  await mgr.click('[data-testid=tx-submit]');
  await mgr.locator(`${field(`@money:${EXP}`)}[aria-invalid=true]`).waitFor();
  mgr.off('request', listener);
  check(
    6,
    'Required added type: empty → inline error, nothing posted',
    !posted,
    `posted=${posted}`,
  );
});

await step(7, 'Live summary: revenue ۱٬۲۰۰ − expenses ۱۵۰ = +۱٬۰۵۰ ؋; saved', async () => {
  await mgr.fill(field(`@money:${EXP}`), '۵۰');
  await mgr.locator(field('serial_number')).focus();
  await mgr.waitForFunction(
    () => document.querySelector('[data-testid=summary-balance]')?.textContent.includes('۱٬۰۵۰'),
    null,
    { timeout: 8000 },
  );
  const revenue = await mgr.textContent('[data-testid=summary-revenue]');
  const expenses = await mgr.textContent('[data-testid=summary-expenses]');
  await mgr.screenshot({ path: `${SHOTS}/03-form.png`, fullPage: true });
  await mgr.click('[data-testid=tx-submit]');
  await mgr.waitForURL(/highlight=\d+/);
  txId = Number(new URL(mgr.url()).searchParams.get('highlight'));
  const tx = (await api(mgr, 'GET', `/transactions/${txId}/`)).data;
  check(
    7,
    'Live summary: revenue ۱٬۲۰۰ − expenses ۱۵۰ = +۱٬۰۵۰ ؋; saved',
    revenue.includes('۱٬۲۰۰') &&
      expenses.includes('۱۵۰') &&
      tx.balance === '1050.00' &&
      tx.money_amounts[REV] === '200.00' &&
      tx.money_amounts[EXP] === '50.00' &&
      tx.row_summary.total_revenue_afn === '1200.00',
    `${revenue} | ${expenses} | balance ${tx.balance}`,
  );
});

await step(8, 'Detail + print: both types in the money table, revenue total, balance', async () => {
  await mgr.goto(`${BASE}/transactions/${txId}`);
  await mgr.getByTestId('money-table').waitFor();
  const rev = await mgr.getByTestId(`money-@money:${REV}`).innerText();
  const exp = await mgr.getByTestId(`money-@money:${EXP}`).innerText();
  const total = await mgr.getByTestId('money-total-revenue').innerText();
  const profit = await mgr.getByTestId('detail-profit-afn').innerText();
  await mgr.emulateMedia({ media: 'print' });
  const header = await mgr.getByTestId('print-header').isVisible();
  const printed = await mgr.getByTestId('money-table').isVisible();
  const text = await bodyText(mgr);
  await mgr.screenshot({ path: `${SHOTS}/04-print.png`, fullPage: true });
  await mgr.emulateMedia({ media: 'screen' });
  check(
    8,
    'Detail + print: both types in the money table, revenue total, balance',
    rev.includes('کمیشن خدمات') &&
      rev.includes('۲۰۰') &&
      exp.includes('مصرف پارکنگ') &&
      total.includes('۱٬۲۰۰') &&
      profit.includes('۱٬۰۵۰') &&
      header &&
      printed &&
      !text.includes('استراس'),
    `${rev} | ${exp} | ${total} | ${profit}`,
  );
});

await step(9, 'Income statement: commission under Revenue, parking under COGS', async () => {
  const report = (
    await api(admin, 'GET', `/income-statement/?branch=${A}&date_from=${today}&date_to=${today}`)
  ).data;
  const line = (code) => report.lines.find((l) => l.code === code);
  await admin.goto(
    `${BASE}/reports/income-statement?preset=custom&date_from=${today}&date_to=${today}&branch=${A}`,
  );
  const row = admin.locator(`tr[data-code=MNY_${REV}]`);
  await row.waitFor();
  const rowText = await row.innerText();
  const revenueTotal = await admin.getByTestId('total-revenue-afn').innerText();
  const text = await bodyText(admin);
  await admin.screenshot({ path: `${SHOTS}/05-statement.png`, fullPage: true });
  check(
    9,
    'Income statement: commission under Revenue, parking under COGS',
    line(`MNY_${REV}`)?.section === 'REVENUE' &&
      line(`MNY_${REV}`)?.amount_afn === '200.00' &&
      line(`MNY_${EXP}`)?.section === 'COGS' &&
      line(`MNY_${EXP}`)?.amount_afn === '50.00' &&
      report.totals.revenue_afn === '1200.00' &&
      rowText.includes('۲۰۰') &&
      revenueTotal.includes('۱٬۲۰۰') &&
      !text.includes('استراس'),
    `${report.totals.revenue_afn} ${report.totals.cogs_afn}`,
  );
});

await step(
  10,
  'Drill-down from the commission line → that transaction, chip names the type',
  async () => {
    await admin.locator(`tr[data-code=MNY_${REV}] [data-testid=drill-down]`).click();
    await admin.waitForURL(/nonzero=/);
    await admin.getByTestId('nonzero-chip').waitFor();
    await admin.locator('tbody tr', { hasText: SERIAL }).first().waitFor();
    const chip = await admin.getByTestId('nonzero-chip').innerText();
    const rows = await admin.locator('tbody tr').count();
    check(
      10,
      'Drill-down from the commission line → that transaction, chip names the type',
      chip.includes('کمیشن خدمات') && rows === 1,
      `${chip} | ${rows} rows`,
    );
  },
);

await step(11, 'Excel: a column per type, totals right, «بندر والی» not «استراس»', async () => {
  const file = await fetchFile(
    mgr,
    `/transactions/export/?date_from=${today}&date_to=${today}`,
    'transactions.xlsx',
  );
  const sheet = xlsx(file);
  const header = sheet.rows[3];
  const row = sheet.rows.find((r) => r[0] === SERIAL);
  const at = (name) => row[header.indexOf(name)];
  const statement = xlsx(
    await fetchFile(
      mgr,
      `/income-statement/export/?date_from=${today}&date_to=${today}`,
      'statement.xlsx',
    ),
  );
  const flat = JSON.stringify(statement.rows);
  check(
    11,
    'Excel: a column per type, totals right, «بندر والی» not «استراس»',
    at('کمیشن خدمات (عاید)') === 200 &&
      at('مصرف پارکنگ (مصرف)') === 50 &&
      at('جمله عواید') === 1200 &&
      at('مفاد / ضرر (افغانی)') === 1050 &&
      header.includes('عواید بندر والی (مصرف)') &&
      !JSON.stringify(header).includes('استراس') &&
      flat.includes('کمیشن خدمات') &&
      flat.includes('سایر عواید'),
    `${at('کمیشن خدمات (عاید)')} ${at('مصرف پارکنگ (مصرف)')} ${at('جمله عواید')}`,
  );
});

await step(12, 'Branch manager records an office income (۵۰۰ ؋, کمیشن)', async () => {
  await mgr.goto(`${BASE}/finance/office-income`);
  await mgr.getByTestId('add-record').click();
  await mgr.getByTestId('record-form').waitFor();
  await mgr.selectOption('[data-testid=field-category]', 'COMMISSION');
  await mgr.fill('[data-testid=field-amount]', '۵۰۰');
  await mgr.fill('[data-testid=field-person]', 'شرکت آزمایشی');
  await mgr.click('[data-testid=drawer-submit]');
  await toast(mgr, 'عاید دفتر ثبت شد').waitFor();
  await mgr.getByTestId('summary-COMMISSION').waitFor();
  const chip = await mgr.getByTestId('summary-COMMISSION').innerText();
  const list = (await api(mgr, 'GET', '/office-incomes/')).data;
  await mgr.screenshot({ path: `${SHOTS}/06-office-income.png`, fullPage: true });
  check(
    12,
    'Branch manager records an office income (۵۰۰ ؋, کمیشن)',
    list.count === 1 &&
      list.results[0].branch === A &&
      list.totals.afn === '500.00' &&
      chip.includes('۵۰۰'),
    chip,
  );
});

await step(13, 'Income statement: «سایر عواید» ۵۰۰ ؋; net = ۱٬۰۵۰ + ۵۰۰', async () => {
  await mgr.goto(
    `${BASE}/reports/income-statement?preset=custom&date_from=${today}&date_to=${today}`,
  );
  await mgr.locator('tr[data-code=OI_COMMISSION]').waitFor();
  const line = await mgr.locator('tr[data-code=OI_COMMISSION]').innerText();
  const other = await mgr.getByTestId('total-other_income-afn').innerText();
  const net = await mgr.getByTestId('total-net-afn').innerText();
  check(
    13,
    'Income statement: «سایر عواید» ۵۰۰ ؋; net = ۱٬۰۵۰ + ۵۰۰',
    line.includes('۵۰۰') && other.includes('۵۰۰') && net.includes('۱٬۵۵۰'),
    `${other} | ${net}`,
  );
});

await step(14, 'Dashboard: «عواید دفتر این ماه» shows the office income', async () => {
  await mgr.goto(`${BASE}/dashboard`);
  await mgr.getByTestId('kpi-office-income-value').waitFor();
  const value = await mgr.getByTestId('kpi-office-income-value').innerText();
  const label = await mgr.getByTestId('kpi-office-income').innerText();
  check(
    14,
    'Dashboard: «عواید دفتر این ماه» shows the office income',
    label.includes('عواید دفتر این ماه') && value.includes('۵۰۰'),
    value,
  );
});

await step(15, 'Kind change blocked once amounts exist (button and API 409)', async () => {
  await admin.goto(SETTINGS('revenue'));
  await admin.getByTestId(`ms-row-${REV}`).waitFor();
  const disabled = await admin.getByTestId(`ms-kind-${REV}`).isDisabled();
  const typeId = (await api(admin, 'GET', '/money-types/')).data.find((x) => x.code === REV).id;
  const r = await api(admin, 'PATCH', `/money-types/${typeId}/`, { kind: 'EXPENSE' });
  check(
    15,
    'Kind change blocked once amounts exist (button and API 409)',
    disabled && r.status === 409 && String(r.data.detail).includes('معامله'),
    `${disabled} ${r.status}`,
  );
});

await step(16, 'Branch manager cannot manage types (page 403, API 403)', async () => {
  await mgr.goto(`${BASE}/admin/money-settings`);
  const text = await bodyText(mgr);
  const r = await api(mgr, 'POST', '/money-types/', { name_fa: 'x', kind: 'REVENUE' });
  check(
    16,
    'Branch manager cannot manage types (page 403, API 403)',
    r.status === 403 && !text.includes('نوع عاید تازه'),
    r.status,
  );
});

await step(17, 'Field settings: money fields only linked, not editable there', async () => {
  await admin.goto(`${BASE}/admin/field-settings?branch=${A}&type=IMPORT`);
  await admin.getByTestId('fs-money-link').waitFor();
  const moneyRows = await admin
    .locator('[data-testid=fs-row-customer_payment], [data-testid=fs-row-khak_puli_cash]')
    .count();
  const link = await admin.getByTestId('fs-money-link').locator('a').getAttribute('href');
  check(
    17,
    'Field settings: money fields only linked, not editable there',
    moneyRows === 0 && link === '/admin/money-settings',
    `${moneyRows} ${link}`,
  );
});

await step(18, 'Pashto and English names in the form', async () => {
  await mgr.evaluate(() => localStorage.setItem('kc.lang', 'ps'));
  await mgr.goto(`${BASE}/transactions/new/IMPORT`);
  await mgr.getByTestId('section-revenue').waitFor();
  const ps = await bodyText(mgr);
  await mgr.evaluate(() => localStorage.setItem('kc.lang', 'en'));
  await mgr.goto(`${BASE}/transactions/new/IMPORT`);
  await mgr.getByTestId('section-revenue').waitFor();
  const en = await bodyText(mgr);
  await mgr.evaluate(() => localStorage.setItem('kc.lang', 'fa'));
  check(
    18,
    'Pashto and English names in the form',
    ps.includes('د خدماتو کمیشن') &&
      ps.includes('د بندر والي عواید') &&
      en.includes('E2EMONEY commission') &&
      en.includes('Bandar Wali') &&
      !en.includes('Estras') &&
      !ps.includes('استراس'),
  );
});

await step(19, 'No «استراس» in any API label', async () => {
  const config = (await api(mgr, 'GET', `/form-config/?trade_type=EXPORT`)).data;
  const types = (await api(mgr, 'GET', '/money-types/')).data;
  const lines = (await api(admin, 'GET', '/statement-lines/')).data;
  const blob = JSON.stringify([config, types, lines]);
  check(
    19,
    'No «استراس» in any API label',
    !blob.includes('استراس') && !blob.includes('Estras') && blob.includes('بندر والی'),
  );
});

check(20, 'No uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();

const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(SHOTS, 'results.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
