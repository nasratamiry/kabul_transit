/**
 * Stage 12a live check: transactions list, trade-type picker, dynamic form, live preview,
 * 428 soft lock, edit, branch scoping — against the real stack (Django :8000 + Vite :5173).
 *   ..\.venv\Scripts\python scripts\cleanup-stage12a.py --setup
 *   node scripts/verify-stage12a.mjs <screenshot-dir>
 *   ..\.venv\Scripts\python scripts\cleanup-stage12a.py
 * Env: KC_PASS (default: the password cleanup-stage12a.py sets), KC_BROWSER.
 */
import fs from 'node:fs';

import { chromium } from 'playwright-core';

const BASE = process.env.KC_BASE_URL ?? 'http://localhost:5173';
const SHOTS = process.argv[2] ?? 'stage12a-screenshots';
const PASS = process.env.KC_PASS ?? 'E2e-Stage12-Pass-2026';
const BROWSER =
  process.env.KC_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
fs.mkdirSync(SHOTS, { recursive: true });

const toDari = (s) => String(s).replace(/\d/g, (d) => String.fromCharCode(0x06f0 + Number(d)));
const results = [];
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
let pages = {};

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
const shamsi = (page, days) =>
  page.evaluate(async (n) => {
    const m = await import('/src/lib/date.ts');
    return m.shiftShamsi(m.todayShamsi(), n, 'day');
  }, days);
/** n days before the first day of the current Shamsi month: always outside the default list window. */
const beforeMonth = (page, days) =>
  page.evaluate(async (n) => {
    const m = await import('/src/lib/date.ts');
    return m.shiftShamsi(m.currentShamsiMonth().from, -n, 'day');
  }, days);
const toast = (p, text) => p.locator('div[role=status]', { hasText: text }).first();
const rows = (p) => p.locator('tbody tr[tabindex]');
async function waitRows(p, predicate, timeout = 8000) {
  const until = Date.now() + timeout;
  let texts = [];
  while (Date.now() < until) {
    texts = await rows(p).allTextContents();
    if (predicate(texts)) return texts;
    await p.waitForTimeout(250);
  }
  return texts;
}

const admin = await session('e2e_admin');
const mgr = await session('e2e_mgr');
pages = { admin, mgr };
const branches = (await api(admin, 'GET', '/branches/')).data;
const A = branches.find((b) => b.code === 'E2E12A');
const B = branches.find((b) => b.code === 'E2E12B');
const traders = (await api(admin, 'GET', `/traders/?search=${encodeURIComponent('تاجر آزمایشی')}`))
  .data;
const TA = traders.find((t) => t.name.endsWith('الف'));
const TB = traders.find((t) => t.name.endsWith('ب'));
const today = await shamsi(admin, 0);
const tx = {};
async function createTx(page, key, body) {
  const r = await api(page, 'POST', '/transactions/', {
    currency: 'AFN',
    status: 'WAITING',
    date: today,
    ...body,
  });
  if (r.status !== 201) throw new Error(`create ${key}: ${r.status} ${JSON.stringify(r.data)}`);
  tx[key] = r.data;
}

// ================================ List ================================
await step(1, 'super_admin opens /transactions → empty state', async () => {
  await admin.goto(`${BASE}/transactions`);
  const empty = admin.getByTestId('table-empty');
  await empty.waitFor({ timeout: 10000 });
  check(
    1,
    'super_admin opens /transactions → empty state',
    (await empty.textContent()).includes('هیچ معامله‌ای در این بازه نیست'),
  );
});

await step(2, 'Three API-created transactions of this month are listed', async () => {
  await createTx(admin, 'S1', {
    branch: A.id,
    trade_type: 'EXPORT',
    serial_number: 'KC-1001',
    trader: TA.id,
    plate_afghan: 'ABC-123',
    driver_name: 'کریم',
    seal_expense: '0',
    scale_ticket_expense: '0',
    gate_ticket_expense: '0',
    customer_payment: '10000',
    tariff_expense: '3000',
  });
  await createTx(admin, 'S2', {
    branch: A.id,
    trade_type: 'IMPORT',
    serial_number: 'KC-1002',
    trader: TB.id,
    customer_payment: '500',
    expense_labor: '900',
  });
  await createTx(admin, 'S3', {
    branch: B.id,
    trade_type: 'TRANSIT',
    serial_number: 'KC-2001',
    trader: TA.id,
  });
  await createTx(admin, 'S4', {
    branch: A.id,
    trade_type: 'EXPORT',
    serial_number: 'KC-1004',
    date: await beforeMonth(admin, 3),
  });
  await admin.reload();
  const texts = await waitRows(admin, (r) => r.length === 3);
  const s1 = texts.find((t) => t.includes('KC-1001')) ?? '';
  check(
    2,
    'Three API-created transactions of this month are listed (default = current Shamsi month)',
    texts.length === 3 && s1.includes('صادرات') && s1.includes('۷٬۰۰۰'),
    `${texts.length} rows; S1 profit shown: ${s1.includes('۷٬۰۰۰')}`,
  );
  const loss = await admin
    .locator('tbody tr', { hasText: 'KC-1002' })
    .getByTestId('profit')
    .getAttribute('class');
  check('2b', 'Profit green / loss red', loss.includes('text-red'), loss);
  await admin.screenshot({ path: `${SHOTS}/01-list.png` });
});

await step(3, 'Shamsi date range (typed in Dari digits) → only the older row', async () => {
  await admin.fill('[data-testid=filter-date-from]', toDari(await beforeMonth(admin, 5)));
  await admin.fill('[data-testid=filter-date-to]', toDari(await beforeMonth(admin, 1)));
  const texts = await waitRows(admin, (r) => r.length === 1);
  check(
    3,
    'Shamsi date range (typed in Dari digits) → only the older row',
    texts.length === 1 && texts[0].includes('KC-1004'),
    admin.url(),
  );
  await admin.goto(`${BASE}/transactions`);
});

await step(4, 'Trade type filter', async () => {
  await admin.selectOption('[data-testid=filter-trade-type]', 'EXPORT');
  const texts = await waitRows(admin, (r) => r.length === 1);
  check(
    4,
    'Trade type filter',
    texts.length === 1 && texts[0].includes('KC-1001') && admin.url().includes('trade_type=EXPORT'),
  );
  await admin.goto(`${BASE}/transactions`);
});

await step(5, 'Trader filter via SearchSelect (type, pick)', async () => {
  const input = admin.locator('[data-testid=filter-trader] input');
  await input.click();
  await input.fill('الف');
  await admin.locator('[role=option]', { hasText: 'تاجر آزمایشی الف' }).click();
  const texts = await waitRows(admin, (r) => r.length === 2);
  check(
    5,
    'Trader filter via SearchSelect (type, pick)',
    texts.length === 2 && texts.every((t) => t.includes('تاجر آزمایشی الف')),
    admin.url(),
  );
  await admin.screenshot({ path: `${SHOTS}/02-list-filtered.png` });
  await admin.goto(`${BASE}/transactions`);
});

await step(6, 'Serial search (partial, debounced)', async () => {
  await admin.fill('[data-testid=filter-search]', 'KC-100');
  const texts = await waitRows(admin, (r) => r.length === 2);
  check(
    6,
    'Serial search (partial, debounced)',
    texts.length === 2 && texts.every((t) => t.includes('KC-100')),
    admin.url(),
  );
});

await step(8, 'Clear filters resets URL and list', async () => {
  await admin.click('[data-testid=clear-filters]');
  const texts = await waitRows(admin, (r) => r.length === 3);
  check(
    8,
    'Clear filters resets URL and list',
    texts.length === 3 && new URL(admin.url()).search === '',
    admin.url(),
  );
});

await step(7, 'Branch filter (super_admin)', async () => {
  await admin.selectOption('[data-testid=filter-branch]', String(B.id));
  const texts = await waitRows(admin, (r) => r.length === 1);
  check(7, 'Branch filter (super_admin)', texts.length === 1 && texts[0].includes('KC-2001'));
  await admin.goto(`${BASE}/transactions`);
});

await step(10, 'Row click → /transactions/:id/edit', async () => {
  await waitRows(admin, (r) => r.length === 3);
  await admin.locator('tbody tr', { hasText: 'KC-1001' }).click();
  await admin.waitForURL(`**/transactions/${tx.S1.id}/edit`);
  check(10, 'Row click → /transactions/:id/edit', true, admin.url());
});

await step(25, 'Edit form is pre-filled', async () => {
  await admin.waitForSelector('[data-testid=tx-form]');
  const serial = await admin.inputValue('[data-testid=field-serial_number]');
  const pay = await admin.inputValue('[data-testid=field-customer_payment]');
  const trader = await admin.inputValue('[data-testid=field-trader] input');
  check(
    25,
    'Edit form is pre-filled',
    serial === 'KC-1001' && pay === '10000.00' && trader === 'تاجر آزمایشی الف',
    `${serial} / ${pay} / ${trader}`,
  );
});

await step(26, 'Edit customer_payment → PATCH → toast → list updated', async () => {
  await admin.fill('[data-testid=field-customer_payment]', '۱۲۰۰۰');
  await admin.click('[data-testid=tx-submit]');
  await toast(admin, 'KC-1001').waitFor({ timeout: 10000 });
  await admin.waitForURL(/highlight=/);
  const texts = await waitRows(admin, (r) => r.some((t) => t.includes('۱۲٬۰۰۰')));
  const saved = (await api(admin, 'GET', `/transactions/${tx.S1.id}/`)).data;
  check(
    26,
    'Edit customer_payment → PATCH → toast → list updated',
    saved.customer_payment === '12000.00' && texts.some((t) => t.includes('۱۲٬۰۰۰')),
    saved.customer_payment,
  );
});

await step(11, 'branch_manager sees only own-branch rows, no branch filter', async () => {
  await mgr.goto(`${BASE}/transactions`);
  const texts = await waitRows(mgr, (r) => r.length === 2);
  const branchFilter = await mgr.locator('[data-testid=filter-branch]').count();
  check(
    11,
    'branch_manager sees only own-branch rows, no branch filter',
    texts.length === 2 && !texts.some((t) => t.includes('KC-2001')) && branchFilter === 0,
  );
});

await step(
  27,
  'branch_manager opening another branch’s transaction → not-available page',
  async () => {
    await mgr.goto(`${BASE}/transactions/${tx.S3.id}/edit`);
    await mgr.getByTestId('tx-not-available').waitFor({ timeout: 10000 });
    const r = await api(mgr, 'GET', `/transactions/${tx.S3.id}/`);
    check(
      27,
      'branch_manager opening another branch’s transaction → not-available page',
      true,
      `API ${r.status} (port-scoped queryset hides it)`,
    );
  },
);

await step(31, 'preview-summary: branch_manager for another branch → 403', async () => {
  const r = await api(mgr, 'POST', '/transactions/preview-summary/', {
    branch: B.id,
    customer_payment: '1',
  });
  check(31, 'preview-summary: branch_manager for another branch → 403', r.status === 403, r.status);
});

await step(30, 'preview-summary math (AFN): 10000 − 2000 − 3000 = 5000', async () => {
  const r = await api(admin, 'POST', '/transactions/preview-summary/', {
    branch: A.id,
    currency: 'AFN',
    customer_payment: '10000',
    revenue_transport: '2000',
    tariff_expense: '3000',
  });
  check(
    30,
    'preview-summary math (AFN): 10000 − 2000 − 3000 = 5000',
    r.status === 200 && r.data.profit_or_loss_afn === '5000.00',
    JSON.stringify(r.data),
  );
});

// ============================ Create (manager) ============================
await step(13, '/transactions/new → four trade-type cards + branch context', async () => {
  await mgr.goto(`${BASE}/transactions/new`);
  await mgr.waitForSelector('[data-testid=trade-card-EXPORT]');
  const cards = await mgr.locator('[data-testid^=trade-card-]').count();
  const ctx = await mgr.getByTestId('picker-branch-context').textContent();
  check(
    13,
    '/transactions/new → four trade-type cards + branch context',
    cards === 4 && ctx.includes('بندر آزمایشی کابل'),
    `${cards} cards`,
  );
  await mgr.screenshot({ path: `${SHOTS}/03-trade-type-picker.png` });
});

await step(14, 'Pick EXPORT → form renders', async () => {
  await mgr.click('[data-testid=trade-card-EXPORT]');
  await mgr.waitForURL('**/transactions/new/EXPORT');
  await mgr.waitForSelector('[data-testid=tx-form]');
  check(14, 'Pick EXPORT → form renders', true);
});

await step(15, 'Fields grouped in sections; required fields marked', async () => {
  const sections = await mgr.locator('[data-testid^=section-]').count();
  const serialLabel = await mgr
    .locator('label[for]', { has: mgr.locator('span.text-red-600') })
    .allTextContents();
  check(
    15,
    'Fields grouped in sections; required fields marked',
    sections >= 5 &&
      serialLabel.some((l) => l.includes('شماره / سریال')) &&
      serialLabel.some((l) => l.includes('تکت دروازه')),
    `${sections} sections; required: ${serialLabel.length}`,
  );
});

await step(16, 'Hidden fields (FieldConfig) are not rendered', async () => {
  const truck = await mgr.locator('[data-testid=field-truck_type]').count();
  const motabari = await mgr.locator('#field-motabari').count();
  const plate = await mgr.locator('[data-testid=field-plate_foreign]').count();
  check(
    16,
    'Hidden fields (FieldConfig) are not rendered',
    truck === 0 && motabari === 0 && plate === 1,
    `truck_type=${truck}, motabari=${motabari}, plate_foreign=${plate}`,
  );
});

await step(18, 'Submit without required fields → inline errors, no API call', async () => {
  let posted = false;
  const listener = (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/transactions/')) posted = true;
  };
  mgr.on('request', listener);
  await mgr.click('[data-testid=tx-submit]');
  await mgr.waitForTimeout(500);
  mgr.off('request', listener);
  const alerts = await mgr.locator('[data-testid=tx-form] [role=alert]').allTextContents();
  check(
    18,
    'Submit without required fields → inline errors, no API call',
    !posted && alerts.length >= 4 && alerts.some((a) => a.includes('لازم است')),
    `${alerts.length} errors`,
  );
});

await step(17, 'Live preview: ۱۰۰۰۰ − ۲۰۰۰ (عواید ترانسپورت = مصرف) − ۳۰۰۰ = ۵٬۰۰۰ ؋', async () => {
  await mgr.fill('[data-testid=field-customer_payment]', '۱۰۰۰۰');
  await mgr.fill('[data-testid=field-revenue_transport]', '۲۰۰۰');
  await mgr.fill('[data-testid=field-tariff_expense]', '۳۰۰۰');
  await mgr.locator('[data-testid=field-serial_number]').focus();
  await mgr.waitForFunction(
    () => document.querySelector('[data-testid=summary-balance]')?.textContent.includes('۵٬۰۰۰'),
    null,
    { timeout: 8000 },
  );
  const bal = await mgr.textContent('[data-testid=summary-balance]');
  const exp = await mgr.textContent('[data-testid=summary-expenses]');
  const cls = await mgr.getAttribute('[data-testid=summary-balance]', 'class');
  check(
    17,
    'Live preview: ۱۰۰۰۰ − ۲۰۰۰ (عواید ترانسپورت = مصرف) − ۳۰۰۰ = ۵٬۰۰۰ ؋',
    bal.includes('+۵٬۰۰۰٫۰۰') && exp.includes('۵٬۰۰۰') && cls.includes('emerald'),
    `${bal} | expenses ${exp}`,
  );
});

await step(20, 'Dari digits in money fields normalized on blur', async () => {
  const v = await mgr.inputValue('[data-testid=field-customer_payment]');
  await mgr.fill('[data-testid=field-seal_expense]', '۱۲۳٫۵');
  await mgr.locator('[data-testid=field-serial_number]').focus();
  const seal = await mgr.inputValue('[data-testid=field-seal_expense]');
  check(
    20,
    'Dari digits in money fields normalized on blur',
    v === '10000' && seal === '123.5',
    `${v} / ${seal}`,
  );
});

await step(21, 'Currency USD → exchange_rate appears and is required', async () => {
  const before = await mgr.locator('[data-testid=field-exchange_rate]').count();
  await mgr.selectOption('[data-testid=field-currency]', 'USD');
  await mgr.waitForSelector('[data-testid=field-exchange_rate]');
  const label = await mgr.locator('label', { hasText: 'نرخ اسعار' }).innerHTML();
  check(
    21,
    'Currency USD → exchange_rate appears and is required',
    before === 0 && label.includes('text-red-600'),
    `before=${before}`,
  );
});

await step(
  22,
  'exchange_rate pre-filled from the day’s USD rate (70); USD preview shown',
  async () => {
    await mgr.waitForFunction(
      () => document.querySelector('[data-testid=field-exchange_rate]')?.value === '70',
      null,
      { timeout: 8000 },
    );
    const hint = await mgr
      .locator('[data-testid=tx-form]')
      .getByText('نرخ همان روز معامله')
      .textContent();
    await mgr.waitForFunction(
      () => document.querySelector('[data-testid=summary-usd]')?.textContent.includes('≈'),
      null,
      { timeout: 8000 },
    );
    const usd = await mgr.textContent('[data-testid=summary-usd]');
    check(
      22,
      'exchange_rate pre-filled from the day’s USD rate (70); USD preview shown',
      hint.includes('۷۰') && /\d|[۰-۹]/.test(usd),
      `${hint} | ${usd}`,
    );
    await mgr.screenshot({ path: `${SHOTS}/04-form-preview.png`, fullPage: true });
    await mgr.selectOption('[data-testid=field-currency]', 'AFN');
  },
);

await step(
  'A',
  '«Add new trader» from the form → comes back with the new trader selected',
  async () => {
    await mgr.fill('[data-testid=field-serial_number]', 'KC-3001');
    const input = mgr.locator('[data-testid=field-trader] input');
    await input.click();
    await mgr.getByTestId('field-trader-add-new').click();
    await mgr.waitForURL('**/partners/traders/new?return=*');
    await mgr.fill('[role=dialog] [name=name]', 'تاجر آزمایشی تازه');
    await mgr.click('[data-testid=drawer-submit]');
    await mgr.waitForURL('**/transactions/new/EXPORT*');
    await mgr.waitForSelector('[data-testid=tx-form]');
    await mgr.waitForFunction(
      () =>
        document.querySelector('[data-testid=field-trader] input')?.value === 'تاجر آزمایشی تازه',
      null,
      { timeout: 8000 },
    );
    const serial = await mgr.inputValue('[data-testid=field-serial_number]');
    check(
      'A',
      '«Add new trader» from the form → comes back with the new trader selected (form kept)',
      serial === 'KC-3001',
      `serial=${serial}`,
    );
  },
);

await step(
  19,
  'Valid submit → 201, toast with serial, list filtered to the day with highlight',
  async () => {
    for (const [f, v] of Object.entries({
      plate_afghan: 'KBL-777',
      driver_name: 'احمد',
      scale_ticket_expense: '50',
      gate_ticket_expense: '25',
    })) {
      await mgr.fill(`[data-testid=field-${f}]`, v);
    }
    const resp = mgr.waitForResponse(
      (r) => r.url().endsWith('/api/transactions/') && r.request().method() === 'POST',
    );
    await mgr.click('[data-testid=tx-submit]');
    const status = (await resp).status();
    await toast(mgr, 'KC-3001').waitFor({ timeout: 10000 });
    await mgr.waitForURL(/highlight=\d+/);
    const url = new URL(mgr.url());
    // The list loads after the redirect; the highlight lasts 3 s.
    const highlighted = await mgr
      .locator('tbody tr.kc-row-highlight')
      .waitFor({ timeout: 2500 })
      .then(() => 1)
      .catch(() => 0);
    await mgr.screenshot({ path: `${SHOTS}/05-saved-highlight.png` });
    check(
      19,
      'Valid submit → 201, toast with serial, list filtered to the day with highlight',
      status === 201 &&
        url.searchParams.get('date_from') === today &&
        url.searchParams.get('date_to') === today &&
        highlighted === 1,
      `${url.search} status=${status} highlighted=${highlighted}`,
    );
  },
);

// ============================ Super admin + 428 ============================
await step(28, 'super_admin picker: branch first, cards disabled until then', async () => {
  await admin.goto(`${BASE}/transactions/new`);
  const disabled = await admin.locator('[data-testid=trade-card-EXPORT]').isDisabled();
  await admin.selectOption('[data-testid=picker-branch]', String(B.id));
  const enabled = await admin.locator('[data-testid=trade-card-EXPORT]').isEnabled();
  check(28, 'super_admin picker: branch first, cards disabled until then', disabled && enabled);
});

await step(23, 'Rate missing → submit → 428 → full-page error with CTA', async () => {
  await admin.click('[data-testid=trade-card-EXPORT]');
  await admin.waitForURL(`**/transactions/new/EXPORT?branch=${B.id}`);
  await admin.waitForSelector('[data-testid=tx-form]');
  for (const [f, v] of Object.entries({
    serial_number: 'KC-4001',
    plate_afghan: 'TKH-1',
    driver_name: 'محمود',
    customer_payment: '800',
    seal_expense: '1',
    scale_ticket_expense: '1',
    gate_ticket_expense: '1',
  })) {
    await admin.fill(`[data-testid=field-${f}]`, v);
  }
  const t = admin.locator('[data-testid=field-trader] input');
  await t.click();
  await t.fill('ب');
  await admin.locator('[role=option]', { hasText: 'تاجر آزمایشی ب' }).click();
  const rate = (await api(admin, 'GET', `/exchange-rates/?currency=USD&date=${today}`)).data[0];
  await api(admin, 'DELETE', `/exchange-rates/${rate.id}/`);
  await admin.click('[data-testid=tx-submit]');
  await admin.getByTestId('rate-missing-page').waitFor({ timeout: 10000 });
  await admin.screenshot({ path: `${SHOTS}/06-rate-missing-428.png` });
  check(
    23,
    'Rate missing → submit → 428 → full-page error with CTA',
    await admin.getByTestId('rate-missing-cta').isVisible(),
  );
});

await step(12, 'List: no rate today → «معاملهٔ تازه» disabled with hint', async () => {
  const p = await (await browser.newContext()).newPage();
  await p.goto(`${BASE}/login`);
  await p.fill('#username', 'e2e_mgr');
  await p.fill('#password', PASS);
  await p.click('button[type=submit]');
  await p.waitForURL('**/dashboard');
  await p.goto(`${BASE}/transactions`);
  await p.getByTestId('no-rate-hint').waitFor({ timeout: 10000 });
  check(
    12,
    'List: no rate today → «معاملهٔ تازه» disabled with hint',
    await p.getByTestId('add-transaction').isDisabled(),
  );
  await p.context().close();
});

await step(
  24,
  'After 428: enter the rate, come back → form restored from sessionStorage → saves',
  async () => {
    await admin.click('[data-testid=rate-missing-cta]');
    await admin.waitForURL('**/admin/exchange-rates/new');
    await admin.fill('input[name=rate]', '70');
    await admin.click('[data-testid=drawer-submit]');
    await toast(admin, 'ثبت شد').waitFor({ timeout: 10000 });
    await admin.goto(`${BASE}/transactions/new/EXPORT?branch=${B.id}`);
    await admin.waitForSelector('[data-testid=tx-form]');
    const serial = await admin.inputValue('[data-testid=field-serial_number]');
    const restored = await toast(admin, 'دوباره آمد')
      .isVisible()
      .catch(() => false);
    await admin.click('[data-testid=tx-submit]');
    await toast(admin, 'KC-4001').waitFor({ timeout: 10000 });
    const saved = (await api(admin, 'GET', '/transactions/?search=KC-4001')).data.results[0];
    check(
      24,
      'After 428: enter the rate, come back → form restored from sessionStorage → saves',
      serial === 'KC-4001' && saved?.branch === B.id,
      `serial=${serial}, toast=${restored}, saved branch=${saved?.branch}`,
    );
    check(
      29,
      'super_admin: chosen branch is sent with the form',
      saved?.branch === B.id && saved?.trader === TB.id,
    );
  },
);

// ============================ Pagination (last: adds 30 rows) ============================
await step(9, 'Pagination: 25 per page, page 2 in the URL', async () => {
  // Creating needs today's USD rate (428 otherwise); make sure an earlier step left one.
  if (!(await api(admin, 'GET', `/exchange-rates/?currency=USD&date=${today}`)).data.length) {
    await api(admin, 'POST', '/exchange-rates/', { date: today, currency: 'USD', rate: '70' });
  }
  for (let i = 0; i < 30; i++) {
    const r = await api(mgr, 'POST', '/transactions/', {
      branch: A.id,
      trade_type: 'IMPORT',
      serial_number: `PG-${100 + i}`,
      date: today,
    });
    if (r.status !== 201) throw new Error(`bulk ${i}: ${r.status}`);
  }
  await mgr.goto(`${BASE}/transactions`);
  const first = await waitRows(mgr, (r) => r.length === 25);
  await mgr.getByRole('button', { name: 'بعدی' }).click();
  const second = await waitRows(mgr, (r) => r.length > 0 && r.length < 25);
  // The list defaults to the current Shamsi month, so count with the same window.
  const month = await mgr.evaluate(async () =>
    (await import('/src/lib/date.ts')).currentShamsiMonth(),
  );
  const total = (
    await api(mgr, 'GET', `/transactions/?page_size=1&date_from=${month.from}&date_to=${month.to}`)
  ).data.count;
  check(
    9,
    'Pagination: 25 per page, page 2 in the URL',
    first.length === 25 && second.length === total - 25 && mgr.url().includes('page=2'),
    `total=${total}, page2=${second.length}`,
  );
});

check('E', 'No uncaught page errors', errors.length === 0, errors.join(' | '));
await browser.close();
fs.writeFileSync(`${SHOTS}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
